# schema-ownership Specification

## Purpose

Where a table or column may be declared. Written after a SQLite table rebuild
destroyed `editor_state_json` for 141 projects because the column was created
outside the declaration the rebuild read; the rule outlived the rebuild.

## Requirements

### Requirement: One declaration owns every table and column

The system SHALL declare every runtime table and every column in one place: the
ordered migration sequence. Applying it to an empty database SHALL produce the
current schema exactly. No other module SHALL create a table or add a column,
including through a guarded `ALTER TABLE ... ADD COLUMN` at startup. The list of
runtime tables SHALL be derived from that sequence rather than maintained
alongside it.

Ownership is expressed as versioned migrations rather than as an idempotent
declaration reconciled at every open. A reconcile pass cannot express a data
transformation, cannot be reviewed as a sequence, and performs schema change
inside a startup path. The ownership rule is unchanged; only where it is written
down has moved.

One exception SHALL exist: tables owned by the authentication library, which
generates and migrates its own schema. Those tables SHALL be identified by a
declared name prefix, SHALL be listed explicitly rather than matched loosely, and
SHALL NOT be referenced by foreign key from a table the migration sequence owns.
The migration sequence SHALL NOT create, alter, or drop them, and the ownership
test SHALL treat them as out of scope rather than as a violation.

The exception is bounded on purpose: it admits one library's own core tables, not
a general licence for features to create tables on demand, and not the tables a
feature builds _on top of_ that library. Membership between accounts and
workspaces is declared in the migration sequence like every other table, because
it joins two concepts this repository owns and only borrows an identifier from
the library.

#### Scenario: A column added outside the declaration is rejected

- **WHEN** a module other than the migration sequence adds a column at open time
- **THEN** the build fails, because the schema check compares the database against the sequence and cannot see that column

#### Scenario: The runtime table list cannot drift

- **WHEN** a table is added by a migration
- **THEN** it appears in the runtime table list automatically, without a second edit

#### Scenario: Feature tables are not created on demand

- **WHEN** a feature needs its own tables in the shared database
- **THEN** those tables are added by a migration like every other table, not created lazily by the feature's service

#### Scenario: Auth-owned tables are present

- **WHEN** the ownership test runs against a database the authentication library has migrated
- **THEN** the auth-owned tables are recognised as externally owned and the test passes

#### Scenario: A table appears under the auth prefix that is not declared

- **WHEN** a table matching the auth prefix exists but is absent from the explicit exemption list
- **THEN** the test fails, because the exemption is a list and not a pattern

#### Scenario: A schema-owned table references an auth-owned table

- **WHEN** a table owned by the migration sequence declares a foreign key into an auth-owned table
- **THEN** the test fails, because the two schemas migrate independently

#### Scenario: Membership is schema-owned

- **WHEN** the workspace membership table is checked against the exemption list
- **THEN** it is absent from it and created by the migration sequence, and it holds the account identifier as a plain column rather than a foreign key
