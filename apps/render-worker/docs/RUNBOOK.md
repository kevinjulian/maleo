# Runbook

## Local server

```bash
bun install
# set MALEO_VIDEO_TOKEN in the repo-root .env
bun run dev            # dev (hot reload); from the repo root: bun run render-worker
bun run start          # prod
```

Server boots on `:$MALEO_VIDEO_PORT` (default 8091). Worker loop polls SQLite job queue (`MALEO_VIDEO_DB`) and renders queued jobs.

HTTP starts before bundle warmup. Job processing starts after warmup returns,
because Remotion temporarily changes the process working directory while bundling.
Starting preparation during warmup can write images outside the served directory.

## Health check

Production runs as core Compose service `render-worker`. See
[production export operations](../../../docs/self-hosting.md#video-export).
Compose supplies required render token, authenticated API source access, and
S3 storage settings. Port 8091 is internal. Browser cache is installed in image
under `/app/apps/render-worker/node_modules/.remotion`; do not mount over it.

```bash
curl -H "Authorization: Bearer $MALEO_VIDEO_TOKEN" \
  http://localhost:8091/health
```

Expect `{ "ok": true, "ts": ... }`.

## Batch render

The batch CLI (`prep` then `render:all`) is a library tool and lives in
`packages/video`; see its README.

Rendered files, the job queue (`data/jobs.db`) and the runtime cache `public/`
are created under this app's working directory.

## Cloud render (Remotion Lambda)

```bash
bun run lambda:deploy   # one-time, writes REMOTION_LAMBDA_* into .env
bun run lambda:render --input=../../packages/video/inputs/example.json --preset=tiktok
```

## Common issues

| Symptom                                     | Fix                                                                                                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server exits with `MALEO_VIDEO_TOKEN` error | Set token in `.env`; default `change-me` is rejected.                                                                                                          |
| `unknown_preset` from `/render`             | Use one of `tiktok`, `reels`, `shorts`, `ig-feed`, `yt-long`.                                                                                                  |
| Job stuck `queued`                          | Inspect worker logs and job phase. A stale lease can requeue a job while its worker slot is still blocked. Restart only the worker after checking active jobs. |
| `409 not_ready` on `/render/:id/file`       | Job not `done` yet. Poll `/render/:id`.                                                                                                                        |
| `410 file_missing`                          | Output deleted from disk; re-render.                                                                                                                           |
| Captions misaligned                         | Ensure `OPENAI_API_KEY` set and rerun `bun run prep --tts=true`.                                                                                               |
| Lambda render fails                         | Re-run `bun run lambda:deploy`; verify AWS creds + region.                                                                                                     |

## Rollback

Stop worker, redeploy previous image/Compose revision, and restart with retained
render volumes. Preserve queue SQLite and WAL files, manifests, and shared object
storage. Confirm prior job lookup and completed MP4 download after restart.

## Secret rotation

1. Update `MALEO_VIDEO_TOKEN` in deployment environment.
2. Recreate API and render worker together so both receive matching token.
3. Verify authenticated render submission; never print token in logs.

## Export history and posters

Managed source downloads use an abortable stream and a two-minute deadline per
file, including response headers and body. A stalled transfer fails the attempt,
removes its temporary files, and releases the worker slot for the existing retry
policy. Health checks alone do not detect a blocked worker slot.

Worker jobs own execution status. Project render records are associations and
can lag until discovery, history, or explicit reconciliation reads worker state.
Never create a second job to recover browser progress. Browser export runs only
in its current tab and has no server recovery record.

Both local and Lambda completion extract one first-frame JPEG from the finished
MP4. Extraction has a 15-second timeout and a 640px width limit. Failed extraction
logs a warning and leaves poster metadata null. MP4 delivery still succeeds.
Posters use the same managed store and ownership as exports. Scratch cleanup
removes neither stored output nor poster. Retain shared storage and queue data
when recreating a worker. Existing exports are not backfilled with posters.

After recreation, query the same job ID through the public API and fetch both
its output and `thumbnail_url` under the same authorized session. Check actual
media decoding separately from `/health`. Optional S3 proof requires configured
S3 credentials. Local-storage proof does not establish S3 behavior.

Rollback keeps the additive nullable SQLite column. Older images ignore it.
Keep storage objects and SQLite/WAL files. Do not delete posters during rollback.
