# ADR 0005: The runtime database is Postgres in every environment, changed only by versioned migrations

- Status: Accepted; client stores scoped by 0007
- Date: 2026-09-26
- Deciders: Kevin Julian
- Related: OpenSpec `migrate-to-postgres`

## Context

The runtime database was one `bun:sqlite` file. SQLite admits one writer, so the
API could run as exactly one replica, and a deploy had to stop the old process
before starting the new one. Both are operational limits that no amount of
query tuning removes.

The schema was kept by reconcile-at-open: every start renamed legacy columns by
scanning `sqlite_master`, then ran some 1,360 lines of `CREATE TABLE IF NOT
EXISTS`. That cannot express a data transformation, cannot be reviewed as a
sequence, and cannot tell "not yet applied" from "failed half way". It also
leaves drift behind: columns SQLite gained through `ALTER TABLE ADD COLUMN` stayed
nullable where the declared schema said `NOT NULL DEFAULT`, which the carry-over
into Postgres found in real data.

The move measured slower, and anyone who reads the numbers will ask why SQLite
was given up. SQLite runs in-process; every Postgres query is a socket round
trip. On the same real data (task 8.1 of the change), the p50 costs were:

| path                     | SQLite       | Postgres     |
| ------------------------ | ------------ | ------------ |
| storyboard version write | 0.66 ms      | 1.61 ms      |
| project detail read      | 0.32–0.44 ms | 1.70–1.91 ms |
| project event write      | 0.18 ms      | 0.21 ms      |

Workspace configuration was a second store: YAML files on the same volume, with
no transactions and no constraints, validated only when read.

## Decision

- Run Postgres everywhere. Production connects through `AINCER_DATABASE_URL`,
  with TLS required off-host. Development runs an embedded Postgres from real
  binaries under `data/postgres`, so it needs no installed database. Do not run
  SQLite in development and Postgres in production: two dialects produce a
  class of defect that only appears after deploy.
- Change the schema only by adding a numbered migration under
  `packages/db/migrations/`. The runner records each migration's checksum,
  refuses one edited after it was applied, and a failed migration stops the
  process rather than serving a half-migrated schema. Nothing repairs the
  schema at open.
- Store workspace configuration as rows, validated on write.
- Serialise read-decide-write transactions with `serialize(tx, scope)`, a
  transaction-scoped advisory lock, rather than relying on SERIALIZABLE
  retries.

## Consequences

- The API can run more than one replica and deploy blue/green.
- Each query pays one round trip, about 1–1.5 ms more per multi-query read. When
  that matters, issue a read's independent queries concurrently; it is not a
  reason to return to an in-process engine.
- Every data-access function is async, and the awaiting reaches every caller.
  An un-awaited promise in a condition is always truthy and fails open. The
  port found and fixed several, including membership and SSRF checks, so treat
  a missing `await` on a data-access call as a security defect.
- Operators run one carry-over from SQLite (`bun run db:migrate-from-sqlite`).
- The media worker's and the video server's databases remain process-local
  SQLite. Revisit this if either needs more than one replica.
- Revisit the engine only if the single-replica limit stops mattering, for
  example if the product becomes a single-user desktop app. Speed alone does
  not justify it.
