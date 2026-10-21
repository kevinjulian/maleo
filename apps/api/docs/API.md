# HTTP API

Route groups mounted by `src/index.ts`. Each group's endpoints live in the
module named below; that module is the reference, because a hand-maintained
endpoint table drifts the moment a route is added.

The server binds to `127.0.0.1` by default. Operator sessions and workspace
membership authorize project routes; service credentials authorize internal routes.

| Mount                  | Module                      | Owns                                                                                              |
| ---------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| `/api/operations`      | `routes/operations/`        | content projects: storyboards, references, renders, assets, events, campaigns, presets, materials |
| `/api/settings`        | `routes/settings.ts`        | operator settings, including provider selection                                                   |
| `/api/image-gen`       | `routes/image-gen.ts`       | image generation, its ledger, and file retrieval                                                  |
| `/api/credits`         | `routes/credits.ts`         | metering and credit accounting                                                                    |
| `/api/video`           | `routes/video.ts`           | render jobs                                                                                       |
| `/api/tts`             | `routes/tts.ts`             | speech synthesis and voice samples                                                                |
| `/api/stock`           | `routes/stock.ts`           | stock media lookup                                                                                |
| `/api/tools`           | `routes/tools.ts`           | agent tool endpoints                                                                              |
| `/api/workspaces`      | `routes/workspaces.ts`      | workspace listing and scoping                                                                     |
| `/api/activity-stream` | `routes/activity-stream.ts` | server-sent event stream                                                                          |
| `/api/inngest`         | `routes/inngest.ts`         | durable execution webhook                                                                         |

`/health` is served from `src/index.ts` directly.

`/api/operations` is the largest group by far and is split across modules inside
`routes/operations/` rather than one file. Start from that directory rather than
from this table.

## Conventions

- Requests and responses are JSON unless the route serves a file.
- Route modules validate input with Zod at the boundary.
- Workspace scoping is applied server-side; a client never supplies the scope it
  is allowed to read.

## Caption document saves

`POST /api/operations/projects/:id/chat` accepts `captionSet` beside live `clips`.
Both enter the run snapshot together, including an initialized set with no cues.
Caption data stays editor-owned when an agent updates unrelated content.

`POST /api/operations/projects/:id/storyboards` validates new caption clips and
set metadata before saving. A writer that omits `captionSet` preserves the
latest saved captions. An explicit set with no caption clips records deletion.
Caption-owning saves carry `expectedCaptionState`, the shared
`captionStateFingerprint` of the last loaded/saved caption state. A different
saved state returns `409 caption_conflict`, unless incoming captions already
equal it. Undo may restore older edit revisions when its saved base matches.
Editor autosave and export share one serialized writer. A competing save that
changes the head during the transaction returns `409 storyboard_conflict`.
Reload the current document before retrying a conflict. Invalid caption payloads
return `400 invalid_caption_set` or `400 invalid_caption_clip`.

## Caption jobs

All project paths below are under `/api/operations/projects/:id/captions`.
Membership and project editing permission apply to submit, poll and cancel.

- `GET /readiness`: execution-host FFmpeg/Whisper readiness, configured model/runtime and repair reason.
- `POST /jobs`: returns `202 { id }`. Body: `{ requestKey, doc, source, sourceRevisions, language, captionTrack, replaceEdited? }`.
  `doc` is current canonical `EditorDoc`, including unsaved placements and track flags.
  `source` is `"all"` or `{ clipId, visualId? }`; `sourceRevisions` maps managed media UUIDs to admitted revisions.
  `language` is `"auto"` or a supported language code. `replaceEdited` defaults to `false`.
- `GET /jobs/:jobId`: returns a discriminated processing job. Status is `queued`, `processing`, `done`, `failed` or `cancelled`.
  Persisted stages are `preparing-audio`, `recognizing-speech`, `building-captions`, `ready`; no percentage is invented.
  Caption results contain canonical cue candidates, requested/detected language when known, engine/model and cache status.
  Request carries immutable manifest plus serialized `applyContext` (affected-source/cue/deletion snapshot and replacement choice).
- `DELETE /jobs/:jobId`: cancels application and owned processing. Cancellation remains terminal across retries and late completions.

API expands sources against admitted project media; callers cannot supply worker
paths, URLs, storage keys, fingerprints or filters. Original bytes stay immutable.
Finished project-owned imports also authorize sources before the editor's first
library autosave. Saved `pending:` references resolve only through that project's
ready import. Source revisions still have to match. Browser codec tails up to
50 ms are clamped to measured source duration; larger overruns require trimming.
Worker fetches service-authorized source bytes from the existing media-processing
endpoint and verifies content hashes. Poll checks admission/revision again; stale
sources return `409`. Invalid input returns `400`, scope/body limits `413`, an
active conflicting attempt `409`, unavailable execution host `503`. Foreign jobs
return `404`, including same-workspace jobs from another project.

Limits: 15-minute timeline scope, 32 audible source placements, 512 KiB request,
one active caption job per project, 1 GiB input bytes, 2 GiB scratch, 30-minute
persisted deadline. Local and S3 sources use the same managed-media authorization.
Retry with a new request key; submitting an identical key/request returns the same
job. Worker returns candidates and never saves a storyboard. Editor applies one
result through `caption.edit`, then its normal autosave persists accepted output.
Unrelated edits remain applicable; changed affected evidence holds results.

Settings caption status/setup call service-authenticated worker `/speech/status`
and `/speech/setup`. Generated narration uses bounded `/speech` multipart bytes
and optional script assistance through the API adapter. Inference and cache run
on worker, including when API and worker have different filesystems.

## Related

- [ENV.md](ENV.md) — environment variables, and the root `.env.example`
- [RUNBOOK.md](RUNBOOK.md) — deployment, health, common issues
- [agent-pipeline.md](agent-pipeline.md) — the chat agent pipeline
