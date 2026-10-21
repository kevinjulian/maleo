<!-- Generated: 2026-05-13 | Files scanned: 4 (src/*) | Token estimate: ~550 -->

# Backend

Hono on `Bun.serve`. SQLite (`bun:sqlite`) for job queue. In-process worker loop.

## Middleware chain

```
cors (if MALEO_VIDEO_CORS_ORIGINS) → bearerAuth → routes
```

## Routes

```
GET  /health                 → { ok, ts }
GET  /presets                → PRESETS values
GET  /templates              → 4 static template ids
POST /render                 → validate(productSchema) → insertJob → 202
GET  /render/:id             → getJob
GET  /render/:id/file        → stream out/<id>.<preset>.mp4
GET  /jobs?limit=50          → listJobs
```

Error codes: `invalid_json` `invalid_product` `unknown_preset` `not_found` `not_ready` `file_missing` `internal`.

## Modules

| File            | Lines | Role                                                 |
| --------------- | ----- | ---------------------------------------------------- |
| `src/index.ts`  | 134   | Hono app, route handlers, lifecycle                  |
| `src/auth.ts`   | 17    | `bearerAuth` middleware + `getToken()` boot guard    |
| `src/db.ts`     | 84    | `render_jobs` schema, CRUD, `nextQueued`             |
| `src/worker.ts` | 89    | Bundle cache, `tick()`, `startWorker()` polling loop |

## Job lifecycle

```
queued → running → done
                 └→ error
```

- `tick()` short-circuits when `running` (single-flight per process).
- `nextQueued()` = FIFO on `created_at`.
- `updateJob` writes `{ status, progress, output_path, error, started_at, finished_at }`.

## DB schema (`render_jobs`)

```
id PK · product_json · preset · status · output_path · error
cost_usd · progress · backend(local|lambda)
created_at · started_at · finished_at
INDEX (status, created_at)
```
