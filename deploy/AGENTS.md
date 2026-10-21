# deploy — agent instructions

## Purpose

The compose stack that deploys the whole core: web, API, media worker, render worker, the
runtime Postgres and its backups, the media store, and the self-hosted Inngest
server with the Postgres and Redis that hold its durable state. One compose
file, because Inngest is push-based and every one of those services must resolve
the others by name. Operator guidance lives in `docs/self-hosting.md` and
`docs/coolify.md`; this file holds the deployment record and the rules for
editing the stack.

TypeScript client and event contracts stay in `packages/inngest`; API and media
functions stay with their domains.

## Deployment state

Saved Coolify metadata was verified on 2026-10-20: the project and five supported application labels use Maleo, and all five source repositories point to `kevinjulian/maleo` on `main`. Resource UUIDs, domains and build paths were preserved.

Production environment staging was verified on 2026-10-21: Maleo variables are filled, obsolete production keys are removed, and existing credentials are preserved. Public URLs match the configured service domains. Storage credentials passed a read-only check against the existing bucket. The bucket and legacy SQLite path retain their existing values until data migration. Disabled preview configuration remains unchanged.

The initial runtime-only flags caused Compose build interpolation to fail. Build availability is now enabled for all 16 referenced Maleo variables, with values unchanged. Compose validation passed using the saved build-visible values. See `docs/coolify.md` for the required scope settings. A full remote build was not retried during this correction.

The operator subsequently deployed Maleo revision `5a40a45` on 2026-10-21. Live media import passed through storage and processing, with a decoded preview after reload. Live Kokoro TTS also returned stored, decodable audio after the speech service recovered. Core reports `running:healthy`; auto-deploy remains paused. Database, volume, persisted-setting and durable-registration conversion completion has not been verified. Saved environment changes alone do not prove that cutover is complete.

|                           |                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform resource         | Coolify **Docker Compose** application `maleo-core`, project `maleo`, environment `production`, server `localhost`                                                                                                                                                                                                                             |
| Compose path              | `deploy/docker-compose.coolify.yml` (compose location `/docker-compose.coolify.yml`), base directory `/deploy`. `deploy/docker-compose.yml` is its self-host twin, not deployed here                                                                                                                                                           |
| Domains                   | one each for `web`, `api`, and `rustfs`, set per service in the Coolify UI (see `docs/coolify.md`) and stored in the application's `docker_compose_domains`, not in this repository                                                                                                                                                            |
| Media store               | the `rustfs` service **in this stack**, reached internally at `http://rustfs:9000`. Its public domain serves presigned browser reads only                                                                                                                                                                                                      |
| Build context             | repository root — every Dockerfile here expects it                                                                                                                                                                                                                                                                                             |
| Watch paths               | `Dockerfile`, `.dockerignore`, `package.json`, `bun.lock`, `deploy/**`, `apps/web/**`, `apps/api/**`, `apps/media-worker/**`, `apps/render-worker/**`, `packages/**`                                                                                                                                                                           |
| Durable execution backend | **self-hosted** `inngest/inngest:v1.45.1`, the version the root lockfile pins for development. A hosted deployment points `INNGEST_BASE_URL` and the keys at Inngest Cloud instead and changes no function code — the self-hosted server is SSPL-1.0, and offering the product to third parties as a service is the case that licence reaches. |
| Durable-state retention   | 30 days of **finished** runs, by the `inngest-prune` service, daily. In-flight and suspended runs are never pruned.                                                                                                                                                                                                                            |

Per service:

| Service            | Build / image                                                                    | Port | Public                       | Healthcheck                                             | Self-authenticating                                               |
| ------------------ | -------------------------------------------------------------------------------- | ---- | ---------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| `web`              | root `Dockerfile`, `bun --config=apps/web/bunfig.toml apps/web/src/app/serve.ts` | 3030 | domain                       | SPA shell is present in the body, not merely a 200      | no — it proxies, the API decides                                  |
| `api`              | root `Dockerfile`, `bun apps/api/src/index.ts`                                   | 8090 | domain, **no proxy fence**   | `GET /health`                                           | yes — refuses anonymous requests itself                           |
| `render-worker`    | root `Dockerfile`, `bun src/index.ts` from `/app/apps/render-worker`             | 8091 | internal only                | `GET /health` (queue/output access)                     | bearer token on render control endpoints                          |
| `media-worker`     | root `Dockerfile`, `bun apps/media-worker/src/index.ts`                          | 7071 | internal                     | `GET /health`, processing readiness reported separately | service token on `/processing/*`; API `/internal/*` source access |
| `maleo-postgres`   | `postgres:18`                                                                    | 5432 | internal                     | `pg_isready`                                            | password, TLS                                                     |
| `maleo-db-backup`  | `postgres:18`                                                                    | —    | internal                     | `pg_isready` against `maleo-postgres`                   | n/a                                                               |
| `db-carry`         | root `Dockerfile`, one-shot SQLite carry                                         | —    | internal                     | one-shot, exits 0                                       | n/a                                                               |
| `inngest`          | `inngest/inngest:v1.45.1`                                                        | 8288 | **internal only**            | GraphQL `{functions{id}}`, which reads through Postgres | **no** — the server ships no auth                                 |
| `inngest-postgres` | `postgres:16-alpine`                                                             | 5432 | internal                     | `pg_isready`                                            | n/a                                                               |
| `inngest-redis`    | `redis:7-alpine`                                                                 | 6379 | internal                     | `redis-cli ping`                                        | n/a                                                               |
| `rustfs`           | `rustfs/rustfs:1.0.0`                                                            | 9000 | domain, presigned reads only | unsigned GET answers 403                                | yes — every request is signed                                     |
| `rustfs-init`      | `amazon/aws-cli:2.27.49`                                                         | —    | internal                     | one-shot, exits 0                                       | n/a                                                               |
| `inngest-sync`     | `curlimages/curl:8.11.1`                                                         | —    | internal                     | one-shot, exits 0                                       | n/a                                                               |
| `inngest-prune`    | `postgres:16-alpine`                                                             | —    | internal                     | `pg_isready` against its database                       | n/a                                                               |

The API is the one service given a public address without a fence in front of
it, because it authenticates its own callers. Everything else is fenced. Port
8288 in particular is never published: it serves the dashboard and the event API
together, so exposing one exposes both. How to reach the dashboard and why the
media store is in this stack: `docs/self-hosting.md`.

### Registration is not automatic

The self-hosted server does not discover apps. A function host registers by
taking a `PUT` on its own `/api/inngest`, which `inngest-sync` does once per
deploy after both hosts are healthy. Until it runs, the server holds no
functions and every event triggers nothing, silently.

Each host registers under its own `INNGEST_APP_ID` — `maleo` for the API,
`maleo-media` for the worker — set in the compose file, never inherited from a
package script. A collision makes the second sync replace the first.
`bun run check:deploy` fails on one.

### One image, four commands

The API, web UI, media worker, and render worker share root `Dockerfile` and differ
by their compose `command`. Three images meant three installs of one lockfile,
built in parallel by the platform on a host running nine other applications, and
that failed twice with a bare `exit code: 1` that no log retained. A process
that ever needs a dependency tree the others do not share gets its own image
again.

### Video export

API uses `http://render-worker:8091` with required `MALEO_VIDEO_TOKEN`, shared
with renderer. Renderer fetches workspace-scoped inputs from `http://api:8090`
using `MALEO_SERVICE_TOKEN`, and writes completed video to shared S3 storage.
It has no domain or published port. Its local browser uses loopback `/public`
for temporary media. Image installs and launches Remotion's matching browser
from renderer cwd; cache stays in `node_modules/.remotion`, outside mounts.

Named volumes `maleo-render-data`, `maleo-render-out`, `maleo-render-public`
mount `data`, `out`, `public` under `/app/apps/render-worker`. Keep queue volume
and object storage across updates. Stop worker before copying SQLite and its
WAL files for backup. Public inputs are temporary and cleaned after jobs;
preparation caches can be regenerated. Existing retention defaults keep 5,000
job rows; these volumes have no separate automatic backup service.

One replica, one concurrent job, one browser frame worker per local render,
2 CPUs, 4 GiB memory, 1 GiB shared memory.
Check host headroom before rollout; these limits are defaults, not production
capacity evidence. API waits for worker health; worker waits only for storage
initialization, avoiding a cycle. Health is not export proof.

### Worker processing

Media worker result SQLite is mounted on `maleo-media-worker` at
`/data/media-worker/gen-worker.sqlite`; disposable processing scratch is
`/tmp/maleo-media-worker`. Preserve an existing container-local result store
before upgrading, as described in `docs/self-hosting.md`. Shared image already
installs FFmpeg/ffprobe, with build-time version checks; worker also exposes live
processing readiness.

### The image builds the editor engine

The editor executes through the Rust engine (`crates/`), served by the web as
`/editor-engine.wasm`. It is a build output, git-ignored and excluded from the
build context, so the Dockerfile builds it in its own `rust` stage and copies
only the module into the runtime image. Without it the editor route says it
could not start. The healthcheck asserts the shell itself.

## Local contracts

- Never commit values copied from `.env.example`.
- `docker-compose.yml` (self-host) and `docker-compose.coolify.yml` are full
  copies. Every service change goes into both; they may differ only by
  `SERVICE_FQDN_*` lines (Coolify) and `ports:` (self-host).
  `bun run check:deploy` fails on anything else.
- Keep the function URL at `/api/inngest` on both hosts.
- Local development uses root `.bin/inngest dev`, not this compose stack. To
  exercise the deployment shape locally, run `docker-compose.yml` with
  `docker-compose.local.yml` — see
  `docs/development.md`.
- Coolify's compose parser cannot read `${VAR:?message}` — the deployment
  fails with "Failed to read the Docker Compose file from the repository". Use
  the bare `${VAR:?}` form in both files; it means the same to `docker compose`.
- Never mount a script into a service. Coolify rewrites a compose-relative bind
  path into its own per-application directory and leaves nothing there, so
  Docker mounts an empty directory and the script exits 126. The bucket
  initialization and the retention job are inlined for that reason.
- The Coolify MCP `application update` tool silently drops
  `docker_compose_location`. Change it in the UI or with
  `PATCH /api/v1/applications/{uuid}`, and read it back.
- `INNGEST_SIGNING_KEY` must be plain hex for the self-hosted server; a
  `signkey-prod-…` value makes it exit with "signing-key must be hex string".
- Changing a port, build path, healthcheck, or retention period updates the
  tables above in the same change.

## Verification

```bash
docker compose --env-file deploy/.env.example -f deploy/docker-compose.coolify.yml config -q
docker compose --env-file deploy/.env.example -f deploy/docker-compose.yml config -q
bun run check:deploy
```
