# @maleo/render-worker — agent instructions

## Purpose

The Remotion render server: a Hono HTTP API over a SQLite job queue, a worker
loop that renders queued jobs locally or through Remotion Lambda, and storage of
rendered files through `@maleo/storage`. The API reaches it through
`MALEO_VIDEO_URL` with `MALEO_VIDEO_TOKEN`.

## Ownership

- `src/index.ts` — routes, health, `/public/*` static serving for the renderer.
- `src/worker.ts` — bundle cache, job leasing, local and Lambda renders.
- `src/db.ts` — `render_jobs` schema and queue operations.
- `src/auth.ts` — bearer-token guard.
- `src/export-poster.ts` — bounded first-frame extraction and managed publication.
- `src/managed-inputs.ts` — fetching API-managed media for a render, checked
  against the registry SHA-256 (`x-maleo-sha256`) while it streams.
- `src/rust-export.ts` — renderer choice (`MALEO_EXPORT_RENDERER`, coverage) and
  the Rust export path; `src/rust-host.ts` runs `maleo-render`
  (`crates/render-host`) and maps its JSON lines and exit codes to the job;
  `src/rust-inputs.ts` maps every media URL the host lists to a local file.
  `tests/rust-export.isolated.ts` runs in its own process (see its header).
- Shadow runs and the comparison (p2-export E6–E8): `src/db.ts` hides shadow
  rows (`shadow_of`) from every operator query and leases them after
  authoritative jobs; `src/worker.ts` queues and runs them;
  `src/shadow-settle.ts` turns an ended shadow into a `render_comparisons` row
  (`src/comparisons-db.ts`); `src/comparison.ts` measures the pair with the
  criteria in `comparison.json`; `src/comparison-window.ts` computes the
  observation window; `src/comparison-routes.ts` serves `/comparisons`.
  `scripts/calibrate-comparison.ts` measures the encoding allowance.
- `scripts/deploy-lambda.ts`, `scripts/render-lambda.ts` — Remotion Lambda setup
  and one-off cloud renders.

Compositions, schema, presets and storyboard preparation belong to
`@maleo/video`; this app imports them and never re-implements them.

## Local Contracts

- The bundle is rooted at `@maleo/video` (`VIDEO_ROOT`, `VIDEO_ENTRY` from
  `@maleo/video/paths`), never at the cwd.
- `public/`, `out/` and `data/jobs.db` are runtime state under the process's
  working directory. `@maleo/video`'s preparation code writes caches to
  `cwd/public`, and the bundler and `/public/*` read the same directory, so all
  three must keep resolving against one cwd.
- Root `.env` only (`--env-file ../../.env`). No app-local `.env`.
- A shadow job never writes its authoritative job and never uploads output. A
  change to a `comparison.json` threshold bumps `version` and records its
  reason.
- `MALEO_EXPORT_RENDERER` (`remotion` default, `rust`) and `MALEO_EXPORT_SHADOW`
  (`off` turns shadow runs off) are read when a job starts.

## Running

```bash
bun run render-worker          # from the repo root, hot reload, :8091
bun run --cwd apps/render-worker test
```

See `docs/RUNBOOK.md`, `docs/API.md`, `docs/ENV.md`.

## Deployment

Core Compose service `render-worker`, including Coolify resource `maleo-core`
(`mcn9di6ofudxswb0qsdvusuz`). Root `Dockerfile` builds from repository root;
Compose runs `bun src/index.ts` from `/app/apps/render-worker`. Watch paths:
root `Dockerfile`, `.dockerignore`, `package.json`, `bun.lock`, `deploy/**`,
`crates/**` (the Rust render host), `apps/render-worker/**`, and `packages/**`
(full core watch list in deploy/AGENTS.md).
Port 8091 stays internal. `GET /health` checks queue/output access; render control
routes authenticate with bearer token. Health does not prove browser rendering.

Image installs Remotion's matching Chrome Headless Shell under
`/app/apps/render-worker/node_modules/.remotion` and launches it during build.
Keep that cache outside runtime mounts. Compose mounts dedicated named volumes
for `data`, `out`, and `public` under worker cwd. Queue SQLite defaults to
`data/jobs.db`; `out` holds manifests and transient exports; completed video
bytes live in shared S3 storage. Do not share queue with multiple replicas.

Runtime limits: 2 CPUs, 4 GiB memory, 1 GiB shared memory, one concurrent job
and one browser frame worker per local render. Explicit frame concurrency avoids
Remotion's invalid automatic concurrency result under Bun in containers.
These are deployment defaults, not a measurement of production host capacity.
Worker waits for storage initialization; it must not wait for healthy API,
because API waits for worker health. Managed source fetches use internal
`MALEO_API_URL` plus `MALEO_SERVICE_TOKEN`. Local render browser fetches
temporary inputs through `MALEO_VIDEO_PUBLIC_BASE` on its own loopback port.
See docs/RUNBOOK.md and root docs/self-hosting.md for rollout and export proof.

Required secret names: `MALEO_VIDEO_TOKEN`, `MALEO_SERVICE_TOKEN`, shared S3
access key and secret; for Lambda, `REMOTION_AWS_REGION`,
`REMOTION_LAMBDA_FUNCTION`, `REMOTION_LAMBDA_SERVE_URL` and the AWS credentials.

API supplies authorized workspace/project sets to authenticated `POST /jobs/query`.
Filter before count and paging. Empty sets never widen scope. Worker status owns
execution history and project recovery. Posters are optional managed media.
