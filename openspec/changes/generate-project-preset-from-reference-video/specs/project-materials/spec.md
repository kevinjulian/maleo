## ADDED Requirements

### Requirement: Story Material carries deterministic structure separately from prose

A reusable Story Material and its project-local value SHALL be able to carry an optional structured story recipe beside the existing body text. The structured recipe SHALL be validated as Story-only content and SHALL NOT be encoded as JSON or prompt prose inside `body`.

Copying a reusable Story Material into Project Materials SHALL copy the structured recipe value with the body. Project-local snapshot and source behavior SHALL remain identical to other material content.

#### Scenario: Structured Story Material seeds a project

- **WHEN** a Project Preset names a Story Material carrying body text and structured recipe
- **THEN** project Story Material receives both as project-local values
- **AND** retains the reusable Material identity and preset source provenance

#### Scenario: Non-Story Material rejects structure

- **WHEN** a Visual, Voice, or Rules Material write includes a structured story recipe
- **THEN** validation rejects the write

#### Scenario: Old Material has no recipe

- **WHEN** a Material or project document written before structured story recipes is read
- **THEN** it loads with no structured recipe
- **AND** its existing body, assets, references, and provenance remain unchanged

### Requirement: Generated frame references remain Visual Material inputs

Frames accepted from a reference-video import SHALL become canonical Reference entities and SHALL be named by generated Visual Material through existing `assetIds` and `referenceSettings`. Each entry SHALL use existing role, `referenceUse`, state, selection-hint, and lock behavior; the import SHALL NOT create a separate style/reference library.

#### Scenario: Generated style frames become Visual Material

- **WHEN** an operator finalizes three selected frames with default choices
- **THEN** generated Visual Material names all three canonical entity ids
- **AND** each entry has role `style` and style reference use

#### Scenario: Imported role survives seeding

- **WHEN** a generated Visual Material containing operator-assigned location and prop frames seeds a project
- **THEN** project Visual Material retains those roles and reference-use values
