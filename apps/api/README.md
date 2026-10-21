# @maleo/api

The content-first HTTP API: projects, storyboards, references, generation,
rendering, and metering. Bun + Hono.

The web client that consumes it is `apps/web`.

## Running

From the repository root:

```bash
bun run api
```

Configuration comes from the root `.env`. There is no package-local `.env`.
See [docs/ENV.md](docs/ENV.md) for the variable reference.

No login is required. The server binds to `127.0.0.1` by default; override
`MALEO_API_HOST` only behind an authenticating reverse proxy.

## Layout

| Path                     | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `src/routes/`            | Hono route modules, one per domain                                                 |
| `src/routes/operations/` | content project routes: projects, storyboards, references, renders, assets, events |
| `src/lib/`               | server libraries, the chat agent, metering                                         |

## Docs

| File                                             | Purpose                                     |
| ------------------------------------------------ | ------------------------------------------- |
| [docs/API.md](docs/API.md)                       | HTTP endpoint reference                     |
| [docs/ENV.md](docs/ENV.md)                       | environment variable reference              |
| [docs/RUNBOOK.md](docs/RUNBOOK.md)               | deployment, health, common issues, rollback |
| [docs/agent-pipeline.md](docs/agent-pipeline.md) | chat agent pipeline                         |

Repo-wide rules live in the root [`AGENTS.md`](../../AGENTS.md) and
[`CONTRIBUTING.md`](../../CONTRIBUTING.md). Local rules for this package are in
[`AGENTS.md`](./AGENTS.md).

## Verification

```bash
cd apps/api
bun run typecheck
bun run test       # Vitest suites; add a file path to run one
bun run test:bun   # suites that need the Bun runtime (*.bun.test.ts)
```
