# Runbook

Operations guide for running `@maleo/api` in production.

## Deployment

### Docker

```bash
docker build -t maleo-api -f apps/api/Dockerfile .
docker run -d --name maleo-api \
  --env-file .env \
  -v maleo-data:/data \
  -e MALEO_DATA_DIR=/data \
  -p 8090:8090 \
  maleo-api
```

Mount `/data` read-write: it holds the shared `maleo.db`, which the API reads
and writes directly. To expose the API off loopback, put it behind an
authenticating reverse proxy and set `-e MALEO_API_HOST=0.0.0.0`.

### Direct (Bun)

```bash
bun install --frozen-lockfile
bun run --cwd apps/api start
```

Both modes read the root `.env`. See [ENV.md](ENV.md). There is no login token;
the server binds to `127.0.0.1` by default.

## Health check

```bash
curl -sf http://localhost:8090/health
# → {"ok":true,"ts":"2026-..."}
```

Suggested liveness probe: `GET /health` every 10s, fail after 3 misses.

## Text model discovery

`GET /api/settings/text-provider` returns model options to authenticated members.
Each API provider includes `model_options` with `id` and `source` (`discovered`
or `declared`), plus `discovery` with `status`, model IDs, and a safe error when
needed. This projection excludes endpoint URLs, credentials, and raw responses.
Use `GET /api/settings/text-provider?refresh=true` for Retry.

Discovery uses the effective endpoint and server-held credentials with a
10-second timeout. Results expire after 60 seconds. Concurrent requests share
one discovery request. Endpoint, credential, or declared-model changes invalidate
the cache. Unsupported `/models` responses retain operator-declared IDs.
Authentication, timeout, and malformed-response errors remain visible.

Extra models declare available IDs. They do not select a model or prove that
generation works. The pricing catalog does not define endpoint support. Custom
endpoints require an explicit model choice. Invalid saved choices fail without
substitution. Global selection and credential writes remain instance-owner only.

## Common issues

| Symptom                                        | Cause                           | Fix                                                                                                                            |
| ---------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Cannot reach the API remotely                  | Binds to `127.0.0.1` by default | Front with an authenticating reverse proxy and set `MALEO_API_HOST=0.0.0.0`                                                    |
| Image generation never completes               | Media worker unreachable        | Check `MALEO_GEN_WORKER_URL` and the worker's own `/health`                                                                    |
| Image or speech generation says not configured | No media worker URL             | Set `MALEO_GEN_WORKER_URL`; no direct fallback exists                                                                          |
| A chat turn hangs                              | Waiting on the text provider    | Check the API text provider's health in settings and that `MALEO_AI_API_KEY` and `MALEO_AI_API_BASE_URL` reach a live endpoint |
| Voice pickers show no play control             | Samples not baked               | `bun run bake:voice-samples` — a deploy-time job, not part of setup                                                            |

## Rollback

Redeploy the previous image, or `git revert`. The shared `maleo.db` is not
touched by a code rollback.

Database migrations run forward on start from `packages/db/src/db/`. A
rollback across a migration needs a database snapshot taken beforehand.

## Monitoring

- `GET /health` — liveness
- `GET /api/activity-stream` — server-sent event tail of live activity
- `GET /api/credits` — metering and accounting

## Escalation

1. Check `/health` and process logs (`docker logs`, `journalctl`).
2. Check `MALEO_DATA_DIR` (or `<repo>/data`) is mounted read-write — it holds
   the shared `maleo.db`.
3. Check upstream services: the media worker and video.
4. If durable generation is wedged, inspect `workflow_run` and `step_run` rows
   in `maleo.db` for runs stuck in a non-terminal state.
