# data/ — agent instructions

## Purpose

`data/` holds mutable runtime state shared by the API, the web client and the
media worker. Its location is `AINCER_DATA_DIR` (default `<repo>/data`), and the
database within it is `AINCER_DB_PATH` (default `<AINCER_DATA_DIR>/aincer.db`).

## Ownership

- `workspaces/` stores per-workspace runtime state, one directory per workspace.
- `aincer.db` stores the unified runtime tables, alongside its `-wal` and `-shm`
  sidecars.
- `skills/*.yaml` stores runtime-editable workflow skill definitions.
- `cache/` and `caption-cache/` store derived artifacts that can be regenerated.
- `archived/` stores retired local state.
- `master.key` encrypts stored provider credentials. It is the one thing a
  database dump does not contain, so losing it loses every saved credential.

Everything here except this file is gitignored, and that is deliberate.

## Local Contracts

- Treat everything here as user data first, source code second.
- Never delete, rename, or mass-rewrite a workspace directory without explicit
  user confirmation.
- Never commit secrets, DB snapshots, WAL files, `master.key`, or machine-local
  debris unless the user explicitly asks.
- If a schema or config shape change makes existing runtime data stale, document
  the migration path in the owning package's docs before editing files here.

## Work Guidance

- Prefer editing generators and readers in package code over hand-editing DB
  files.
- Manual YAML edits under `skills/` must preserve the schema its readers expect.
- Keep archived material isolated under `archived/`; do not mix it back into
  active workspace folders silently.
- Database access belongs to `@aincer/db`; workspace file loading, paths and
  file-backed secrets belong to `@aincer/api`. Nothing else reads these paths
  directly.

## Verification

- When editing skill or workspace YAML, validate through the owning service
  rather than by reading the file back: `bun run api`, then the surface that
  consumes it.
- When changing runtime DB expectations, verify through the code paths that read
  them rather than opening SQLite files blindly.
