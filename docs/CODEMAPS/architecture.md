<!-- Generated: 2026-09-09 -->

# Architecture

## Runtime

```text
web (:3030) ──HTTP──> API (:8090) ──Postgres──> @maleo/db
                         │
                         ├──events/functions──> Inngest (:8288)
                         │                         │
                         │                         ├──> API /api/inngest (agent-run)
                         │                         └──> media-worker /api/inngest (generation-run)
                         │
                         └──@maleo/media/api──> media-worker (:7071)
                                                   └── image + TTS providers/files

API + web + media + video ──pure contracts──> @maleo/shared
```

## Ownership

| Path                | Role                                                               |
| ------------------- | ------------------------------------------------------------------ |
| `apps/web`          | Content-studio UI                                                  |
| `apps/api`          | HTTP contracts, workspace IO, chat agent, text providers, metering |
| `packages/db`       | Postgres schema, migrations, and entity-family access              |
| `packages/shared`   | Browser/server-safe types and pure logic                           |
| `packages/inngest`  | Shared client and event schemas only                               |
| `packages/media`    | Image/TTS providers, durable generation function, worker runtime   |
| `apps/media-worker` | Deployable media-worker shell                                      |
| `packages/video`    | Remotion render pipeline                                           |
| `packages/stock`    | Stock-media lookup                                                 |
| `deploy`            | Core compose stack, self-hosted Inngest included                   |

Local `bun run dev` launches standalone `.bin/inngest`; `deploy/` is
production infrastructure, not local process wrapper.
