# fixture-library-records Specification

## Purpose

Shipped built-in library rows — Project Presets, Materials, and Video Templates — are persisted as read-only fixture records rather than virtual code rows. Fixtures carry immutable slugs, bootstrap idempotently, live once per database outside any workspace, sort ahead of user rows, and fork into user-owned copies on edit.

## Requirements

### Requirement: Library records use local ids and immutable slugs

Project Presets, Materials, and Video Templates SHALL each carry a local id and an immutable slug. The id SHALL be the relational identity used by stored references inside the local database. The slug SHALL be the stable logical identity used for fixture bootstrap, fixture updates, import/export resolution, and debugging.

Every fixture row SHALL carry a slug. A row created before slugs existed MAY carry no slug until it is next written; a slug, once set, SHALL NOT change.

Ids MAY differ for the same shipped fixture across devices or databases. Fixture slugs SHALL remain stable across devices.

#### Scenario: Fixture ids differ across devices

- **WHEN** the same shipped Material fixture is bootstrapped on two devices
- **THEN** each device may store a different material id
- **AND** both rows store the same immutable fixture slug

#### Scenario: Preset uses local ids after bootstrap

- **WHEN** a fixture Project Preset is bootstrapped
- **THEN** its stored bundle references the local ids of the fixture Materials and Video Template
- **AND** the fixture slug is not required to resolve the preset during normal project creation

#### Scenario: Slug cannot be edited

- **WHEN** an operator or API client updates a Project Preset, Material, or Video Template
- **THEN** the update cannot change that row's slug
- **AND** the row keeps the slug assigned at create time

#### Scenario: A pre-existing row without a slug stays readable

- **WHEN** a Material saved before slugs existed is listed or opened
- **THEN** the row is returned normally with no slug
- **AND** no slug is invented for it on read

### Requirement: Fixture rows are stored once for all workspaces

Shipped fixture rows SHALL be stored once per database rather than copied into each workspace. Fixture Materials SHALL be stored in the reserved empty workspace scope, and Material reads for a workspace SHALL return that workspace's own rows together with the fixture rows in the reserved scope.

An operator write SHALL NOT create, move, or target a row in the reserved scope. Fixture slugs SHALL be unique across the database; user row slugs SHALL be unique within their workspace.

#### Scenario: One fixture row serves every workspace

- **WHEN** two workspaces list Materials after fixture bootstrap
- **THEN** both see the same fixture Material rows with the same ids
- **AND** the database holds one row per fixture Material slug

#### Scenario: Fixture preset bundle resolves from any workspace

- **WHEN** a project is created from a fixture Project Preset in any workspace
- **THEN** the material ids in the preset bundle resolve to the fixture Material rows
- **AND** no workspace-specific copy of those materials is required

#### Scenario: Operator writes stay out of the reserved scope

- **WHEN** an operator creates or forks a Material
- **THEN** the new row is owned by the operator's workspace
- **AND** it is not written into the reserved fixture scope

### Requirement: Fixture bootstrap is idempotent by slug

The system SHALL bootstrap shipped fixture rows by checking immutable slugs. If a fixture slug already exists, bootstrap SHALL update the existing fixture row according to the fixture definition and keep its id. If a fixture slug does not exist, bootstrap SHALL insert a new fixture row with a new local id.

Fixture Project Presets SHALL be bootstrapped after their required fixture Materials and Video Templates so their bundles can store resolved local ids.

#### Scenario: Existing fixture keeps id

- **WHEN** bootstrap runs for a fixture whose slug already exists
- **THEN** the existing row is updated in place
- **AND** its id is unchanged

#### Scenario: Missing fixture is inserted

- **WHEN** bootstrap runs for a fixture whose slug is absent
- **THEN** the system inserts a fixture row
- **AND** future bootstrap runs find that row by slug

#### Scenario: Preset bootstrap resolves fixture dependencies

- **WHEN** bootstrap creates or updates a fixture Project Preset
- **THEN** the system first resolves every required fixture Material and Video Template by slug
- **AND** the preset bundle stores the resolved local ids

#### Scenario: Bootstrap leaves user rows alone

- **WHEN** bootstrap runs in a database holding rows forked from fixtures
- **THEN** no user-owned row is created, updated, or deleted
- **AND** only rows carrying a shipped fixture slug are written

#### Scenario: Concurrent bootstrap creates one row

- **WHEN** two processes bootstrap the same absent fixture slug at the same time
- **THEN** exactly one fixture row exists for that slug afterwards
- **AND** neither process fails with a duplicate row

#### Scenario: Bootstrap does not run per read

- **WHEN** an operator lists Project Presets, Materials, or Video Templates repeatedly
- **THEN** fixture bootstrap does not re-run for each list call

### Requirement: Fixture bundles match the built-ins they replace

At the migration that first persists them, fixture Project Preset bundles SHALL carry the same values as the virtual built-in presets they replace. A project whose recorded values came from a virtual built-in SHALL NOT be reported as diverged from the corresponding fixture preset solely because the values were re-authored.

#### Scenario: Existing project does not become diverged

- **WHEN** a project created from a virtual built-in preset is compared against the fixture preset that replaced it
- **AND** no element has been edited by an operator since
- **THEN** the project is not reported as diverged

### Requirement: Retired fixtures leave the UI and stay resolvable

When a fixture slug is no longer shipped, bootstrap SHALL mark the existing fixture row as retired and SHALL NOT delete it. A retired fixture row SHALL remain resolvable by id for stored references. Renaming a fixture slug SHALL be treated as shipping a new fixture and retiring the old one.

A retired fixture SHALL NOT appear in any library list or picker, and the interface SHALL NOT present a retired state, badge, or explanation for it. Retirement SHALL NOT affect rows forked from that fixture.

#### Scenario: Unshipped fixture is retired

- **WHEN** bootstrap runs after a fixture slug is removed from the shipped definitions
- **THEN** the existing fixture row is marked retired
- **AND** the row is not deleted

#### Scenario: Retired fixture still resolves

- **WHEN** a stored reference names a retired fixture row
- **THEN** the row resolves by id for that reference
- **AND** the project or preset holding that reference still opens and renders

#### Scenario: Retired fixture is absent from the library

- **WHEN** an operator opens the library family that held a now-retired fixture
- **THEN** the fixture is absent from the list
- **AND** no retired badge, state, or placeholder is shown in its place

#### Scenario: Retirement does not reach a fork

- **WHEN** a fixture an operator had forked is retired
- **THEN** the forked user-owned row remains listed and editable

### Requirement: Fixture rows sort ahead of user rows

Library lists SHALL present fixture rows before user-owned rows, in the authored fixture order. Fixture ordering SHALL NOT depend on row timestamps, so a bootstrap that rewrites fixture rows SHALL NOT change the order an operator sees.

#### Scenario: Fixture order survives bootstrap

- **WHEN** bootstrap updates fixture rows and an operator then lists that family
- **THEN** fixtures appear first in their authored order
- **AND** the order is the same as before bootstrap ran

#### Scenario: User rows follow fixtures

- **WHEN** a workspace has its own rows alongside fixtures
- **THEN** the fixture rows are listed first
- **AND** the workspace's own rows follow under their own ordering

### Requirement: Fixture rows are read-only and fork by an explicit call

Fixture rows SHALL NOT be patched or deleted in place through user-facing or public API write flows. A write addressed to a fixture row SHALL be refused with a conflict response that names the fork step, and SHALL NOT silently redirect the write to a different row.

The system SHALL offer an explicit fork operation for Project Presets, Materials, and Video Templates. Forking SHALL create a user-owned copy in the caller's workspace with a new id and a new slug, leaving the fixture row unchanged. The copy SHALL NOT inherit the default-preset pointer.

The copy SHALL be named `<name> (copy)`. When that name is already used in the workspace, the copy SHALL take the next unused `<name> (copy N)`. Names SHALL NOT be treated as unique keys.

Forking SHALL copy the addressed row only. A forked Project Preset SHALL keep referencing the fixture Material and Video Template ids its bundle already names.

Deleting a fixture row SHALL be refused and SHALL be hidden from the user interface.

#### Scenario: Editing a fixture is refused with a fork instruction

- **WHEN** an API client patches a fixture Material, Video Template, or Project Preset
- **THEN** the system refuses the write with a conflict response naming the fork step
- **AND** the fixture row is unchanged
- **AND** no other row was written in its place

#### Scenario: Operator edit forks then applies

- **WHEN** an operator edits a fixture row in the library and saves
- **THEN** the UI forks the fixture into a user-owned row and applies the edit to that row
- **AND** the fixture row remains unchanged

#### Scenario: Fork is named after the fixture

- **WHEN** an operator forks a fixture named `Animated Systems Explainer`
- **THEN** the copy is named `Animated Systems Explainer (copy)`

#### Scenario: A second fork gets the next free name

- **WHEN** an operator forks the same fixture again and `Animated Systems Explainer (copy)` already exists
- **THEN** the second copy takes the next unused numbered name
- **AND** both copies remain listed

#### Scenario: Forking a preset does not clone its materials

- **WHEN** an operator forks a fixture Project Preset
- **THEN** the new preset's bundle references the same fixture Material and Video Template ids
- **AND** no copies of those materials or templates are created

#### Scenario: Fork does not become the default

- **WHEN** an operator forks the fixture Project Preset currently marked as default
- **THEN** the default pointer still names the fixture preset

#### Scenario: Deleting fixture is refused

- **WHEN** an operator or API client attempts to delete a fixture row
- **THEN** the system refuses the deletion
- **AND** the fixture row remains available

#### Scenario: User copy is editable

- **WHEN** an operator edits the user-owned copy created from a fixture
- **THEN** the update changes the user-owned row
- **AND** the original fixture row remains unchanged

### Requirement: Operator edits to shipped rows survive the move to fixtures

Where a shipped row was editable in place before this change, the migration SHALL detect a row that differs from its shipped definition and SHALL copy it into a user-owned row before bootstrap rewrites the fixture row. A shipped row that matches its shipped definition SHALL be adopted as the fixture row and SHALL keep its id.

#### Scenario: Edited shipped template is preserved

- **WHEN** an operator has edited a shipped Video Template in place and the migration runs
- **THEN** the operator's version is kept as a user-owned Video Template
- **AND** the fixture row is rewritten from the shipped definition

#### Scenario: Untouched shipped template is adopted

- **WHEN** a shipped Video Template row matches its shipped definition and the migration runs
- **THEN** the row becomes the fixture row
- **AND** its id is unchanged
- **AND** no user-owned copy is created
