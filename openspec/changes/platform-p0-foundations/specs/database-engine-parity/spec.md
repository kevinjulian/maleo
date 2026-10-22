## MODIFIED Requirements

### Requirement: Development and production run the same database engine

The system SHALL use PostgreSQL in every server environment. A development
server SHALL NOT run a different engine or a different SQL dialect from a
production server.

Two engines means two dialects, two sets of behaviour under concurrency, and a
class of defect that only appears after deployment.

A client device (web, desktop or mobile) MAY keep a local SQLite store for its
own copy of projects and media state. A client store SHALL NOT be a server
environment. The server SHALL hold the canonical copy of synced data in
PostgreSQL, and no server code path SHALL read or write a client store.

#### Scenario: A query behaves differently between environments

- **WHEN** a query runs on a development server and on a production server
- **THEN** it runs against the same engine and the same dialect

#### Scenario: A dialect-specific construct is used

- **WHEN** server code uses a Postgres-specific construct
- **THEN** it works on a development server without a compatibility shim

#### Scenario: A client keeps a local store

- **WHEN** a client device stores projects locally in SQLite
- **THEN** the server's canonical copy stays in PostgreSQL and no server code path depends on SQLite
