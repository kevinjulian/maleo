# database-engine-parity Specification

## Purpose

Which database engine each environment runs, how development and tests get one without external setup, and how the application connects to it.

## Requirements

### Requirement: Development and production run the same database engine

The system SHALL use PostgreSQL in every environment. A development environment
SHALL NOT run a different engine or a different SQL dialect from production.

Two engines means two dialects, two sets of behaviour under concurrency, and a
class of defect that only appears after deployment.

#### Scenario: A query behaves differently between environments

- **WHEN** a query runs in development and in production
- **THEN** it runs against the same engine and the same dialect

#### Scenario: A dialect-specific construct is used

- **WHEN** code uses a Postgres-specific construct
- **THEN** it works in development without a compatibility shim

### Requirement: Development requires no externally managed database

Starting the project for development SHALL NOT require the developer to install,
configure, or run a database service. The setup command SHALL provision a working
database.

#### Scenario: A fresh checkout is started

- **WHEN** a developer runs setup and then the development command on a machine with no database installed
- **THEN** the application starts against a working database with no further steps

#### Scenario: An external database is configured

- **WHEN** a connection to an external Postgres is configured
- **THEN** it is used instead of the embedded one, selected by configuration alone

### Requirement: Tests run against the same engine without shared state

A test SHALL be able to obtain an isolated database of the same engine without
setting a process-global path or resetting a module singleton, and SHALL NOT see
state from another test.

#### Scenario: A test needs a database

- **WHEN** a test exercises a database function
- **THEN** it obtains an isolated database of the same engine, with no environment variable and no singleton reset

#### Scenario: Tests run concurrently

- **WHEN** two tests using databases run at the same time
- **THEN** neither observes the other's rows

### Requirement: Connection credentials and transport are specified

A deployment SHALL take its database connection from configuration, SHALL hold
the credential as a secret rather than in plaintext configuration, and SHALL
require an encrypted connection when the database is not on the same host.

#### Scenario: A deployment connects to a managed database

- **WHEN** the application connects to a database over a network
- **THEN** the connection is encrypted and the credential is supplied as a secret

#### Scenario: The credential is absent

- **WHEN** the application starts in production without a database credential
- **THEN** it fails at startup naming the missing configuration
