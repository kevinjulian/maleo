# workspace-configuration-storage Specification

## Purpose

Where workspace configuration lives, how it is validated and written, and how YAML-defined workspaces are carried over.

## Requirements

### Requirement: Workspace configuration is stored in the database

Workspace identity and configuration SHALL be stored as database rows. The system
SHALL NOT read or write workspace configuration from a YAML file on disk at
runtime.

#### Scenario: A workspace is created

- **WHEN** a workspace is created
- **THEN** its configuration is written as rows, and no configuration file is created on disk

#### Scenario: Configuration is read

- **WHEN** workspace configuration is loaded
- **THEN** it is read from the database, and the process does not consult the filesystem

#### Scenario: A configuration file is present on disk

- **WHEN** a legacy workspace configuration file exists after migration
- **THEN** it is ignored, and the database remains the only source of truth

### Requirement: Stored configuration is validated on write

Workspace configuration SHALL be validated against its schema when written, and a
write that fails validation SHALL be refused.

Validation previously happened when parsing a file at load time, which meant an
invalid configuration could be saved and only fail later.

#### Scenario: Invalid configuration is submitted

- **WHEN** configuration that does not satisfy the workspace schema is written
- **THEN** the write is refused naming the invalid field, and the stored configuration is unchanged

#### Scenario: Configuration is read back

- **WHEN** stored configuration is read
- **THEN** it satisfies the schema, because it could not have been written otherwise

### Requirement: Configuration changes are transactional with the data they affect

A change to workspace configuration made alongside other database work SHALL
succeed or fail as one unit.

#### Scenario: A workspace is created with related records

- **WHEN** creating a workspace also writes related rows and one write fails
- **THEN** none of them are applied, and no partially created workspace remains

### Requirement: Existing YAML workspaces are carried over

The one-time migration SHALL carry existing workspace configuration files into
the database, and SHALL stop rather than guess when a file cannot be interpreted.

#### Scenario: A deployment with existing workspaces migrates

- **WHEN** the migration runs against a data directory holding workspace configuration files
- **THEN** every workspace appears in the database with its configuration intact

#### Scenario: A configuration file is unreadable or invalid

- **WHEN** a workspace configuration file cannot be parsed or fails validation
- **THEN** the migration stops and names the file, rather than creating a workspace with defaults

### Requirement: Secrets do not move into unencrypted configuration rows

Workspace secrets SHALL remain in the encrypted secret store. A configuration row
SHALL NOT hold a credential in plaintext.

#### Scenario: A workspace with secrets is migrated

- **WHEN** a workspace holding secrets is carried over
- **THEN** its secrets remain encrypted at rest and no plaintext credential appears in a configuration row

#### Scenario: A credential is written to configuration

- **WHEN** code attempts to store a credential in a workspace configuration row
- **THEN** a test fails naming the field
