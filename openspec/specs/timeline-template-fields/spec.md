# timeline-template-fields Specification

## Purpose

TBD - created by archiving change retire-dead-timeline-template-fields. Update Purpose after archive.

## Requirements

### Requirement: A render-scope defaulter does not write project-scope values

A timeline template SHALL NOT set any value the project owns. Selecting a template SHALL
record which template is selected and SHALL change nothing else about the project.

A defaulter at one scope SHALL NOT write an element at another scope without leaving a
record of having done so. Where no such record can be kept, it SHALL NOT write at all.

#### Scenario: Selecting a template records only the selection

- **WHEN** an operator selects a timeline template
- **THEN** the project records which template is selected
- **AND** the project's background is unchanged
- **AND** the project's generation reference lock is unchanged

#### Scenario: A previously seeded value is left alone

- **WHEN** a project whose background was seeded by an earlier template selection is opened
- **THEN** that background is preserved as the project's own value
- **AND** it is not re-derived from, or reset by, the selected template

### Requirement: The project's settings own the render background

A timeline template SHALL NOT carry a render background. The background used by a render
SHALL come from the project's own settings, which are the single owner of that value.

#### Scenario: Template carries no background field

- **WHEN** a timeline template is read
- **THEN** it exposes no render background field
- **AND** the template editor offers no background control

#### Scenario: Render background comes from the project

- **WHEN** a video is rendered
- **THEN** its background is the value carried by the project's settings
- **AND** no template field participates in resolving it

#### Scenario: An existing project keeps the background it already has

- **WHEN** a timeline template stored with a background value is migrated
- **THEN** the stored value is discarded
- **AND** projects that had already been seeded from it keep the background in their own settings, so what they render does not change

#### Scenario: A newly selected template no longer supplies a background

- **WHEN** an operator selects a template after this change
- **THEN** the project keeps whatever background it had
- **AND** the operator sets the background themselves if they want a different one

### Requirement: A timeline template carries no reference lock

A timeline template SHALL NOT carry a list of reference entity ids. A project's generation
reference lock SHALL come from the operator's own selection alone.

#### Scenario: Template carries no reference ids

- **WHEN** a timeline template is read
- **THEN** it exposes no reference id list
- **AND** the template editor offers no reference picker

#### Scenario: A run's lock is the project's selection

- **WHEN** an agent run starts for a project with a selected timeline template
- **THEN** the run's generation reference lock is exactly the project's own selection
- **AND** no template value is merged into it

#### Scenario: Selecting a template pre-selects nothing

- **WHEN** an operator selects a timeline template
- **THEN** no reference is added to the project's generation lock as a result

#### Scenario: Migration reports what it discards

- **WHEN** stored timeline templates are migrated
- **THEN** the migration reports how many rows carried a non-empty reference id list before discarding those values

### Requirement: The mention affordance on the image-guidance prompt survives

Removing the template's reference id list SHALL NOT remove the `@reference` autocomplete on
the image-guidance prompt. The mention text is part of the prompt, which is read at render;
only the separately stored id list is retired.

#### Scenario: Autocomplete still offers references

- **WHEN** an operator types a mention trigger in the image-guidance prompt
- **THEN** matching references are offered and the chosen one is inserted as text

#### Scenario: The prompt text still reaches generation

- **WHEN** an image-guidance prompt containing a mention is resolved for a render
- **THEN** the mention text is present in the resolved prompt

### Requirement: The intro and section fields are named for the preset kind they resolve to

The fields selecting a timeline template's intro and section titling SHALL be named for the text preset they resolve to, not for the unrelated motion preset entity. A field name SHALL NOT refer to an entity the field has no relationship with.

#### Scenario: Fields name the text preset

- **WHEN** a timeline template is read
- **THEN** its intro and section titling fields are named as text preset selections

#### Scenario: Renamed fields resolve unchanged

- **WHEN** a template's intro or section titling is resolved for a render
- **THEN** it resolves to the same text preset the pre-rename field resolved to
- **AND** the rendered titling is unchanged

#### Scenario: Existing template survives the rename

- **WHEN** a timeline template stored under the old field names is read after the rename
- **THEN** it parses successfully and its titling selections are preserved

### Requirement: Project presets select video templates without owning them

A Project Preset SHALL be able to name one selected Video Template. Selecting a Project Preset during create flow SHALL auto-select that Video Template for the project. The Project Preset SHALL NOT copy the Video Template fields into itself as editable preset-owned values.

An operator SHALL be able to override the selected Video Template after choosing a Project Preset. Overriding the template SHALL NOT mutate the Project Preset.

#### Scenario: Preset auto-selects video template

- **WHEN** an operator selects a Project Preset that names a Video Template
- **THEN** the create flow auto-selects that Video Template

#### Scenario: Template override leaves preset unchanged

- **WHEN** an operator changes Video Template after selecting a Project Preset
- **THEN** the project uses the overridden Video Template
- **AND** the Project Preset continues to name its original Video Template

#### Scenario: Preset stores template identity

- **WHEN** a Project Preset is saved with a Video Template
- **THEN** the preset stores the template identity, not a duplicate editable copy of the template's fields

### Requirement: Animated Systems Explainer selects a Video Template identity

The `Animated Systems Explainer` built-in Project Preset SHALL name one Video Template identity suited to animated systems explainer output. The Project Preset SHALL store only that identity and SHALL NOT duplicate template-owned fields such as pacing, timing, transitions, section policy, or render policy.

If the selected template ships with the product, it SHALL be persisted as a read-only fixture Video Template row with an immutable slug, and SHALL remain readable in a fresh workspace without a workspace row. Fixture bootstrap SHALL resolve the template slug to the local template id stored by the Project Preset.

Shipped Video Templates SHALL NOT be edited in place. An edit SHALL fork the template into a user-owned Video Template. An operator edit made to a shipped template before this behavior existed SHALL be preserved as a user-owned Video Template rather than overwritten by fixture bootstrap.

#### Scenario: Preset selects explainer template

- **WHEN** an operator selects `Animated Systems Explainer` during content creation
- **THEN** the project receives the preset's selected Video Template identity
- **AND** the selected template can be resolved for preview and render

#### Scenario: Preset does not copy template policy

- **WHEN** `Animated Systems Explainer` is read as a Project Preset
- **THEN** its bundle carries a Video Template identity
- **AND** it does not carry editable preset-owned copies of the selected template's timing, transition, or render-policy fields

#### Scenario: Template override leaves preset unchanged

- **WHEN** an operator changes the Video Template after selecting `Animated Systems Explainer`
- **THEN** the project uses the overridden Video Template
- **AND** the built-in Project Preset remains unchanged

#### Scenario: Fixture template keeps local id

- **WHEN** fixture bootstrap updates the shipped animated systems Video Template
- **THEN** the existing fixture row is found by slug
- **AND** its local id remains unchanged

#### Scenario: Editing a shipped template forks it

- **WHEN** an operator edits a shipped Video Template and saves
- **THEN** the edit is applied to a user-owned Video Template
- **AND** the shipped template keeps the values it ships with

#### Scenario: An earlier in-place edit is not overwritten

- **WHEN** a database holds a shipped Video Template row an operator edited before fixtures existed
- **AND** fixture bootstrap runs for the first time
- **THEN** the operator's values survive as a user-owned Video Template
- **AND** the fixture row carries the shipped values
