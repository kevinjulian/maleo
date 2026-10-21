# workspace-administration Specification

## Purpose

TBD - created by syncing change add-workspace-management. Update Purpose after archive.

## Requirements

### Requirement: Administration lives in one section, not scattered across surfaces

The app navigation SHALL carry a labelled Manage section holding Workspace and, for instance owners, God Mode. Workspace SHALL contain tenant-specific management. God Mode SHALL contain deployment-wide Settings and directories. An operator looking for how to change a workspace or the deployment SHALL find the appropriate destination in this section. The former global Settings URL SHALL preserve deep links for authorized owners by redirecting to the matching God Mode destination.

#### Scenario: Finding administration

- **WHEN** an instance owner opens the navigation
- **THEN** the Manage section offers Workspace for tenant management and God Mode for deployment administration

#### Scenario: Settings is unchanged

- **WHEN** an instance owner opens a former Settings capability or security view under God Mode
- **THEN** its controls and data have the same behavior, subject to the new owner authorization

#### Scenario: Finding workspace administration

- **WHEN** a workspace member opens the navigation
- **THEN** Manage contains Workspace and does not offer God Mode

#### Scenario: Finding instance administration

- **WHEN** an instance owner opens the navigation
- **THEN** Manage contains Workspace and God Mode, with global Settings under God Mode

#### Scenario: Existing Settings deep link

- **WHEN** an instance owner opens a saved global Settings address
- **THEN** the equivalent God Mode section and detail open without losing the requested level

### Requirement: The workspace surface carries its own navigation

The workspace surface SHALL present General, Members, and — separated from
them — a Danger Zone. The separation SHALL be visible, because the last group
destroys things and must not read as a third settings panel.

The panel in view SHALL be carried in the address, so a link to one panel opens
that panel.

#### Scenario: Moving between panels

- **WHEN** an operator selects Members on the workspace surface
- **THEN** the members panel is shown and the address names it

#### Scenario: A shared link opens its panel

- **WHEN** an operator opens a link to the members panel
- **THEN** they land on Members rather than on the surface's first panel

#### Scenario: The destructive group is set apart

- **WHEN** an operator views the workspace surface navigation
- **THEN** the Danger Zone is visually separated from General and Members

### Requirement: A workspace has a display name and a description its owner writes

A workspace SHALL carry a display name and a description, both editable by a
workspace owner. The description SHALL be prose the operator supplies, and
SHALL NOT be derived or defaulted from the workspace name.

The description is distinct from the branding tagline, which is derived when
absent. A field that invents its own content and a field that is blank until
someone writes it cannot be the same field.

#### Scenario: Renaming a workspace

- **WHEN** an owner changes the display name and saves
- **THEN** the new name is shown wherever the workspace is named, including the switcher

#### Scenario: Describing a workspace

- **WHEN** an owner writes a description and saves
- **THEN** it is stored and shown on the workspace surface

#### Scenario: A workspace with no description

- **WHEN** a workspace has never been given a description
- **THEN** the field is empty, and no description is generated for it

#### Scenario: The partition key does not change

- **WHEN** a workspace's display name is changed
- **THEN** the key its data is partitioned by is unchanged, and no row moves

### Requirement: Administration is restricted to workspace owners

Editing a workspace, managing its members, inviting, and deleting through its workspace surface SHALL be permitted only to an account holding the owner role in that workspace. A member without that role SHALL be refused. An instance owner SHALL have separate, explicit God Mode operations to administer any workspace, each audited; the instance role alone SHALL NOT grant use of ordinary workspace-owner routes or content routes.

#### Scenario: A member attempts to rename the workspace

- **WHEN** an account with the member role submits a change through the workspace surface
- **THEN** it is refused, and nothing is changed

#### Scenario: A member views the workspace surface

- **WHEN** an account with the member role opens the workspace surface
- **THEN** it does not offer controls it will refuse to honour

#### Scenario: Instance owner lacks workspace membership

- **WHEN** an instance owner without membership uses the ordinary workspace route
- **THEN** it is refused like any other non-member; the owner can use the audited God Mode operation instead
