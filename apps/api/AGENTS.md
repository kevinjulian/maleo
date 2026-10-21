# @maleo/api — agent instructions

Bun + Hono HTTP API for the content studio. This package owns the content-project
routes, the server-side chat agent that drafts and edits storyboards, image/voice
generation, and metering. It reads and writes the single shared `maleo.db`
directly via `core`'s db layer — no CLI subprocess spawn, no read-model mirror.

The web UI is a separate app (`apps/web`, `@maleo/web`) and talks to this package
over HTTP.

## Running

```bash
bun run api        # from the repo root
```

Package scripts load the repo-root `.env` with `--env-file ../../.env` and set
`MALEO_API_PORT=${MALEO_API_PORT:-8090}`. Do not add `apps/api/.env`.

## Architecture

```
src/
  index.ts            Bun.serve entry, mounts routes
  routes/             Hono route modules (HTTP contracts only)
middleware/         HTTP enforcement glue: perimeter admission, CORS allowlist,
                    instance-owner guard (auth itself lives in @maleo/auth)
  lib/                server helpers: DB access, service clients, text runner
  modules/            feature modules: modules/<feature>/{index,model,service}.ts
    agents/core/      the chat agent: run service, Mastra runtime, tools, persistence
    agents/mcp-servers/  a workspace's external MCP servers
  mcp/                the MCP server MCP clients connect to
  lib/generation/     image job kernel, billed TTS
  lib/metering/       price table + the one metered spend path
  capabilities/       capability wiring shared by the agent tools
  public/            static assets served by the API
```

## Layout of new code

New feature code follows `modules/<feature>/{index,model,service}.ts`: routes in
`index.ts`, request and response schemas in `model.ts`, logic in `service.ts`.
Its tests live in `__tests__/unit/` and `__tests__/integration/` beside it, with
shared fakes in `__tests__/support/`. This differs from the repository's
colocated `*.test.ts` on purpose, for new modules only; code moved into
`modules/agents/core/` from `lib/agent/` kept its colocated tests rather than
rewrite every relative import in them.

## Boundaries

- Routes return JSON and stay thin. DB access, file IO, and external calls belong
  in `lib/`.
- Workspace configs and collections live under the centralized data root
  (`<repo>/data/workspaces`, relocatable via `MALEO_DATA_DIR`). All runtime tables
  live in one shared `maleo.db` (override `MALEO_DB_PATH`).
- Every table and column is declared in `packages/db/src/db/unified-schema.ts`. Do
  NOT create a table or ALTER-add a column anywhere else: the reconcile pass and
  the `content_projects` rebuild read the declaration, and a column they cannot see
  gets destroyed (see `packages/db/tests/unit/schema-ownership.bun.test.ts`).
- Prompt helpers run through `lib/text-runner.ts` on the selected API-backed text
  provider (`lib/ai-provider/`). There is no CLI text runner; Codex CLI and
  Claude Code reach the product as MCP clients (`src/mcp/`).
- Material layer ORDER is a contract, written once: story and voice in their
  templates (`lib/prompts/templates/materials.ts`), visual in
  `modules/agents/core/material-layers.ts`.
  Story planning takes Story + Rules and never Visual or Voice; visual generation
  takes the scene, then Visual, then Rules; voice takes the story brief, Voice as
  delivery, then Rules. Rules layer last in every stage so they read as overriding
  the guidance above them. Assemble prompts through these helpers rather than inline,
  or the three stages drift apart.
- **An agent tool that edits an existing timeline writes editor commands, not the
  job.** It builds the command against `runDocument(job)` — the shared one
  `sceneEditCommand`, `setKeys` or `updateClip` the editor would commit — and runs
  it through `runEdit`/`executeEdit`/`placeOverlay` (`modules/agents/core/edit-document.ts`),
  which executes it in the Rust engine (`lib/editor-engine.ts`, the module the web
  editor executes with), writes the result back into the job and records it. Mark such a tool `edits: true`. Any other mutate or generate tool
  marks the run as generation output (`run.jobWrites`), and its result is merged
  whole; a run with only `edits` tools settles as its recorded commands, which the
  editor applies as one undo step. Do not push to `job.scenes`/`job.*Overlays` from
  an `edits` tool: a write the commands do not carry never reaches the editor.
- **An edit-only run saves its commands, not its projection.** `persist()` hands it
  to `edit-rebase.ts`, which executes the commands onto the latest saved version:
  only the ones that version does not yet hold (its `agentEdit` marker counts
  them), and, when someone saved since the run's `baseRevisionId`, only after the
  clips they write are fenced against the run's base fingerprints. A conflict
  writes nothing and is recorded on the run (`commandConflict` on the wire). Never
  write an edit-only run's `agentTimelineDoc` over the latest version.
- The agent does not own `materials` on the storyboard document — it READS them to
  generate. `persistence.ts` carries them forward from the prior document, like
  captions and pacing devices.
- TTS resolves through the provider registry, in `lib/tts-synth.ts` and nowhere
  else. The route, the chat agent and the sample baker all go through it, so no
  surface can resolve a different provider than the others. There is no
  `MALEO_TTS_PROVIDER`: the choice is a stored setting written through
  `PUT /api/capabilities/tts/provider` — the one endpoint every capability's
  choice goes through — and a second mechanism would be one that surface could
  not report. Canvas TTS is gone — it was the enqueue-and-poll call
  into the maleo-image service that forced a second dispatcher to exist.
- **A provider never reads `process.env` for its own configuration.** It resolves
  through the seam installed by `lib/provider-config-source.ts`, which is what
  lets a value stored in settings reach a provider at all — and lets the media
  worker, which holds no database, resolve the same values over
  `GET /internal/config`. That endpoint serves DECRYPTED credentials: it is
  mounted outside the CORS-bearing `api` app, refuses every request when no
  `MALEO_SERVICE_TOKEN` is configured rather than defaulting open, and serves
  only keys a provider declares. Text and media providers reuse the shared
  process-local configuration source.
- **A capability's provider choice is written in exactly one place.**
  `PUT /api/capabilities/:id/provider`, via `setActiveProviderFor`. The
  `/api/settings/{image,tts,text}-provider` READ projections remain because the
  editor's pickers need catalogue detail the capability list does not carry; the
  writes are gone. For text the model and thinking level travel WITH the provider,
  because they are meaningful only relative to one and a separate write would let
  the provider change while the model still pointed at the old catalogue.
- **A voice list follows what the surface DOES with it.** A surface that BINDS a
  voice into a stored document gets the effective provider's voices only, because
  a voice from a provider that will not run is a failure deferred to render time.
  A surface that only BROWSES or AUDITIONS gets every registered provider's. That
  is why `/api/operations/catalogue` sends both `voices` (effective) and
  `voice_providers` (all) rather than one widened list — `voices` also feeds the
  web app's bound-speaker lookup, which resolves BY BARE VOICE ID, so a union
  there would silently resolve a bound speaker against another provider's voice
  that happens to share an id. Do not collapse the two fields.
- No route, payload field, or client names a TTS provider. `/api/tts/status`
  returns a `providers` list derived from the registry; a per-provider boolean is
  what made adding a provider an edit in every package that rendered one. Voices
  come off `meta.tts.voices`, so `lib/voice-catalogue-source.ts` names no
  provider either.
- Generation spend goes through `lib/metering/meter.ts`. Do not quote a price at a
  call site or call `runBillableOperation` directly — the price table is
  `lib/metering/prices.ts`.
- Image-to-video enters `lib/generation/video-generator.ts` from both route and
  agent. Select Video through existing capability endpoint and
  `media.provider.video`; readiness comes from worker, not API host binaries.
  Submit immutable owned image storage identity to worker, preserving retry keys.
  Sandbox video needs no sandbox flag and records zero spend. Return actual source
  duration and provider/model; keep timeline placement separate and preserve source
  duration through agent document persistence. Fal also executes through worker.
- Reference resolution for a scene goes through `resolveSceneRoster`
  (`@maleo/shared`). Do not re-derive "project selection + scene cast" locally;
  that rule has drifted and shipped bugs twice.
- No auth: token login was removed; the server binds to `127.0.0.1` by default
  (override `MALEO_API_HOST` only behind an authenticating proxy).
- Keep shared schemas and pure logic in `@maleo/shared`; do not duplicate config
  validation here.
- Story plan mutations go through `modules/agents/core/services/storyboard-command-service.ts`
  with stable ids and expected draft revision. Provider work reads one approved
  snapshot; normal approval defaults to review-only duration additions, while
  explicit one-shot generation records automatic extension authority.

## Verification

```bash
cd apps/api
bun run typecheck
bun run test       # Vitest suites; add a file path to run one
bun run test:bun   # suites that need the Bun runtime (*.bun.test.ts)
```

For route behavior changes, also run `bun run api` from the repo root and hit the
route. Tests that touch the DB must set `MALEO_DB_PATH` to a temp file —
`scripts/test-db-guard.ts` throws if a test points at the real database.

## Collections

File-based visual references live under
`data/workspaces/<name>/collections/<slug>/<item-id>/` (or the equivalent path
inside `MALEO_DATA_DIR`). Routes are in `src/routes/collections.ts`; storage
helpers are in `src/lib/collection-files.ts`.

## Directory map

- `src/AGENTS.md` — routes, runtime libs, the chat agent, generation contracts.
- `docs/` — package-local references/codemaps. Root `docs/AGENTS.md` style rules apply.
