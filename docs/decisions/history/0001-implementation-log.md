# ADR 0001: Inngest for durable agent runs and generation jobs — implementation log

Moved out of [`../0001-inngest-durable-workflows.md`](../0001-inngest-durable-workflows.md) so the decision record states the
decision and its consequences, not the sequence of work that carried it out.
Kept verbatim for history. Nothing here is current guidance.

## Open items to verify before implementation

- Confirm current Inngest self-hosted (OSS server) feature parity for
  `concurrency`, `waitForEvent`, and run retention. Some features were
  historically cloud-first. If gaps bite, fall back to pg-boss + a thin durable
  loop rather than Temporal.

## Migration phases

1. DONE — Scaffold `@aincer/inngest` (client, event schemas, function) + serve
   `/api/inngest` in the dashboard + wire the dev binary into `scripts/dev.ts`
   (gated on `AINCER_DURABLE_RUNS`).
2. DONE — Granular durable agent function. The Inngest `agent-run` function
   always drives `prelude -> decide-<n> -> tool-<n> -> resume-<n>` as memoized
   steps through the injected `AgentRuntime` (`granularPrelude`,
   `granularDecide`, `granularExecute`, `granularResume`). The `ask_user` /
   approval suspension (both surface as `awaiting_input`) bridges via
   `step.waitForEvent("agent/input.provided")`.
3. DONE — Producer swap in `routes/operations/generation.ts`: the chat route
   always builds the job deferred and emits `agent/run.requested`; the answer
   route always emits `agent/input.provided` instead of resuming in-process.
   Inngest is required; no durable-run opt-in flag or in-process production
   fallback remains.
4. DONE — Multi-instance durability. Every suspension (`ask_user` now included)
   checkpoints the full job to the DB; `reconstructCheckpointJob` +
   `rehydrateRunById(runId, projectId)` rebuild it; granular runtime methods
   rehydrate-on-miss (`projectId` threaded through the `agent/input.provided`
   event → runtime → route). A parked run answered on a different instance /
   after a redeploy resumes from the DB. The in-memory `JOBS` Map is now just a
   per-process cache, not the source of truth. Covered by an instance-swap test
   that clears `JOBS` before `granularResume`.
5. DONE (flag-gated) — Generation queue → Inngest, in its permanent home.
   `generation-run` function (retry · idempotency=jobId · `concurrency{key:kind,
   limit:1}` · `onFailure`→fail) + `GenerationRuntime` seam in `@aincer/inngest`.
   Hosted by **`apps/gen-worker`** (NOT packages/image): it registers a runtime that
   resolves the selected BrowserOS provider via `@aincer/providers` (image + tts),
   runs it, and records the result in its own SQLite store. gen-worker is a drop-in
   for the legacy image service (`/generate` · `/tts` · `/jobs/:id` · `/files/`); the
   dashboard routes to it via `AINCER_DURABLE_GEN=1` + `AINCER_GEN_WORKER_URL`
   (`image-gen-client.ts`). `dev.ts` launches gen-worker (:7071) + points the Inngest
   dev binary at it. The BrowserOS image flow (`@aincer/media-provider-browseros/image.ts`) is a
   first-cut needing live verification; `packages/image` stays as the default
   fallback until then, after which it is deleted (ADR 0002).
6. SKIPPED (per request) — Coolify prod deploy (compose in
   `packages/inngest/deploy` remains for when it's picked up).

## WP3 — DB-first run model (default-on)

Phase 4 checkpointed only `awaiting_input` suspensions to the event log, and
`getAgentJob` read the in-memory `JOBS` map alone. WP3 makes the DB the source of
truth for the whole run lifecycle:

- New tables (`packages/core/src/core/db/unified-schema.ts`): `workflow_run`
  (with `snapshot_json` = the full serialized `AgentJob`, so ANY status —
  running / awaiting / done / error — rehydrates with full fidelity, not just the
  lossy field-subset the event-log checkpoint carried), plus `step_run`,
  `tool_run`, `run_artifact`, `required_action`.
- Repository `agent/run-repository.ts` bridges `AgentJob` ↔ `workflow_run`.
  `saveRun` snapshots at run birth, every `persist()`, and run-end; session-store
  getters and the durable begin/resume entrypoints fall back to `workflow_run` on
  a cache miss and re-seed `JOBS`. `JOBS` is strictly a per-process cache.
- Every tool call writes a durable `tool_run` row (status / input / output /
  error / artifacts / latency, blobs capped at 8KB) plus an ordered `step_run`
  (idx = loop cursor) — folds in the WP5 first-class-tool-output goal. Not yet an
  idempotency short-circuit: most tools mutate the job in place, so keyed dedupe
  stays a scoped follow-up for pure generate-kind tools.
- Suspensions record a first-class `required_action` (ask_user → `ask_user`,
  approval → `approve`) carrying the question+options payload; the resume path
  resolves it. Durable human-action prompts are queryable, not only implicit in
  the snapshot.
- **Single flow, no flag.** Every agent run is durable and driven through
  Inngest — `AINCER_DURABLE_RUNS` is removed. The chat route always builds the
  job deferred and emits `agent/run.requested`; the answer route always emits
  `agent/input.provided`. If the Inngest server is unreachable the route returns
  502 (durable execution requires it — no silent in-process fallback).
  `scripts/dev.ts` always launches the Inngest dev server. Persistence
  (`saveRun`/`tool_run`/`step_run`/`required_action`) is unconditional. No
  migration — runs are ephemeral; the tables ship empty.
- `runPrelude`, `reactDecide`, and `reactExecuteTool` are the shared loop
  helpers: the Inngest agent-run runtime drives them via granular runtime
  methods, and unit tests may still drive `runLoop` directly in-process via
  `startAgentJob`/`resumeAgentJob`. Those in-process entrypoints are test
  primitives, not a second production path.
- Parity: 95 orchestrator tests pass; full dashboard suite green. Repository
  round-trip + restart-survival + tool_run tests in `agent/run-repository.test.ts`
  and `core/db/workflow-run-db.test.ts`.

## WP5 — First-class tool-call output

Folds into WP3's tables. Every tool call already writes a `tool_run` + `step_run`
(WP3). WP5 completes the read + artifact surface:

- **Read API** (`routes/operations/runs.ts`): `GET /projects/:id/runs` (run list,
  no snapshot blob) and `GET /projects/:id/runs/:runId` (run + steps + tool calls
  - linked artifacts). Read-only; the durable Inngest path owns writes. The live
    chat poll (`/chat/:jobId`) is already DB-backed since WP3 (`getAgentJob` →
    `loadRun` on a cache miss), so the UI renders from the DB; this endpoint adds
    the normalized step/tool/artifact history for a run-detail view. Client
    consumers: `listProjectRuns` / `getProjectRun` in the create-content api.
- **Artifacts** (`run_artifact`): `recordToolRun` persists one row per media thumb
  a tool emits, linked to the tool_run — AI output as a queryable artifact.
- **Idempotency at the generation layer (not the tool wrapper).** A blanket
  tool-level short-circuit is unsafe (tools mutate the job in place), so dedupe
  lives where the billing happens: `generateVideoAssetsFlow` carries over any
  frame already produced for a beat and skips regeneration, and marks the
  blueprint `built` only AFTER frames materialize — so an interrupted run
  re-enters and regenerates ONLY the missing frames instead of re-billing the
  whole set. `tool_run.idempotency_key` + `getToolRunByIdempotencyKey` remain for
  cross-run observability/dedupe tooling.
- **Persistence is best-effort but observable.** A DB write failure never breaks
  the loop (the in-memory job stays authoritative), but it is logged via
  `warnPersistFailure` rather than silently swallowed, so a run degrading to
  memory-only is visible/alertable — the DB-as-source-of-truth guarantee is not
  quietly lost.
- **Approval is unified, no separate event.** ask_user and approval both surface
  as a question with option chips and resume via `agent/input.provided` (the
  answer text encodes the choice, `parsePipelineApprovalChoice`). The redundant
  `agent/approval.granted` schema was removed — nothing produced or consumed it.

## Agent-run durability hardening

- **Function idempotency keyed per emit** (`idempotencyKey` is REQUIRED in the
  schema — an absent value would silently disable dedup). `agentRun` sets
  `idempotency: "event.data.idempotencyKey"`. Start keys on the runId so a
  double-submit collapses to one run; resume keys on `<runId>:resume:<updatedAt>`
  — stable per error-state, so a double-click dedups but a genuine later re-drive
  (new error-state → new updated_at) does not. Complements
  `concurrency{key:projectId,limit:1}`.
- **Answers are scoped to the exact suspension.** Each suspend records a
  `required_action` and stamps its id on `job.pendingActionId` (persisted in the
  snapshot). The granular phase carries `actionId`; the function waits for
  `input.provided` matching `runId AND actionId`, and the answer route emits that
  id. A stale answer for a past question or a double-clicked answer can't satisfy
  the current wait — the wait resolves once, later matching events are dropped.
- **Resume only from error.** `/resume` accepts a run only in `error` (reaped
  stale / abandoned on timeout); `running` (alive — wait or let the reaper flip
  it), `done`, and `awaiting_input` (use `/answer`) are rejected 409. This plus
  the stable-per-error-state key stops a double-click from enqueuing two re-drives.
- **Timeout marks the DB.** When `waitForEvent` times out (user never answered),
  the function calls `runtime.abandon` (memoized `step.run`) → `markRunAbandoned`
  flips the run to error instead of leaving it dangling in `awaiting_input`.
- **Fail-fast in prod.** The client throws at boot if `NODE_ENV=production` and
  `INNGEST_BASE_URL` is unset — refusing the SDK cloud default that would silently
  send events nowhere.

### Replay safety (foundation for granular steps)

- **Atomic cursor advance.** The ReAct loop is a `while` (was a `for`) so
  `state.step` advances + persists ATOMICALLY with each tool's completion. A
  workflow retry resumes at `step+1` and never re-runs (re-bills) a completed
  tool — closing the window where the old `for (...; step++)` persisted the cursor
  as the _current_ step, so a crash after a tool but before the next iteration
  replayed it.
- **Per-tool idempotency key.** Every `tool_run` is stamped with
  `<runId>:step:<idx>:tool:<name>:<argsHash>` (`toolIdempotencyKey`) — the dedupe
  handle the replayable-output short-circuit keys on (see below), plus a unique
  index that rejects a true duplicate.

### Done in the hardening pass

- **Replayable tool output.** `generate_frame` / `generate_slide_image` return a
  structured `ToolReplay { kind, index, url }`; `recordToolRun` stores it, and
  before running a replayable tool the executor re-applies a prior completed
  result (matched by the per-tool idempotency key) instead of calling the
  provider. No double-bill on a replayed step.
- **No double-bill in the shortform blueprint build.** `generateVideoAssetsFlow`
  carries over frames already produced for a beat AND now `persist()`s each frame
  into the snapshot as it lands (not just a heartbeat), so a crash after a
  paid-for frame but before the tool completes keeps the url — a retry regenerates
  only the missing frames.
- **Granular durable steps — only production path.** The ReAct iteration is
  extracted into shared `runPrelude` / `reactDecide` / `reactExecuteTool` in
  loop.ts, so there is one implementation. `agent/granular.ts` drives them; the
  Inngest function runs `prelude` then `decide-<cursor>` / `tool-<cursor>` as
  memoized `step.run`s, bridging each suspension with
  `waitForEvent(runId + actionId)`. A decision is stashed on `run.pendingTool` +
  persisted so the decide→execute hand-off (and a crash between them) survives.
  Deterministic pipeline builds terminate inside `prelude`. Coverage:
  `granular.test.ts` (freeform run + suspend/resume), the durable seam test, and
  the `runGranular` orchestration test (mock step: unique step ids,
  suspend→wait→resume, timeout→abandon, pipeline-terminal).
- **Per-category retry policy.** `retry-policy.ts` — decide/read/plan (bounded,
  read-only) and generate (its own `withRetry` backoff). A bounded `decide` retry
  wraps the codex decision; mutating tools are never retried.

### Deferred (noted, not yet done)

- **Separate `agent/approval.granted` event** for a cleaner audit taxonomy would
  require the granular phase to report its suspension TYPE (question vs approval)
  so the function can wait on the matching event; deferred against the unified-event
  simplicity. The correctness concern (a stale/double answer leaking to the wrong
  wait) is already solved by the `actionId` scoping above — the remaining gain is
  purely analytics/audit taxonomy.
