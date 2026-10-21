# database-module-structure Specification

## Purpose

TBD - created by archiving change deepen-db-and-editor-modules. Update Purpose after archive.

## Requirements

### Requirement: One module per entity family

The system SHALL organise database access as one module per entity family, where a
family owns the tables it reads and writes. A module SHALL NOT hold families that
do not share tables.

#### Scenario: A route's data access has one home

- **WHEN** a route needs the functions for one entity family
- **THEN** it imports them from that family's module, and the module's name names the tables it owns

#### Scenario: Cross-family reads live above the families

- **WHEN** a read aggregates several families, such as a project detail
- **THEN** it lives in a module that composes the family modules rather than inside one of them

#### Scenario: An export with no caller is deleted, not kept

- **WHEN** an exported function has no reference anywhere in the repository
- **THEN** it is removed rather than carried into the new module

### Requirement: The database handle is a parameter

The system SHALL let every database function accept its handle as a defaulted
parameter, so a caller can supply its own. A test SHALL NOT need to set a
process-global path or reset a module singleton to reach a function.

The handle is a Postgres connection or transaction. A function SHALL accept
either, so a caller composing several writes can pass its transaction and have
them commit or roll back together.

Database functions are asynchronous, because the driver is. A function SHALL NOT
block on a query.

#### Scenario: A test supplies its own database

- **WHEN** a test exercises a database function
- **THEN** it passes an isolated handle and needs no environment variable and no singleton reset

#### Scenario: Production keeps one pool

- **WHEN** a caller supplies no handle
- **THEN** the shared connection pool is used

#### Scenario: A caller composes several writes

- **WHEN** a caller performs several database operations that must apply together
- **THEN** it passes its transaction to each, and they commit or roll back as one

#### Scenario: A handle is held across an await

- **WHEN** a caller holds a handle across an asynchronous boundary
- **THEN** the connection is returned to the pool rather than held for the lifetime of the caller

### Requirement: No raw SQL outside a family module

The system SHALL keep raw SQL inside the entity-family module that owns the table.
No route, service, provider, agent step, or test outside `packages/db` SHALL
write SQL against a runtime table.

This rule is what makes an engine change tractable: it is why this migration
touches one package rather than every caller.

#### Scenario: A feature needs a query

- **WHEN** a feature outside the database package needs data
- **THEN** it calls a family-module function, and contains no SQL of its own

#### Scenario: SQL appears outside a family module

- **WHEN** SQL against a runtime table is written outside `packages/db`
- **THEN** a check fails naming the file

#### Scenario: A test reaches for the database directly

- **WHEN** a test needs database state
- **THEN** it uses family-module functions, so it is unaffected by an engine change

### Requirement: A handle is forwarded, not just accepted

A database function that holds a handle SHALL pass it to every database function it calls.
Relying on the callee's default while holding a handle SHALL be a defect, even though the call
compiles and the callee runs.

A function that accepts a handle and then calls a sibling without it reads from two databases
at once: its own queries from the caller's handle, and the sibling's from the shared
connection. Accepting the handle is not the contract — the contract is that every read and
write in one call tree reaches the same database.

#### Scenario: An aggregate reads one database

- **WHEN** a function that reads several entity families is given a handle
- **THEN** every family it reads comes from that handle
- **AND** no family falls back to the shared connection

#### Scenario: A seeded record is visible to its own reader

- **WHEN** a test seeds a record through one function and reads it back through another that
  composes the first, passing the same in-memory handle to both
- **THEN** the record is returned

#### Scenario: A missed forward is caught by inspection

- **WHEN** a database function holding a handle calls another database function without
  passing it
- **THEN** the guard over the database modules fails and names the caller and the callee

### Requirement: Database package owns database access only

The workspace SHALL expose database schema, connection, migration, and entity-family query modules from `@maleo/db`. The package SHALL NOT own workspace-file loading, provider execution, HTTP behavior, or generic runtime utilities.

#### Scenario: Consumer needs persistent data

- **WHEN** API or a repository script needs database access
- **THEN** it imports the owning entity-family module from `@maleo/db`

#### Scenario: Consumer needs workspace configuration

- **WHEN** API loads or edits workspace files, paths, branding, or file-backed secrets
- **THEN** that behavior is imported from API-owned workspace modules rather than `@maleo/db`

### Requirement: Core package is fully retired

After migration, `packages/core` and active `@maleo/core` references SHALL be absent from source, manifests, scripts, tests, current docs, and the lockfile. Historical OpenSpec artifacts and git history MAY retain the old name.

#### Scenario: Workspace topology is checked

- **WHEN** current repository surfaces are scanned for `packages/core` and `@maleo/core`
- **THEN** no active reference remains
- **AND** database behavior is covered through `@maleo/db` tests
