# Design

## Context

- The library is `editor_state_json.mediaAssets`, written whole by the editor
  through `PUT /projects/:id/editor-state` (`use-content-persistence.ts`).
  Older projects also carry `media_assets` in a storyboard document;
  `parse-loaded-project.ts` reads both and `library.hydrate` loads them.
- `EditScope.mediaAssets` is already part of the engine scope. `media.admit`
  and `media.update` are engine commands; `admitAsset` (`@maleo/shared`) holds
  the URL deduplication rule, and `media-admission.ts` wraps it with a
  client-minted id.
- `p1-command-log` gives each project one feed, ordered by `seq` and serialized
  by the `storyboard-version:<project>` lock. Each entry names a version
  (`version NOT NULL` today). The server scope has `mediaAssets: []`, and the
  editor grafts its own list into delivered `scope.replace` entries.
- Imports mint a client UUIDv7 `media_id`; `publishImport`
  (`modules/media-import/service.ts`) publishes the finished object under it.
- Retention prunes versions per project; the newest version, and so the newest
  entry, is never pruned.

## Goals / Non-Goals

**Goals:**

- One server-held library per project, changed only by commands in the feed.
- An upload is visible on every client before it is placed.
- No deploy-time migration step.

**Non-Goals:** per-row edit commands, cross-project assets, push delivery
(proposal).

## Decisions

### D1. One row per asset, the asset JSON kept whole

`project_media_assets(project_id, id, url, asset_json, position, created_at,
updated_at)`, primary key `(project_id, id)`, unique `(project_id, url)`.
`asset_json` is the `MediaAsset` as the scope holds it; `position` keeps the
library's order, because the engine's `media.update` replaces an ordered list.

- Why whole JSON: `MediaAsset` has optional fields that change often
  (`lifecycle`, `favorite`, `poster`, import metadata). Columns for each would
  make every new field a migration, and nothing queries them yet.
- Alternative rejected: storing the list as one JSON cell on the project. It
  is today's shape, moved; it keeps whole-list writes and loses the URL
  constraint.

### D2. The scope reads the rows; a submission writes the difference

`storyboardScope` gains the rows' `mediaAssets`. After the accepted commands
run, the server compares the library before and after by `id`, and inserts,
updates and deletes rows, then writes the log entry:

```text
storyboard part changed -> addContentStoryboard({..., commands}) (entry names the new version)
only library changed     -> recordCommandEntry({ version: null, commands })
```

Both run inside the submission's transaction under the same lock.
`content_project_commands.version` becomes nullable. A delivered or snapshot
`scope.replace` carries the rows' library, and the editor's `withLocalMedia`
graft (`p1-command-log` D3) is removed.

- Why diff, not per-command handlers: the engine already decides what
  `media.admit` and `media.update` do; a second interpretation on the server
  would drift. The diff stores exactly what the engine produced.
- A URL conflict on insert (another client admitted the URL first) cannot
  happen inside the lock, because the engine's `admitAsset` deduplicates on
  URL against the same rows. The unique constraint is the backstop.

### D3. Import finish admits through the same path

`publishImport` calls one db function that, under the project lock, inserts
the row (id = the minted `media_id`) when no row has that id or URL, and
records a versionless entry with one `media.admit` command, actor `system`.
The uploading client already holds a pending asset with that id; `admitAsset`
finds it by id and URL, so the entry changes nothing there.

Server-side generators that admit media into a project (agent persistence,
caption realignment, generated narration) do the same through that function
rather than through the editor state.

### D4. Retention prunes versionless entries behind the oldest kept version

After `pruneStoryboardVersions` deletes versions and their entries, it deletes
versionless entries with `seq` below the smallest `seq` among the project's
remaining versioned entries. The newest versioned entry is never pruned, so
`MAX(seq)` still never decreases.

- Why this bound: a client whose base is below the oldest versioned entry
  already gets a snapshot (the range check fails), and the snapshot carries
  the library, so older library entries can never be delivered.
- Edge: a burst of library-only entries after the newest version is kept
  until the next version, even when long. Uploads are rare next to edits;
  the ceiling is the number of assets a project admits between two versions.

### D5. The stored list is imported on first scope read

`content_projects.media_library_imported_at` (nullable). Inside the lock, a
scope read for a project where it is null imports
`editor_state_json.mediaAssets`, then any `media_assets` of the head document,
deduplicated by URL in that order, sets the timestamp, and records no entry
(clients load the library from the project read). The project read itself
triggers the import, so it runs before any client sees the library.

- Why lazy: migrations here are SQL-only and checksummed. The import needs
  the document reader and URL rule from `@maleo/shared`, and a lazy import
  under the lock is idempotent and needs no maintenance window.

### D6. The editor stops owning the list

- The project read returns `mediaAssets` from rows; `parse-loaded-project.ts`
  reads them there and no longer from editor state or the document.
- `use-content-persistence.ts` drops `mediaAssets` from the editor-state
  bundle; the editor-state route ignores the key.
- The bridge compares `mediaAssets` too: a library change made around the
  stack (a direct `library.setMediaAssets`) is sent as `media.update` of the
  new list. `ensureMediaAsset` callers move to `media.admit` through the
  stack where they still write the list directly.

## Risks / Trade-offs

- [`media.update` replaces the whole list] → Two clients editing different
  assets' fields at once: the later replace wins for those fields. Same as
  today, narrowed to field edits; per-row commands are the follow-up.
- [A delivered library replace removes a pending local asset] → A pending
  upload exists only locally until import finish. The editor keeps its
  pending assets (those whose URL is a pending import) when it applies a
  delivered library; they arrive from the server at finish.
- [Large libraries in snapshot entries] → Measure the library size on the
  largest development project; the entry grows by the list size, as the
  editor-state payload does today.

## Migration Plan

1. Migration: `project_media_assets`, nullable `version`,
   `media_library_imported_at`.
2. Server: rows in the scope, row diff on submit, import-finish admission,
   lazy import, retention.
3. Web: library from the project read, no graft, no `mediaAssets` in editor
   state.

Rollback: revert the web change; the editor state still holds the last list
it wrote before the switch, and the rows stay unused.
