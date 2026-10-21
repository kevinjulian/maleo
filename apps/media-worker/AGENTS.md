# @maleo/media-worker — agent instructions

## Purpose

`@maleo/media-worker` is the deployable process shell for the media worker.

## Ownership

- `src/index.ts` boots `startMediaWorker` from `@maleo/media/worker`.
- Package scripts provide local dev/start/typecheck entrypoints.

## Local Contracts

- Keep this app thin. Do not put generation, provider, queue, or HTTP route
  logic here; those belong in `packages/media`.
- Runtime configuration reaches providers through the configuration seam in
  `@maleo/media`, not by providers reading `process.env` themselves.
  - Set `MALEO_API_URL` and `MALEO_SERVICE_TOKEN` and this worker fetches
    resolved provider configuration from the API, so a credential entered in
    Settings reaches the process that actually generates. Values are cached
    briefly and re-fetched, so a rotated credential lands without a redeploy.
  - Set neither and configuration resolves from this process's own environment
    exactly as before, which is what keeps an existing deployment working
    unchanged.
  - An environment variable always wins over a fetched value — break-glass while
    the configuration service is unreachable.
  - If the configuration service cannot be reached, generation FAILS naming it.
    It must never fall through to another provider: `sandbox` is registered last
    and fabricates output, so failing open would turn an outage into fake media.
- Provider scratch cache and result polling SQLite still live under this app's
  `data/` directory: `apps/media-worker/data/cache` and `gen-worker.sqlite`.
  Only SQLite needs durable mounting; completed media uses shared storage.
  Relative `GEN_WORKER_DB` and `CACHE_DIR` resolve from the repo root.
- `@maleo/storage` uploads completed bytes before reporting job success.
  Production requires configured S3-compatible storage; explicit local mode is
  for development. Worker cache has no public file route.
- Import processing needs FFmpeg and ffprobe on PATH. `/health` reports
  `processing.available` and effective limits separately from liveness; missing
  binaries leave generation available but refuse processing submissions with 503.
- Processing source access requires `MALEO_API_URL` and `MALEO_SERVICE_TOKEN`.
  Sources are API-authorized project/import/revision identities, never caller
  URLs or storage keys. Processing jobs share the durable worker SQLite file,
  with separate records and one global Inngest processing slot.
- Local `dev`/`start` scripts set
  `MALEO_MEDIA_WORKER_PORT=${MALEO_MEDIA_WORKER_PORT:-7071}` and load the
  repo-root `.env` via `--env-file ../../.env` before importing
  `@maleo/media`, so module-load configuration such as Inngest concurrency is
  visible to the worker. Do not add `apps/media-worker/.env`.

## Work Guidance

- Add deployment-only wiring here only when it cannot live in `@maleo/media`.
- Keep package dependencies minimal; normally only `@maleo/media` is needed.

## Verification

```bash
cd apps/media-worker
bun run typecheck
```

For behavior changes, run `bun run dev` and hit `/health`.
