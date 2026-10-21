# API Reference

HTTP API served by `src/index.ts` (Hono on Bun). All routes require `Authorization: Bearer $MALEO_VIDEO_TOKEN` except where noted.

Base URL: `http://localhost:${MALEO_VIDEO_PORT:-8091}`

<!-- AUTO-GENERATED:routes -->

## `GET /health`

Liveness probe.

```json
{ "ok": true, "ts": "2026-05-13T00:00:00.000Z" }
```

## `GET /presets`

List platform presets (`tiktok`, `reels`, `shorts`, `ig-feed`, `yt-long`).

```json
{
	"items": [
		{
			"id": "tiktok",
			"compositionId": "ProductReel",
			"maxDurationSec": 60,
			"codec": "h264",
			"videoBitrate": "6M"
		}
	]
}
```

## `GET /templates`

List template layouts (`classic`, `split-screen`, `before-after`, `testimonial`).

## `POST /render`

Enqueue render job.

Request:

```json
{
	"product": {/* validated by src/schema.ts productSchema */},
	"preset": "tiktok",
	"backend": "local"
}
```

Response `202`:

```json
{ "id": "<uuid>", "status": "queued", ... }
```

Errors: `400 invalid_json` · `400 invalid_product` (with Zod issues) · `400 unknown_preset`.

## `GET /render/:id`

Job status. `404 not_found` if unknown.

## `GET /render/:id/file`

Stream finished MP4 (`content-type: video/mp4`).

Errors: `404 not_found` · `409 not_ready` (with current status) · `410 file_missing`.

## `GET /jobs?limit=50`

Recent jobs, newest first.

<!-- /AUTO-GENERATED:routes -->

## Errors

All error responses share shape `{ "error": "<code>", ... }`. Server logs and returns `500 internal` for uncaught errors.

## Scoped export history

`POST /jobs/query` is an authenticated internal read. API resolves membership and
project ownership before sending its JSON body:

```json
{
	"workspace": "default",
	"projectIds": ["project-id"],
	"legacyJobIds": [],
	"statuses": ["queued", "running"],
	"limit": 60,
	"offset": 0
}
```

Workspace and project ID sets are required. Empty sets return no jobs. Legacy
IDs admit only jobs without persisted workspace ownership. Status is optional.
Filters run before count and pagination. Ordering is `created_at DESC, id DESC`.
Response includes `items`, `total`, `limit`, `offset`, `has_more`, `next_offset`,
`project_ids`, and `legacy_job_ids`. Owner facets describe matching attempts
across all pages. Existing global `GET /jobs` remains available to internal tools.

Public API `GET /api/video/jobs` requires authorized `workspace` and accepts
`search` (literal project-title substring), `project`, `status`, `limit`, and
`offset`. It returns project titles, project choices, and filtered attempt count.
`GET /api/video/projects/:id/exports?workspace=default` returns newest active
`active` and newest terminal `latest`, independently. Neither read submits work.
Worker ownership makes discovery independent of browser-created render links.
Already-linked project/output records reconcile only changed state.

Successful jobs can carry nullable `thumbnail_storage`. This is managed JPEG
metadata, not a worker scratch path. API resolves it to authorized `thumbnail_url`.
Older exports can lack a poster. Missing output bytes remain visible in history
with no playback action. An unavailable poster does not invalidate an MP4.
