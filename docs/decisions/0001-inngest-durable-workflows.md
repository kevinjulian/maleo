# ADR 0001: Inngest for durable agent runs and generation jobs

- Status: Accepted; the chat agent loop and its granular driver described here are superseded by [0006](0006-the-agent-runs-on-mastra-with-api-models.md)
- Date: 2026-07-11
- Deciders: Kevin Julian

## Context

The chat-agent runs a server-owned ReAct loop (`agent-orchestrator.ts`,
`MAX_STEPS = 24`). The model brain is a Codex subprocess (`agent/codex-runner.ts`,
`Bun.spawn(["codex", "exec", ...])`) invoked once per step as a decider; the
server executes the chosen tool, persists the storyboard, and loops. Long,
side-effecting generation (image, TTS via Gemini Canvas, render) runs out of
band in a SQLite-backed worker queue (`packages/image/jobs.ts` + `queue.ts`).

Two durability holes surface once we deploy to Coolify and move toward a
multi-tenant SaaS:

1. Agent run state lives in an in-memory `Map` (`const JOBS = new Map()`), with a
   fire-and-forget `void (async () => runLoop(job))` bracket. It survives a
   browser refresh (server-side) but not a process restart. A Coolify redeploy
   or crash loses every in-flight run mid-loop.
2. The generation queue is SQLite on local disk. Durable across restart but
   single-host (no multi-instance), with no retry/backoff policy and a terminal
   `markFailed` (no automatic retry, no idempotency key).

We want crash-safe agent runs, a durable human-approval gate (the pipeline
already models `awaiting_approval`), retryable generation, and a path to
horizontal scale — without hand-rolling a workflow engine (the failure-handling
design in our own notes is essentially a re-implementation of Temporal/Inngest).

## Decision

Adopt **Inngest** as the durable execution layer.

- Keep the existing tool layer as-is: `agent/registry.ts`, `agent/types.ts`
  (`ToolContext`), `agent/codex-runner.ts`, tool handlers, `agent/mcp.ts`.
  Inngest does not touch tool calling.
- Move the agent ReAct loop into an Inngest durable function: each loop iteration
  becomes a memoized `step.run`, so a redeploy/crash resumes from the last
  completed step instead of restarting the Codex loop from zero. The `ask_user`
  pause (`resumeAgentJob`) and the pipeline approval gate become
  `step.waitForEvent`.
- Migrate the image/TTS generation queue to Inngest functions (retry, backoff,
  idempotency, per-key concurrency) in a later phase. Until then the SQLite queue
  stays.
- New workspace package `@aincer/inngest` holds the client, event schemas, and
  function definitions. The dashboard serves the sync endpoint at
  `/api/inngest` via `inngest/hono`.

### Runtime / transport note

Inngest is push-based: the Inngest server invokes our functions over HTTP at
`/api/inngest`. The server must be able to reach the app. Therefore we
co-locate Inngest with the app per environment (see topology). We do not run a
remote Inngest against a local app.

## Dev / prod topology

Dev — everything local, Inngest is one in-memory binary, zero infra:

```
localhost:
  dashboard (bun --hot, :8090)  serves /api/inngest
      spawns codex exec (local) + calls image server (local, Gemini Canvas)
  inngest-cli dev  (single binary, in-memory state, dashboard :8288)
      discovers + invokes functions over HTTP at :8090/api/inngest
```

Run: `bunx inngest-cli@latest dev -u http://localhost:8090/api/inngest`

Prod — everything on Coolify, same project/network so Inngest can reach the app
by internal DNS:

```
Coolify project:
  dashboard app        (Bun; hosts /api/inngest; codex binary + CODEX_HOME mounted)
  inngest-server       (orchestrator + dashboard)
  postgres             (Inngest durable state)
  redis                (queue backend)
```

Function code in `@aincer/inngest` is identical across environments. Only
`INNGEST_BASE_URL` / event-key env differs.

## Alternatives considered

| Option                                 | Type              | Why not (for us)                                                                                                                                                                              |
| -------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Temporal                               | Workflow engine   | Heaviest ops (cluster + DB + separate workers). TS SDK leans on a Rust core + Node internals; Bun compatibility risky, could force a split Node runtime. Overkill now.                        |
| Restate                                | Durable execution | Lightest ops (single binary), HTTP-served (Bun-friendly), but youngest/smallest community for load-bearing infra.                                                                             |
| BullMQ                                 | Queue (Redis)     | Not a workflow engine: no step memoization, resume, or waitForEvent. We would hand-roll the ReAct durability + approval gate — the anti-pattern this ADR avoids. Fine for the gen queue only. |
| pg-boss / Graphile Worker              | Queue (Postgres)  | Postgres-only, lightest add, but same limitation as BullMQ: queue, not workflow. Kept as the documented fallback.                                                                             |
| Stay hand-rolled (SQLite + in-mem Map) | —                 | The status quo. In-mem loop dies on redeploy; SQLite blocks multi-instance; no retry policy.                                                                                                  |

Decisive factors: Bun-native (HTTP-served functions, no runtime lock), durable
loop + `waitForEvent` out of the box, per-key concurrency for future
multi-tenant limits, and the lightest dev story of the workflow engines (one
in-memory binary vs "stand up a DB first").

## Consequences

Positive:

- Agent runs survive Coolify redeploy/crash; resume from last completed step.
- Approval gate and `ask_user` pause become durable (`waitForEvent`).
- Retry/backoff/idempotency/concurrency for generation without bespoke code.
- Path to multi-instance (Inngest dedupes) for the SaaS phase.
- Dev DX: one binary, in-memory, local run inspector with step replay.

Negative / costs:

- Prod adds three services on Coolify: inngest-server + Postgres + Redis.
- Codex step can run ~120s; function/step timeout must exceed it (config parity
  dev and prod).
- Step return payloads have size limits: functions return small pointers
  (jobId/clipId); large artifacts stay in DB/storage. The loop already persists
  the storyboard after each step, so this aligns.

## Implementation history

The phased rollout notes that used to live here were moved to
[`history/0001-implementation-log.md`](./history/0001-implementation-log.md).
