# Workspace Tenancy

## Purpose

`workspace` is the multi-tenant partition key and configuration unit that replaced `persona`
across storage, config, and routing when maleo pivoted to a content studio.

## Requirements

### Requirement: Workspace is the tenant partition key

The system SHALL scope all multi-tenant storage by a `workspace` key, replacing the
former `persona` key. Every table that was scoped by `persona TEXT NOT NULL` SHALL be
scoped by `workspace TEXT NOT NULL`, and every index or composite primary key that
included `persona` SHALL include `workspace` in the same position.

#### Scenario: Row is scoped by workspace

- **WHEN** any tenant-scoped row (content project, generation job, memory) is written
- **THEN** it carries a non-null `workspace` value and no `persona` column exists

#### Scenario: Migration renames without reshaping data

- **WHEN** the persona→workspace migration runs against an existing database
- **THEN** each `persona` column is renamed to `workspace`, indexes are rebuilt on `workspace`, and row data is otherwise unchanged

### Requirement: Workspace is the config unit

The system SHALL treat a `workspace` as the configuration unit formerly known as a persona.
A workspace SHALL be defined by its stored configuration rows, and config loading, scaffolding,
and secrets resolution SHALL key on workspace identity.

Workspace configuration is database state, not a file. `config.yaml` is no longer read or written
at runtime; it survives only as an input to the one-time migration.

#### Scenario: Load a workspace config

- **WHEN** the system loads configuration for a workspace
- **THEN** it reads the stored configuration, validates the slim workspace schema (identity/branding, generation policy, style defaults), and rejects removed persona blocks

#### Scenario: Scaffold a workspace

- **WHEN** a workspace is created
- **THEN** its configuration is written as rows within one transaction, and no configuration file is created

#### Scenario: A legacy configuration file is present

- **WHEN** a `config.yaml` remains on disk after migration
- **THEN** it is ignored at runtime, and the stored configuration is authoritative

### Requirement: No persona identifiers remain

The system SHALL contain no `persona`-named tenant identifiers in storage schema, config
schema, routing, or public API surfaces. Identity anchors formerly on the persona
(`character`) SHALL be reachable as workspace-scoped reference entities that projects select into
their roster; voice traits SHALL be reachable as the style-direction voice layer.

#### Scenario: Character anchor preserved after removal

- **WHEN** a workspace that previously defined `persona.character` generates an image
- **THEN** the character appearance is supplied via a workspace reference entity selected into the project, not a persona field

#### Scenario: Character is reusable across projects in the workspace

- **WHEN** a workspace defines a character entity and two projects in that workspace generate images
- **THEN** both projects select the same entity by id, and no per-project copy of the character is created

### Requirement: Content projects carry the workspace partition key

The system SHALL scope content projects by `workspace`, so that a project's reference library,
assets, and generated output resolve to exactly one tenant. The system SHALL NOT leave content
projects untenanted.

The partition key SHALL be READ, not merely written. A project list that ignores the
key returns every tenant's projects at once, which leaves the projects tenanted in
storage and untenanted in every surface an operator uses — the state this system was
in when the key had been carried for 18,159 projects and read by no content query.

Every tenant that owns projects SHALL be registered, so that the partition it names
can be selected and its projects reached.

#### Scenario: Project row carries a workspace

- **WHEN** a content project is created
- **THEN** it carries a non-null `workspace` value

#### Scenario: Project resolves one library

- **WHEN** a project's reference library is listed
- **THEN** only reference entities belonging to that project's workspace are returned

#### Scenario: Existing projects are backfilled

- **WHEN** the migration runs against projects created before the column existed
- **THEN** each project is assigned a workspace, and no project is left with a null workspace

#### Scenario: Listing projects honours the partition

- **WHEN** content projects are listed for a tenant
- **THEN** only that tenant's projects are returned

#### Scenario: A tenant owning projects can be reached

- **WHEN** projects belong to a workspace
- **THEN** that workspace is registered and can be selected

### Requirement: Workspace configuration carries the writer style selection

Workspace configuration SHALL carry the writer style selection as a workspace-level constant,
stored as the profile's key rather than as a copy of the profile's fields. Storing the key means
a profile's craft parameters can be corrected in the library without migrating stored workspaces.

The field SHALL be optional. A workspace that has never selected a writer style SHALL be valid,
and configuration loading SHALL NOT substitute a default for an absent selection.

A stored key that no longer exists in the profile library SHALL load successfully and resolve to
no writer style, so retiring a profile cannot make an existing workspace unloadable.

#### Scenario: Selection is stored as a key

- **WHEN** a workspace's writer style is persisted
- **THEN** configuration stores the profile key
- **AND** it does not store a copy of the profile's craft parameters

#### Scenario: Absent selection is valid

- **WHEN** workspace configuration carries no writer style
- **THEN** the workspace loads
- **AND** no default profile is substituted

#### Scenario: Retired profile key still loads

- **WHEN** workspace configuration carries a writer style key absent from the library
- **THEN** the workspace loads
- **AND** it resolves to no writer style

#### Scenario: Library correction reaches existing workspaces

- **WHEN** a profile's craft parameters change in the library
- **THEN** workspaces storing that profile's key resolve to the corrected parameters without a migration
