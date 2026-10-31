# apps/api/src — agent instructions

## Purpose

Owns the content-studio HTTP surface, the server-side chat agent, generation
(image, voice, video) and the metering that bills it.

## Ownership

- `index.ts` boots Bun/Hono server and mounts routes.
- `routes/` owns HTTP contracts and request/response shaping.
- `middleware/` owns the HTTP enforcement glue the dispatch and routes apply:
  perimeter admission (`admit`, called first in `index.ts`), the CORS allowlist,
  `instanceOwnerOnly`, and the test-caller seam. Identity, sessions and the
  exempt-path list itself live in `@maleo/auth`.
- `lib/` owns workspace/file IO, service clients, and text-provider adapters.
- `lib/content-generator.ts` owns content drafting and story frame, skeleton,
  draft, style, and Story Bible authoring. `lib/story/creative-director.ts`
  owns whole-sequence editorial direction; `lib/story/image-director.ts`
  authors one structured visual intent per measured or silent beat.
- `lib/ai-provider/` owns text-provider contracts, selection, and adapters (API-backed only).
- `lib/workspace/` owns workspace config, registry, paths, scaffold, and branding.
- `modules/agents/core/` owns the agent: its run service (`service.ts`), its Mastra
  runtime and durable host (`runtime/`), its tools, workflows' stages, and the
  run's product record and persistence.
- `modules/agents/mcp-servers/` owns a workspace's external MCP servers;
  `mcp/` owns the MCP server clients connect to.
- `lib/generation/` owns the image job kernel and billed TTS.
- `lib/metering/` owns the price table and the one metered spend path.

## Local Contracts

- Keep routes thin. Heavy logic, DB access, file IO, and external service calls
  belong in `lib/`.
- The API's own origin comes from `lib/dashboard-origin.ts`
  (`dashboardOrigin`/`absoluteDashboardUrl`), driven by `MALEO_API_ORIGIN`
  (normalized http(s) origin; fails fast if set-but-invalid; else `localhost:PORT`).
  Build absolute self-urls through it — never hardcode `http://localhost:${PORT}`.
  The image worker's reference-fetch allowlist must point at this SAME origin, so
  reference images resolve in container/remote deployments.
- JSON contracts returned by routes must stay aligned with client fetch helpers
  and page expectations.
- The operations/routines/tool routes are tightly coupled to the unified runtime
  schema in `@maleo/db`. Every table and column is declared there — never
  create a table or ALTER-add a column outside `unified-schema.ts`, because the
  column reconcile and the `content_projects` rebuild read that declaration and
  drop what it does not know about.
- Content-project routes under `routes/operations.ts` own the content-first API
  surface: projects, storyboards, references, renders, outputs, project events,
  and content assets. Keep DB helpers, route payloads, and client consumers
  aligned together.
- Campaign payloads prefer project/output-derived metrics for pipeline and queue
  summaries.
- `/api/tts/generate` returns the stored audio URL plus measured duration when
  available; editor timeline regeneration depends on that duration to ripple
  later clips instead of trimming fresh voiceover.
- `/api/credits` owns local credit balance, usage ledger, reservations, and
  daily/rolling-window limit checks. Keep pricing math pure in `@maleo/shared`;
  keep DB mutation/audit trail in `lib/credit-service.ts`.
- `/api/settings/image-provider` exposes the `@maleo/media` image-provider
  registry and persists its app-global override in `global_settings`. New
  durable image requests must carry that override as `provider_id`; env remains
  fallback only when no global selection exists. Explicit global/env selections
  fail loudly when stale or unhealthy; never silently substitute a different
  provider.
- Every chat run snapshots an `outcomeContract` before planning. Build completion
  requires a deterministic `outcomeEvaluation` with no blocking content, visual,
  duration, evidence, or timeline findings; blocked runs settle as
  `needs_attention` with structured scoped fixes. Tool args and results are
  strict runtime contracts. Persist tool intent before any provider call and
  preserve replay/idempotency plus versioned artifact lineage.
- `GET /api/operations/projects/:id/trace` is the creator audit/readiness surface:
  keep durable outcome coverage, artifact versions, quality metrics, tool
  cost/latency, and operator feedback aligned with workflow-run storage.

## Work Guidance

- Prefer shared validators/helpers from `@maleo/shared` for config rules.
- When renaming runtime fields, update `lib/`, matching `routes/`, and client
  consumers in same pass.
- Prompt execution goes through `lib/text-runner.ts` on the selected API-backed text provider; never spawn a CLI for text.
- Longform narrated video is narration-first AND plan-first: `plan_longform` scripts sections and automatically runs topic-matching research for factual briefs before prompting the planner. The user reviews/edits (`update_section`) and approves (`generate_longform_assets`), then per section voice → measure real duration → local Whisper captions when `MALEO_CAPTION_TRANSCRIBE=1` → image (image duration = measured audio), `placeSections` resyncs downstream starts. Word counts are planning hints; measured audio is source of truth. New synthesis records explicit caption provenance and creates canonical timeline cues through shared commands. Script-assisted timings and estimated timings remain distinct; stored historical voiceover words are not backfilled. Whisper inference, setup and cache belong to the media worker. Settings uses `GET/POST /api/settings/captions-*`; imported-media caption jobs use project `/captions/jobs` submit/poll/cancel routes. Run `bun run --cwd apps/media-worker captions:setup` on the execution host. Caption correction and source synchronization use Rust commands; source changes never rewrite protected transcript edits. Expansion targets ±5% of goal, capped at 3 passes. `longform_plan` persists `planningBrief`, factual intent, and `researchKey` so later-job expansion uses original approved context rather than mutable project brief. Current sections solely determine aggregate `verificationStatus` and citation coverage; replacing factual plan clears stale verification. Exact normalized quote presence means evidence matched, not independent fact-checking. `improve_section` is the default user-facing section redo: keep audio/timing/captions, use the existing clip as reference/fallback, regenerate only improved visual(s), then resync. `regenerate_section` remains a hard redo/retry path.
- Longform style retry routes through the registry `generate_style` tool: style/gaya retry commands update only the existing `longform_plan.visualStyle`; they must not re-plan sections or generate assets.
- **Factual web research (BrowserOS)** — `lib/browseros-mcp.ts` + `lib/web-research.ts`. Chat exposes only `search_web`, `read_web_page`, and `research_topic`, never raw BrowserOS controls. MCP wrapper permits only `tabs:new/close`, `read` for client-owned page ids, and genuine web-search tools; list/snapshot/grep/diff/wait/navigate/action tools are refused. `web-research.ts` runs topic plus chronology, causes, primary-evidence, and academic-analysis queries, interleaves hits, diversifies domains, reads a bounded candidate pool until valid-source cap is filled, and applies public-URL/final-origin validation plus excerpt caps. Search titles/snippets and page text remain untrusted data; only safe source URLs enter ReAct transcript. Config: `BROWSEROS_MCP_URL` (default `http://127.0.0.1:9000/mcp`) and optional `BROWSEROS_SEARCH_TOOL`. Research bundle fingerprints actual topic. BrowserOS unavailable or evidence insufficient yields honest partial/unverified plan. Settings: `GET /api/settings/research-status`.
- **Research hardening invariants** (don't regress): (1) `callAllowedTool` enforces capability, argument, and owned-page policy; only pages opened by same client may be read/closed. (2) SSRF is re-checked after redirects; missing, malformed, or unsafe BrowserOS final-origin marker fails closed. (3) Automated/manual reads share ≥120-character evidence threshold; citations use final URL. (4) Search titles/snippets and page text never enter ReAct transcript. When page extraction fails but safe public search hits include useful snippets, `researchTopic` may keep those URLs as weak fallback references rather than reporting no sources. (5) Plan `researchKey` controls persisted-bundle reuse and expansion; changed plan topic triggers fresh research. (6) Planner citations require `{url, quote}` exact excerpt match; UI calls this evidence matching, not fact verification. (7) Run dedicated BrowserOS profile with no logged-in sessions/cookies.
- The chat agent (`modules/agents/core/` + `lib/content-generator.ts`) is the single generation path, and it serves video projects only. Image and text projects are retired: they stay editable by hand, `POST /projects/:id/chat` refuses them with `unsupported_content_type`, and `buildAgentJob` throws `UnsupportedContentTypeError` for them, so MCP reads, edits and `run_agent` refuse them too. Project create and patch accept only `video`. `startAgentJob` dedups one running job per project (initial-run safety); `GET /projects/:id/chat` returns that running job so a reloaded client re-attaches instead of starting a second run. Persisted storyboard shape is per type: video → schemaVersion 2 clips; legacy image → `{ slides[] }` and text → `{ posts[] }`, saved only by hand.
- The agent is one Mastra agent for video
  (`modules/agents/core/runtime/agent.ts`); it is offered `plan_story` and
  `generate_story_assets`, and its instructions live in
  `runtime/instructions.ts` (pinned to the tools by
  `prompt-registry-drift.bun.test.ts`). There is no intent classifier: choosing a
  tool or workflow is the classification. Do not add a second loop, a decision
  parser, or keyword-regex routing.
- Builds run as workflows (`runtime/workflows/`), each stage a step through the
  pipeline runner (`modules/agents/core/pipeline.ts`). Video planning
  (`plan_story`) drafts the plan and may park on a clarification; generation
  (`generate_story_assets`) parks on the plan gate with `Approve`,
  `Approve all`, `Research again` and `Reject`, and generates from the plan the
  user approved. A gate is a step suspension; the answer resumes it on
  whichever worker picks it up.
- Generation call path: Mastra workflow owns resume and approval suspension;
  pipeline stage owns artifact scope and tool invocation; tool executor owns
  validated, replayable tool runs; planning service calls the Creative Director;
  story-assets service measures voice then calls the Image Director. Direct
  `generate_frame` builds `ImagePromptIntent` from scene fields and project
  Visual/Rules. `@maleo/shared` composes story beat intents, and `@maleo/media`
  compiles provider text after provider selection. A story beat without authored
  intent fails before image submission; a malformed intent fails in the worker
  instead of falling through to raw prompt text.
- Targeted `update_*`/`remove_*` operations against existing scenes and
  longform `update_section` are proposed through the pipeline and must park for
  approval before mutating. Storyboard writes persist `unit_lifecycle` metadata
  for beat/section units; keep that metadata in sync when adding new content
  unit types.
- Agent animation is keyframes, never a bespoke motion field: `set_keyframes`
  writes one property track (clip-local seconds, registry properties from
  `@maleo/shared` `animation-properties.ts`) that the timeline shows as ordinary
  keys. A scene target keys its primary visual, because a job scene's own
  `layout` is not projected into the document. Until
  `move-agent-tools-to-editor-commands` lands, the track rides the job and the
  usual agent merge rather than a `clip.setKeys` command.
- Agent motion design is a composition of retained primitives, never free code:
  the model writes a motion intent, and `compileMotionClips` (`@maleo/shared`)
  writes every key as one timeline clip per layer. `add_motion_design` and story
  generation share `lib/motion-author.ts`. Text layers quote the source text only.
  Generated motion clips use the beat's reserved id range (`motionIdBase`).
- Agent-generated text overlays use reserved ids; rebuild/regenerate flows may
  replace those auto overlays but must preserve user-authored clips. A number a
  video must show goes into native on-screen text; never invent comparison rows
  or values. Legacy short-form editorial artifacts are migration-only.
- Video outcome evaluation includes deterministic viewer-attention findings.
  Sustained overload, competing primary overlays, and unreadable text block
  completion alongside duration, evidence, visual, and timeline failures.
- Chat-agent input gates are action-scoped: question/approval cards carry the
  current `pendingActionId`, `/answer` rejects stale action ids, and `/cancel`
  marks the run terminal on the product record, after which every tool call of
  that run is refused (`modules/agents/core/service.ts`).
- Agent-authored storyboard snapshots must carry client-owned project references,
  captions and pacing devices from the latest version. Never
  let an intermediate generation snapshot reset editor selections on reload.
- Agent-facing Remotion clip generation must output structured JSON clips only (`startSec`, `durationSec`, layout, typed payload). Never ask the model to generate JSX, CSS keyframes, or ad hoc animation code for project content.
- Image generation is style-locked: every generated frame must use either the
  selected global style reference image or a generated `style_bible` artifact.
  Manual `generate_frame` and `generate_longform_assets` must stop before image generation if no style lock
  can be produced. Reuse the persisted `style_bible` across reloads/runs.
- Global timeline templates live in `content_timeline_templates`, never under a
  project. The selected id persists in project editor settings. Planning may keep
  an initial snapshot, but approved asset generation must refresh the currently
  selected global template, then freeze that version for the generation pass.
  Template policy controls section-intro motion preset, intro entry SFX, generated
  data overlays, render background, image guidance placeholders, and referenced
  global assets. Image guidance supports `{{project.brief}}`,
  `{{section.title}}`, and `{{section.narration}}`; mentioned global refs must be
  copied into project-local media when selected. New video defaults to 60s when
  no duration is given and accepts narration-first targets down to 5s.
  Section entry SFX uses the exact template asset URL when selected, or resolves once from a descriptive cue for legacy templates,
  and repeats unchanged at every section. Scene entry SFX plays only at internal
  shot changes; opening and the first shot of each section keep section SFX only.
  Static movement replaces generated camera moves. A checked scene-transition
  override locks every generated transition so automatic transition sync cannot replace it.
  The template preview route resolves that same cue to playable stock audio; an
  unavailable provider returns no audio instead of a fake sound.
  Template timing owns per-section lead-in silence, sentence and planned-sub-section voiceover pauses, max visual-beat duration,
  max measured voiceover-segment duration, title duration, SFX volume/offset, and the additional section gap.
  Longform narration first follows planned sentence/cue groups, then packs semantic text units before TTS.
  If measured output exceeds the template limit, discard that generated file and recursively re-synthesize
  smaller sentence/clause/word units. Never create estimated speech in-points: each accepted generated clip
  plays one whole source file with `mediaStartSec=0` and equal source/play durations. Legacy oversized files
  remain whole in the editor; the next longform asset pass detects their estimated windows, preserves images,
  and re-voices narration before rebuilding captions and visual timing.
  Technical/clause-only units remain continuous; sentence units use the
  short sentence breath, planned narration beats use the longer sub-section
  breath, and section gaps remain longest. Visuals hold and captions stay silent
  while music continues through each inserted gap.
  Visual beats split independently from voiceover windows and carry the exact narration
  beat as timing metadata, not as provider-facing image prompt text. Persist narrated `contentDur` separately because section lead-in/gap holds may extend
  the total scene duration. Static movement disables camera motion only; visual cuts still obey max visual duration.
  Generated longform clips use reserved semantic lanes: voiceover,
  SFX, music, intro motion, then data. Section-title overlays use stable ids.

## Verification

```bash
cd apps/api
bun run typecheck
bun run test       # Vitest suites; add a file path to run one
bun run test:bun   # suites that need the Bun runtime (*.bun.test.ts)
```

Then `bun run api` from the repo root.

Hit touched route or flow manually after boot.

## Directory map

- `routes/` — API entrypoints and HTTP contracts.
- `middleware/` — perimeter admission, CORS, instance-owner guard, test caller.
- `lib/` — runtime helpers, DB/file IO, service clients, scheduler, engine adapter.
- `index.ts` — Bun/Hono composition root.
- `lib/prompts/` owns prompt templates, their constants, formatters and response
  contracts. A planning prompt is a template there and renders only through
  `renderPrompt`; do not build its text in TypeScript, copy a constant into it,
  or add a second renderer. A new model request names its response contract. See
  `apps/api/docs/agent-pipeline.md` ("Prompt templates").
- `modules/agents/core/engine/` owns the workflow engine: operation, fact and rule
  registries, the flow record on `job.run.flows`, stage contracts on `call`.
  Workflow definitions are data; conditions read only input, flow state, facts
  and rules. An operation declares every prompt, tool and capability it uses —
  `lib/capability-scope.ts` refuses an undeclared one at the chokepoint. See
  `apps/api/docs/agent-pipeline.md` ("Workflow engine").

Video export history resolves authorized projects in bulk before worker paging.
`lib/video-exports.ts` owns title search, project attribution, project discovery,
and changed-state reconciliation. Worker status is authoritative. Discovery
never submits or retries work, including jobs without browser-created links.
