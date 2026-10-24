# maleo monorepo — agent instructions

## Authority chain

Each kind of guidance has exactly one owning file. Read the owner, not a copy.

```text
README.md             quickstart: install, set up, start
CONTRIBUTING.md       human participation and the release workflow
AGENTS.md             agent workflow and repo-wide constraints
openspec/             proposals, specs, tasks, acceptance, closeout
docs/development.md   run, verify, runtime data, master key — locally
docs/self-hosting.md  operate a deployment: env, media store, backup, recovery
docs/coolify.md       deploy on Coolify
docs/decisions/       accepted architecture decisions only
docs/CODEMAPS/        current architecture maps only
<pkg>/AGENTS.md       local rules only
```

Before editing a package or app, read this file, then the nearest
`AGENTS.md` above the path you are touching if one exists. Where rules overlap,
the closer file wins on local detail and this file wins on repo-wide rules.

There is no hierarchy index to maintain. Do not add one.

## Planning and task tracking

**OpenSpec is the only planning and task-tracking workflow in this repository.**
Do not use markdown TODO lists, external issue trackers, or a second task system.

Start an OpenSpec change when the work touches product direction, the HTTP API,
the database schema, persistence, workflow, the timeline or editor UI, or
architecture. A focused bug fix that preserves the existing design does not need
one.

An OpenSpec change owns the whole lifecycle:

- `proposal.md` — why, what changes, and the affected capabilities
- `specs/<capability>/spec.md` — requirements and scenarios
- `design.md` — decisions and rejected alternatives, when the change needs them
- `tasks.md` — the implementation checklist and the proof for each task

Work the tasks in order, tick each box as it lands, and record the proof named
in the task. When implementation turns up work outside the current scope, add it
as a new task or a separate OpenSpec change — never as a comment that gets lost.

```bash
openspec list                       # active changes
openspec status --change "<name>"   # artifacts and progress
openspec validate "<name>" --strict # before proposing implementation is done
```

Use the OpenSpec skills as the default lifecycle:

1. `openspec-explore` — investigate and shape the change without editing
   implementation.
2. `openspec-propose` — create the proposal, design, delta specs, and tasks.
3. `openspec-apply-change` — implement tasks, tick them off, and record proof.
4. `openspec-archive-change` — close out a completed change.

Before using `openspec-archive-change` or running archive commands, ask the user
for explicit confirmation. During archive, assess delta specs and use
`openspec-sync-specs` when the accepted requirements need to be merged into
`openspec/specs/`; the archive flow normally asks whether to sync before moving
the change into private historical record.

## Workspace map

| Path                   | Name                   | Purpose                                                                                                                           |
| ---------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`             | `@maleo/web`           | content-first web UI                                                                                                              |
| `apps/api`             | `@maleo/api`           | content-first HTTP API, chat agent, generation + metering                                                                         |
| `packages/auth`        | `@maleo/auth`          | operator identity: sessions, API keys, registration policy, request perimeter                                                     |
| `packages/db`          | `@maleo/db`            | unified runtime database modules                                                                                                  |
| `packages/shared`      | `@maleo/shared`        | pure shared types + logic                                                                                                         |
| `packages/inngest`     | `@maleo/inngest`       | shared durable execution client and event schemas                                                                                 |
| `packages/media`       | `@maleo/media`         | content-generation provider abstraction and media worker runtime                                                                  |
| `apps/media-worker`    | `@maleo/media-worker`  | thin deployable shell for `@maleo/media` worker                                                                                   |
| `apps/render-worker`   | `@maleo/render-worker` | Remotion render server: job queue, local and Lambda renders                                                                       |
| `infra/kokoro-tts`     | —                      | Dockerfile that builds and deploys the Kokoro-82M TTS server                                                                      |
| `infra/pocket-tts-id`  | —                      | Dockerfile + server that deploy the Pocket TTS Indonesian voice-cloning service                                                   |
| `infra/searxng`        | —                      | Dockerfile + config that deploy the SearXNG metasearch instance research retrieval searches through                               |
| `infra/crawl4ai`       | —                      | Dockerfile + config that deploy the Crawl4AI instance research retrieval extracts pages with                                      |
| `packages/video`       | `@maleo/video`         | Remotion compositions, schema and storyboard preparation (library)                                                                |
| `packages/stock`       | `@maleo/stock`         | stock media lookup                                                                                                                |
| `packages/storage`     | `@maleo/storage`       | media object storage: local filesystem or S3-compatible store                                                                     |
| `deploy`               | —                      | compose stack for the deployed core: web, api, media worker, Postgres, media store, Inngest                                       |
| `crates/editor-core`   | `maleo-editor-core`    | Rust editor command engine shared by every controller (web editing and API agent commands execute through its WASM binding)       |
| `crates/renderer`      | `maleo-renderer`       | Rust frame renderer (parley + vello on wgpu) drawn from the render storyboard, held at parity with Remotion by a golden corpus    |
| `crates/renderer-wasm` | `maleo-renderer-wasm`  | browser build of the renderer and the preview session (`wasm-bindgen`, ADR 0011), loaded only by the editor's hidden compare mode |
| `crates/preview`       | `maleo-preview`        | host-free preview session: playback clock, frame scheduler, preview states and the platform adapter interfaces                    |
| `spikes`               | —                      | throwaway P0 proof code (gpui + wgpu, Kotlin Multiplatform bindings); outside the Cargo workspace and CI                          |

`apps/` holds deployables built from maleo source; `infra/` holds deployables
that only configure third-party software (a Dockerfile over an upstream image, a
settings file) and never carries a `package.json`; `deploy/` holds the compose
stack that assembles the maleo images into the deployed product.
`crates/` holds Rust crates built by the root Cargo workspace (`cargo test`); Bun
remains the toolchain for every TypeScript workspace.

Packages, apps, infra, and deploy directories with their own `AGENTS.md`: `db`, `api`, `apps/web`,
`auth`, `inngest`, `media`, `storage`, `video`, `shared`, `apps/media-worker`, `apps/render-worker`,
`deploy`, `crates/renderer`,
`infra/kokoro-tts`, `infra/pocket-tts-id`, `infra/searxng`,
`infra/crawl4ai`.

## Running

From repo root:

```bash
bun run api                     # HTTP API
bun run web                     # web UI :3030
bun run dev                     # local stack; media-worker joins when MALEO_GEN_WORKER_URL is set
bun run media-worker|render-worker|video  # individual worker or Remotion Studio
bun run check                   # fast, partial contributor gate
bun run ci                      # full gate, including browser visuals
bun run typecheck               # all workspaces
```

**Do not use `bun run --filter <pkg> <script> <args>`** — bun filter drops
positional args after the script name. The root convenience scripts above cd
into the package/app and run bun directly so args pass through.
Portable tests run on Vitest (root `vite.config.ts`, one project per
workspace); suites whose exercised production code needs the Bun runtime are
named `*.bun.test.ts` and run on `bun test`. `bun run test` runs both; a
workspace's `test` script runs its Vitest project, so
`bun run --cwd <workspace> test <file>` focuses one file, and `test:bun` runs
its Bun suites. A new test is a Vitest suite unless it needs Bun at runtime.
`vp run` schedules the workspaces' build, typecheck and test scripts in
dependency order (`vite.config.ts` sets `run.cache: false`, so nothing is cached).
Focus one workspace with `bunx vp run --filter @maleo/api typecheck`; arguments
after the task name reach the script.

## Environment

- Root `.env` is the single local env file for repo processes. Do not add
  package-local `.env` files under `packages/*` or `apps/*`.
- Package/app dev scripts that need env must load root `.env` with
  `--env-file ../../.env` before importing runtime modules.
- Do not put generic `PORT` in root `.env`. Services use package-specific port
  vars (`MALEO_API_PORT`, `MALEO_WEB_PORT`, `MALEO_MEDIA_WORKER_PORT`,
  `MALEO_VIDEO_PORT`) and may keep `PORT` only as a
  deploy-platform fallback in code.

## Shared package conventions

When adding logic used by more than one package:

1. Put pure types + helpers in `packages/shared/src/`
2. Re-export from `packages/shared/src/index.ts`
3. Keep IO (fs reads, DB writes, fetch, Bun process APIs) local to the
   consuming package

`@maleo/shared` currently exposes: content behavior, image/video policy,
video style/blueprint/editorial, timeline/template/doc/model, creative
direction, credits, and render-storyboard helpers.

## Runtime data

The runtime database is Postgres: `MALEO_DATABASE_URL` in production; in
development an embedded server under `data/postgres` (`MALEO_PG_PORT`). Tests
never touch it; the test preload gives every suite a throwaway cluster.
Workspace configuration is a database row, not a file.

Other shared runtime state lives under `data/`, resolved via `MALEO_DATA_DIR`:

- embedded development cluster: `data/postgres/`
- runtime skill library: `data/skills/*.yaml`
- generated/local runtime artifacts under the owning data subtrees

`data/maleo.db` (`MALEO_DB_PATH`) is the pre-Postgres SQLite file, read only
by `bun run db:migrate-from-sqlite` and legacy maintenance scripts.
**Never commit new secrets, local DB snapshots, generated media, or other
user-specific runtime artifacts.**

## Verification (run before declaring work done)

Do not report a change complete until it has been verified. Verify the code,
do not just trust that it reads correctly.

1. **Typecheck** — always, after any code change:
   ```bash
   bun run typecheck            # all workspaces
   ```
2. **Tests** — run the relevant package's tests; full suite for cross-cutting
   changes:
   ```bash
   bun run test                 # all workspaces
   bun run --cwd apps/api test src/path/to/file.test.ts
   ```
3. **Repository gates** — after touching docs, versions, or workspace layout:
   ```bash
   bun run check:version
   bun run check:references
   ```
   Before declaring cross-cutting work done, run the whole gate in one command:
   ```bash
   bun run ci            # exact CI gates, including visual regression
   ```
4. **Static checks** — `bunx vp check` formats-checks, lints and type-checks the
   whole repository; `bun run check` runs it with the version, reference and
   workspace `tsc` gates. Every enabled rule fails on any finding anywhere, not
   only on the lines you changed. Fix findings in the code, never with a
   suppression comment.

   **A rule earns its severity from a sample, not a count.** Before enabling,
   scoping or retiring a rule, read enough of its violations to know its
   true-positive rate, and record that sample beside the decision in
   `oxlint.config.ts`. A count says how loud a rule is; a sample says whether it
   is right. Two rules here fire mostly on correct code — one is a substring
   match that flags Zod's own `.shape` property — so "drive the count to zero"
   is not a goal, and a rule that does not fit is turned off with its reason
   rather than left warning forever.

5. **Run it** — for behavior changes, actually exercise the surface:
   - API: `bun run api`, hit the route; UI: `bun run web`
   - media: start the server, curl `/health`
6. **New behavior needs a test** — add or update a test case before considering
   the change done; fix the implementation, not the test.

If a step fails, fix it and re-run. Report failures with the actual output;
never claim green without running the check.

Static tests do not prove a UI surface is reachable. For changes to interactive
surfaces, open the app and drive the changed control before calling it done.

## Documentation rules

- Update the owning doc in the same pass as the change, or say why not.
- `docs/decisions/` holds accepted architecture decisions only, and the bar is
  high — see `docs/decisions/README.md` before adding one.
- `docs/CODEMAPS/` describes the current shape, not aspirations. It is not a
  task log, release process, or contribution policy.
- Delete stale text instead of layering caveats on it.
- A user-facing or contributor-facing change adds a `CHANGELOG.md` entry under
  `Unreleased`. See `CONTRIBUTING.md` for the exempt categories.

## Commit and release

Lowercase conventional commits: `feat`, `fix`, `refactor`, `chore`, `docs`,
`perf`, `test`, `ci`. No emojis. For changes spanning several workspaces, prefer
one atomic commit.

One canonical version lives in root `package.json`, with one `CHANGELOG.md` and
one annotated `vX.Y.Z` tag per release. Release steps are in `CONTRIBUTING.md`.
Do not bump the version as part of a feature change; releases are cut
separately.

## Skills

Reusable workflows live in `.agents/skills/<name>/SKILL.md`. Read
`.agents/skills/coding-style/SKILL.md` for repo-specific conventions before
non-trivial work.

## User preferences

Any written output:

- always use .agents/skills/asd-ste100/SKILL.md for standard.

Durable behavior preferences the user has asked for:

- Narrated video pacing uses semantic silence: technical/clause-only VO splits
  stay continuous, sentence boundaries get a short breath, planned sub-sections
  get a longer breath, and section boundaries keep the longest gap. Visuals hold,
  captions stay absent, and music continues through those gaps.
