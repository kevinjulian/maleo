# schema-migration-versioning Specification

## Purpose

How schema changes are written, ordered, applied, and verified, and how data from the previous SQLite database is carried over.

## Requirements

### Requirement: Schema changes are ordered, versioned migrations

The system SHALL express every schema change as a numbered migration applied in
order. A migration SHALL run at most once against a database, and the system
SHALL record which migrations have been applied.

The previous approach reconciled an idempotent declaration at every open and
introspected existing columns to decide what to alter. That cannot express a data
transformation, cannot be reviewed as a sequence, and hides a destructive change
inside a startup path.

#### Scenario: A database is opened twice

- **WHEN** the application opens a database that is already at the current version
- **THEN** no migration runs

#### Scenario: A new migration is added

- **WHEN** a migration is added and the application starts
- **THEN** only that migration runs, and the recorded version advances

#### Scenario: A migration fails partway

- **WHEN** a migration fails
- **THEN** it is rolled back, the recorded version does not advance, and the application refuses to serve against a partially migrated database

### Requirement: An applied migration is never edited

A migration that has been applied to any deployed database SHALL NOT be modified.
A correction SHALL be a new migration.

#### Scenario: A mistake is found in a released migration

- **WHEN** an applied migration is found to be wrong
- **THEN** a new migration corrects it, and the original is left unchanged

#### Scenario: An applied migration is edited

- **WHEN** a migration's content changes after it has been applied
- **THEN** a check detects the change and fails

### Requirement: The schema is derivable from the migrations alone

Applying every migration in order to an empty database SHALL produce the current
schema exactly. No table or column SHALL exist that the migration sequence does
not create.

#### Scenario: A fresh database is built

- **WHEN** every migration is applied in order to an empty database
- **THEN** the resulting schema matches the schema of a migrated existing database

#### Scenario: A column is added outside the migrations

- **WHEN** a module creates a table or adds a column outside the migration sequence
- **THEN** a check fails

### Requirement: Migration from the previous SQLite database is available and verified

A one-time migration SHALL be available to carry an existing SQLite database into
Postgres. It SHALL verify that it moved what it read, and SHALL be re-runnable
after a failure without duplicating rows.

#### Scenario: An existing deployment migrates

- **WHEN** the one-time migration runs against a populated SQLite database
- **THEN** every table's row count matches afterwards, and the check is reported

#### Scenario: The migration is interrupted

- **WHEN** the migration fails partway and is run again
- **THEN** it completes without duplicating previously moved rows

#### Scenario: A value cannot be carried over

- **WHEN** a value cannot be represented in the target schema
- **THEN** the migration stops and names the table, row, and column, rather than dropping or coercing it
