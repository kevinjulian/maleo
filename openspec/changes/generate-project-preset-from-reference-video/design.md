## Context

Maleo already models a Project Preset as reusable Material identities plus one Video Template identity. Project creation resolves those Materials into project-local snapshots. Story planning separately selects one of five built-in story arcs, derives section slots from it, persists chapter functions and obligations, and shows them in the generated plan card. Operators can review that result, but cannot browse, author, select, or reuse a workspace-owned structure before planning.

Reference entities already own canonical workspace images and typed roles. Video Templates already own render-time timing, titling, transition, visual, and audio policy. This change must generate ordinary records that continue through those paths rather than introduce an import-only preset format.

A YouTube URL is not permission or sufficient technical access to download its media. YouTube's current terms restrict automated download and scraping unless authorized, while the official caption download API requires authorization to edit the video. Therefore the URL identifies and embeds the source; transcript and frame-readable media must come from authorized access or operator-supplied files. The design does not use `yt-dlp`, browser cookies, unofficial caption endpoints, or a generic remote-media proxy.

Reference source constraints:

- [YouTube Terms of Service](https://www.youtube.com/static?template=terms)
- [YouTube captions.download authorization](https://developers.google.com/youtube/v3/docs/captions/download)

## Goals / Non-Goals

**Goals:**

- Keep the happy path understandable as URL -> Analyze -> select frames -> Save.
- Show and edit inferred story logic before it becomes reusable generation context.
- Generate ordinary Story Material, Visual Material, Video Template, Reference entities, and Project Preset records.
- Reuse the existing story-arc function contract, typed reference roles, template schema, fixture semantics, text-provider registry, metering, and UI vocabulary.
- Preserve source evidence, distinguish inference from defaults, survive page reload after analysis, and prevent partial library saves.
- Keep source access explicit, narrow, and compliant; never turn the API into an arbitrary URL fetcher.

**Non-Goals:**

- Downloading arbitrary YouTube media or captions, importing browser cookies, bypassing source controls, or analyzing private/restricted media without authorization.
- Copying transcript wording, creator/channel identity, branding, faces, music, exact motion design, or recognizable artwork into generated guidance.
- Automatic speech recognition when no timestamped transcript is available; upload of SRT, VTT, or timestamped text is the recovery path.
- Inferring every Video Template field. Music, SFX, and other unobservable choices keep known defaults.
- Creating a separate Story Template library, style library, or import-specific preset type.
- Batch channel analysis, playlist analysis, or automatic publishing.
- Adding YouTube OAuth in this change. A future authorized connector can satisfy the same source-input contract.

## Decisions

### Use one full-page builder under Project Presets

Library > Project Presets gains `Generate from video`. It opens a full-page builder with four visible steps: Structure, Frames, Video Template, Save. A persistent source area contains the embedded or uploaded video, transcript around the playhead, timestamp, and seek control. Structure is the first review step so generated logic cannot remain hidden.

The flow reuses `LibraryHeader`, catalogue cards, existing Button/Input primitives, VUI playhead/ruler behavior, reference role vocabulary, and the existing Video Template editor for progressive `Fine-tune` disclosure. Desktop uses source and review columns; mobile uses one column, a collapsible source player, two-column frame grid, and one sticky action bar. It does not add a second design system or squeeze the workflow into a modal.

Alternative: add URL and frame controls inside the existing preset editor. Rejected because that editor chooses existing records; source analysis, progress, evidence, and frame seeking are a different and substantially larger task.

### Treat URL identity, transcript access, and frame access as separate capabilities

The API accepts only canonical YouTube watch/share URLs and stores the normalized video id and URL. It may retrieve metadata through an official public endpoint and returns capability state independently for transcript and frame analysis.

An operator supplies timestamped transcript data through SRT, VTT, or timestamped text unless a future authorized connector provides it. Exact frame selection and measurable video analysis use an operator-selected local video file. The browser decodes that file with the already-installed media stack, displays it through a normal video element, computes downscaled timing samples, and uploads only selected frame images plus derived measurements. The full source video is not persisted or sent to the API.

The YouTube embed remains useful for contextual playback when no local source file exists. Screenshots can be uploaded as frame references with an operator-entered source timestamp, but do not unlock cadence inference.

Alternative: use `yt-dlp` server-side. Rejected because it would add an unstable extraction dependency, automated download behavior, account-cookie risk, and source-control circumvention outside this product's acceptable boundary.

Alternative: upload and retain the full source video. Rejected because selected frames and compact measurements are sufficient, while retaining third-party media creates needless storage, privacy, cleanup, and rights risk.

### Persist one revisioned analysis draft, not partial library records

Add one workspace-scoped import table in `packages/db` with id, normalized source identity, status, phase, progress, revision, snapshot JSON, error, and timestamps. Snapshot JSON contains transcript segments, derived structure, source evidence, confidence, sampled video measurements, frame draft metadata, template draft, and user edits. Captured frame binaries remain import-scoped staged files until finalize.

Analysis uses the existing durable execution path and text-provider selection/metering. Starting analysis records intent before provider work. Status polling returns the persisted snapshot; stale runs become recoverable errors rather than spin forever. Every edit sends the expected revision. A stale tab receives a conflict and reloads canonical state instead of overwriting newer review work.

Alternative: hold wizard state only in React. Rejected because analysis can outlive one request or page session and losing reviewed structure after reload is hostile.

Alternative: create Materials and Template during analysis. Rejected because cancellation would leave orphan library rows and later edits would require synchronizing draft and saved records.

### Store custom structure inside Story Material

Extend reusable Material and project-local Material values with an optional structured story recipe valid only for the Story group. The recipe uses the existing arc-function shape: label, fit guidance, ordered stable function keys, obligations, relative position windows, default emotions, midpoint key, and turn key. Evidence and confidence belong to the import draft, not the reusable recipe; source provenance is retained on the material record separately.

Shipped Story Material fixtures expose built-in structures using the same schema and remain fork-on-edit. The current built-in arc data remains the compatibility/default source for old projects and projects with no structured Story Material. This yields one planning contract without forcing migration of existing plans.

Planning resolution priority is:

1. An explicit user/tool arc request.
2. Structured recipe in project Story Material.
3. Existing inferred built-in arc and plan-kind fallback.

When Story Material wins, planning copies its full recipe into the durable story plan. Skeleton derivation and coverage consume that snapshot, so later edits to the Library Material cannot change an existing project or plan. Plans carrying only a legacy built-in arc continue resolving through current code.

Alternative: encode structure as prose in `Material.body`. Rejected because the model would reinterpret it on every run and deterministic skeleton/coverage could not consume it.

Alternative: add a top-level Story Template entity to Project Preset. Rejected because it expands the product model and Library IA when Story Material already owns narrative source and framing.

### Infer only evidence-backed reusable behavior

Transcript analysis returns an abstract recipe, not a summary: ordered functions, obligations, relative windows, default emotions, and evidence timestamps. Provider prompts omit source title, channel, creator identity, transcript quotes, and recognizable names from the reusable output. A deterministic post-check rejects copied transcript spans and named-identity imitation before the draft becomes reviewable.

Browser video measurements may infer only fields supported by observable evidence, initially dominant transition family, visual-change cadence, section gap estimate, and chapter-title policy when confidence passes a documented threshold. Other Video Template fields begin from `DEFAULT_TIMELINE_TEMPLATE`. Every draft field carries `inferred`, `defaulted`, or `changed` review provenance plus source evidence where applicable; that provenance stays in the import draft and is not duplicated into the ordinary saved template.

Alternative: ask one model to invent the entire preset from transcript and sparse frames. Rejected because it would present guesses as extraction and silently copy source-specific content.

### Capture selected frames as canonical typed references

`Use current frame` captures the exact local-video playhead frame. Keyboard controls move by source frame where the browser can determine frame rate, otherwise by the smallest supported seek step and label precision honestly. Suggested frames are candidates only; no frame persists until selected and finalized.

Each selected frame defaults to role `style` and `referenceUse: style`; the operator may change role using existing labels. Finalization uploads it through managed reference storage and creates or reuses a canonical workspace Reference entity. Product-role frames are never selected or generated automatically. Reference provenance stores source kind, normalized YouTube id/URL, timestamp milliseconds, capture method, and import id without changing the entity content key.

Alternative: store data URLs in Visual Material. Rejected because canonical managed images and entity ids already solve reuse, deduplication, and generation attachment.

### Finalize all linked records through one API transaction

Finalize validates import revision, analysis readiness, names, structure, template, selected frames, roles, and explicit rights confirmation. It promotes staged frame files, then uses one SQLite transaction and existing DB helpers with a shared connection to create/reuse Reference entities, create Story and Visual Materials, create the Video Template, and create the Project Preset that names those records. Any DB failure rolls back every row and removes newly promoted files. Expired staged files are cleaned independently.

The import stores finalized output ids. Repeating the same finalize request returns those records and creates nothing new. The success screen offers `Use preset in new video` and `View in Library`.

Alternative: call five existing HTTP endpoints from the browser. Rejected because client orchestration cannot make cross-record creation atomic or idempotent.

### Preserve source safety at every trust boundary

URL parsing accepts only expected HTTPS YouTube hosts and extracts a constrained video id before any network access. The API never fetches a client-supplied resolved media URL, localhost, private network address, redirect target, or arbitrary host. Uploads enforce type and size limits and are treated as untrusted media. Provider prompts receive transcript text and downscaled selected evidence only after explicit analysis confirmation.

Rights confirmation is required before analysis of supplied transcript/media and repeated at finalize when captured frames will be persisted. It is audit metadata, not a claim that Maleo grants rights. Logs and errors exclude transcript bodies, frame bytes, tokens, cookies, and signed URLs.

## Risks / Trade-offs

- [URL alone cannot provide compliant transcript or exact frames for arbitrary videos] -> Show source readiness immediately and request SRT/VTT plus local video or screenshots without discarding URL metadata.
- [Local video disappears on reload] -> Persist transcript, structure, edits, and measurements; mark frame source disconnected and ask operator to reselect the file before adding more frames.
- [Generated structure copies source wording] -> Constrain provider output to functions/obligations, run deterministic overlap and named-identity checks, and block finalize until violations are edited or regenerated.
- [Frame capture consumes browser memory] -> Decode/sample downscaled frames on demand, cap source duration/size and candidate count, release media resources when leaving the flow, and never retain the full file server-side.
- [Single-video inference overfits] -> Preserve source evidence and confidence, expose every structure stage, label defaults honestly, and require operator review instead of presenting result as universal truth.
- [Atomic DB rows cannot be perfectly atomic with filesystem promotion] -> Stage imports separately, remove promoted files on transaction failure, keep finalize idempotent, and clean unreferenced expired staging files.
- [Structured Story Material widens persisted documents] -> Default field to absent, parse old rows unchanged, keep legacy arc lookup, and deploy shared readers before writers.
- [Long analysis spends credits before save] -> Quote/confirm any billable analysis before provider submission and record spend through existing metering.

## Migration Plan

1. Add backward-compatible shared schemas and nullable/defaulted database storage; ship readers before any writer emits structured Story Material or frame provenance.
2. Expose built-in structures through shipped Story Material fixture payloads while preserving current built-in arc resolution for old projects.
3. Add import persistence, durable analysis, strict source parsing, upload staging, and atomic finalize endpoint behind the new Library action.
4. Add desktop/mobile review UI and focused browser proof for source recovery, structure editing, frame selection, template provenance, stale revisions, failed finalize, and success actions.
5. Remove only expired import staging data; do not rewrite existing projects, plans, Materials, Templates, References, or Presets.

Rollback disables the Library action and analysis endpoints first. Existing generated outputs remain ordinary library records. Nullable columns and old-plan compatibility remain safe for forward-created data; import drafts and staged files may then be removed after confirming no active runs.

## Open Questions

- A future change may add an authorized YouTube owner connector. It must satisfy the same transcript/source capability contract and undergo separate provider, OAuth, privacy, and release-compliance review.
