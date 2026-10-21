<!-- Generated: 2026-09-09 -->

# Database Package

`@maleo/db` owns the Postgres runtime schema and database access. Consumers import
entity-family subpaths such as `@maleo/db/project-detail` or
`@maleo/db/image-ledger`.

## Shape

```text
packages/db/src/
  data-path.ts       MALEO_DATA_DIR / MALEO_DB_PATH resolution
  db/
    database-config.ts  MALEO_DATABASE_URL, or embedded server, TLS rule
    connection.ts    runtime pool: connect, migrate, bootstrap fixtures
    pg.ts / pg-embedded.ts  postgres.js client; embedded dev server
    migrate.ts       numbered migrations, checksummed, advisory-locked
    schema.ts        table ownership, derived from migrations
    handle.ts        Db handle: ? placeholders, transactions, serialize()
    pg-testing.ts / handle-testing.ts  throwaway databases for tests
    legacy-sqlite.ts / unified-schema.ts  old SQLite file, carry-over only
    workspace-config.ts  workspace configuration rows
    row-json.ts      JSON-column decoding
    storyboard-retention.ts  which storyboard versions a project keeps; pruned on write
    <family>.ts      queries and writes for one entity family
```

Families include projects, project children, materials, presets, storyboards,
timeline and clip templates, assets, references, campaigns, renders, outputs,
events, workflow runs, generation ledgers/jobs, settings, and encrypted secrets.

## Boundary

- Database package owns no HTTP routes, workspace config validation, provider execution,
  subprocesses, or Inngest functions.
- Workspace configuration validation lives in `apps/api/src/lib/config-yaml.ts`
  and `apps/api/src/lib/workspace/`; this package only stores the text.
- Pure cross-runtime contracts live in `@maleo/shared`.
- `migrations/*.sql` are the sole schema owner; no module creates or alters its
  own table. better-auth's `auth_*` tables are the listed exception.

## Verification

```bash
cd packages/db
bun run typecheck
bun run test       # Vitest suites; add a file path to run one
bun run test:bun   # suites that need the Bun runtime (*.bun.test.ts)
```
