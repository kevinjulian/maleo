# Proposal

## Why

A project's media library is a `mediaAssets` list inside
`content_projects.editor_state_json`. The client writes the whole list on a
debounce, so the last write wins. A second device sees a new upload only after
a reload, and two open devices can erase each other's uploads. The uploaded
bytes are already on the server (`media_objects`, `/api/media/:id`); what does
not sync is the record that says "this asset belongs to this project".
`p1-command-log` gave each project one ordered feed. The library belongs in
that feed as server-owned records, so every client sees an upload before
anyone places it on the timeline.

## What Changes

- Add `project_media_assets`: one row per asset of a project, keyed by the
  asset identity and unique by URL within the project. The server owns the
  rows. The library is a query over them.
- The server's editable scope reads `mediaAssets` from these rows. The
  engine's existing `media.admit` and `media.update` commands then execute on
  the server like any other command, and the accepted result is written back
  as row changes in the same transaction as its log entry.
- A log entry can change only the library. Such an entry does not write a
  storyboard version: `content_project_commands.version` becomes nullable.
  Retention keeps the version rules it has and prunes versionless entries
  that are older than the oldest retained versioned entry.
- When a media import finishes, the server creates the row and records a
  `media.admit` entry, so the upload appears on every client before it is
  placed.
- Generation, stock and reference admissions from the editor go through the
  `media.admit` command. Server-side generators that admit media write the row
  and the entry themselves.
- **BREAKING** (internal): a delivered `scope.replace` now carries the
  server's media library, and the editor applies it. The `p1-command-log` rule
  that the editor keeps its own `mediaAssets` is removed.
- The editor-state autosave stops writing `mediaAssets`. The first time the
  server reads a project's scope after this change, it imports the project's
  stored `mediaAssets` list into rows, deduplicated by URL, under the version
  lock. No separate migration step is run.

Non-goals:

- Library edits beyond what the engine commands express today (rename,
  favorite and lifecycle are `media.update` until per-row commands exist).
  Per-row commands are follow-up work once a second client needs them.
- Sharing assets between projects or workspaces. The global reference library
  stays separate.
- Push delivery. Clients read the feed as `p1-command-log` defines.

## Capabilities

### New Capabilities

- `project-media-library-sync`: server-owned library rows, library edits as
  commands in the project command log, versionless log entries and their
  pruning, import-finish admission, and the one-time import of stored lists.

### Modified Capabilities

- `project-command-log`: "The web editor saves through the log" — the editor
  applies the server's library from a delivered `scope.replace` instead of
  keeping its own.

- `project-media-library`: "One path admits an asset to the project" changes
  from a client-side operation over a list to a command the server executes
  and stores as a row; the URL deduplication rule moves with it.

## Impact

- `packages/db`: migration for `project_media_assets` and a nullable
  `content_project_commands.version`; `project-commands.ts` (versionless
  entries, pruning); a new `project-media-assets.ts` family; retention.
- `packages/shared`: `storyboard-scope.ts` takes the rows' `mediaAssets`.
- `apps/api`: `lib/project-commands.ts` (row diff and versionless entries),
  `modules/media-import` (admission at finish), server-side generators that
  admit media, the project read (library from rows), the editor-state route
  (ignores `mediaAssets`).
- `apps/web`: `command-sync.ts` stops grafting local media; the library store
  is loaded from the project read and changed only through commands and
  resolved replies; `use-content-persistence.ts` drops `mediaAssets`;
  `media-admission.ts` keeps URL deduplication only as the local preview of
  the server's rule.
- Depends on `p1-command-log` being applied (not necessarily archived).
- Docs: `docs/CODEMAPS/db.md`, `docs/CODEMAPS/backend.md`,
  `docs/CODEMAPS/timeline-editor.md`, `CHANGELOG.md`.
