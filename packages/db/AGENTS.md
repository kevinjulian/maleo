# @maleo/db — agent instructions

## Purpose

Own the Postgres runtime schema, connection, migrations, and entity-family
read/write modules. HTTP, providers, and subprocesses belong elsewhere.

## Contracts

- The numbered files in `migrations/` own every runtime table and column. A
  schema change is a new file; an applied migration is never edited — the
  runner refuses a changed checksum. `RUNTIME_TABLES` is derived from them.
  better-auth's four `auth_*` tables are the one exception (`schema.ts`).
- Every family function takes an optional forwarded `Db` (default `openDb()`);
  preserve it, since callers pass a transaction handle for atomic work.
- A read-decide-write transaction takes `serialize(tx, "<scope>:<id>")` first;
  row-level isolation alone lets two writers both read the same state.
- Queries use `?` placeholders, converted to `$N`; booleans bind as 0/1 and
  int8 comes back as a number (unsafe integers throw).
- Export entity families through `@maleo/db/<family>`.
- The connection comes from `databaseConfig()`: `MALEO_DATABASE_URL` (required
  in production, TLS off-host), else an embedded server under
  `<MALEO_DATA_DIR>/postgres`. `src/db/legacy-sqlite.ts` and
  `unified-schema.ts` exist only for the one-time carry-over and legacy scripts.
- Storyboard versions are bounded per project by `storyboard-retention.ts`,
  enforced inside `addContentStoryboard`'s transaction. A project keeps its newest
  `MALEO_STORYBOARD_RETENTION_WINDOW` versions (default 20, `off` disables),
  every version with status `approved` or `rendered`, every version an output or
  render record points at, and the newest carrier of each seedable artifact kind
  (`@maleo/shared` `seedable-artifact.ts`). The newest version is never pruned,
  so `MAX(version)` is the highest number ever issued. Anything new that points at
  a storyboard version must be added to the retention query, or pruning drops it.
- Every storyboard version has one command log entry (`content_project_commands`,
  `project-commands.ts`), written inside `addContentStoryboard`'s transaction: the
  `commands` the caller passes, else one `scope.replace` of the written
  document's editable scope (`@maleo/shared/editor/storyboard-scope`). Entries
  are ordered by their own per-project `seq` (`MAX(seq) + 1` under the same
  lock) and name the version they wrote. Retention deletes a pruned version's
  entry in the same transaction; the newest entry is never pruned, so a `seq`
  is never reused. A refused submitted command is kept by client command id
  in `content_project_command_rejections`, so a retry returns the same refusal.
- A project's media library is its `project_media_assets` rows
  (`project-media-assets.ts`), unique by URL within the project and written only
  under the same `storyboard-version:<project>` lock, together with a log entry.
  An entry that changes only the library has `version` NULL and writes no
  storyboard version; retention deletes versionless entries whose `seq` is below
  the oldest remaining versioned entry, in the transaction that prunes versions.
  A project's stored `media_assets` list (editor state, then head document) is
  imported once, on the first library read, and `media_library_imported_at` marks
  it done.
- Read a version by number through `readStoryboardVersion`, which answers
  found, pruned, never existed, or read failed — never a substitute version.

## Reclaiming storyboard history

Legacy SQLite databases written before retention existed hold unbounded
history. Reclaim it deliberately, before `bun run db:migrate-from-sqlite` if you
want a smaller carry-over; this works on the SQLite file (`MALEO_DB_PATH`):

1. `bun run storyboards:reclaim` — dry run; reports versions and bytes per
   project and removes nothing. Review it.
2. Stop the api and workers, and back up `data/maleo.db`.
3. `bun run storyboards:reclaim --apply --vacuum` — deletes in batches of 500,
   one transaction each, so an interrupted run is consistent and a re-run
   finishes it; then `VACUUM`, which needs free disk space about the size of the
   retained database and holds the write lock until done. Without `--vacuum`
   the rows are gone but the file does not shrink.

## Verification

```bash
cd packages/db
bun run test       # Vitest suites (the root setup file runs the guard)
bun run test:bun   # *.bun.test.ts; bunfig preloads the guard: a throwaway cluster, never data/postgres
bun run typecheck
```
