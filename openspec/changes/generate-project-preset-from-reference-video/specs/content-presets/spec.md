## ADDED Requirements

### Requirement: Library creates a Project Preset from reviewed reference-video analysis

Library > Project Presets SHALL offer `Generate from video` beside manual preset creation. Completing that flow SHALL create an ordinary user-owned Project Preset whose bundle names generated reusable Material records and one generated Video Template identity.

The generated preset SHALL remain exactly Project Materials plus Video Template. It SHALL NOT own transcript, source video, selected frame binaries, analysis confidence, story structure, style, or template fields as duplicate top-level preset state.

#### Scenario: Generated preset uses ordinary bundle identities

- **WHEN** a reviewed reference-video import is finalized
- **THEN** the new Project Preset bundle names its generated Story and Visual Material ids and Video Template id
- **AND** reusable structure belongs to Story Material while frame references belong to Visual Material

#### Scenario: Generated preset works in existing create flow

- **WHEN** an operator chooses the generated Project Preset during content creation
- **THEN** existing preset seeding resolves its Materials and Video Template without an import-specific path

#### Scenario: Manual preset creation remains available

- **WHEN** an operator opens Library > Project Presets after this change
- **THEN** both manual `New preset` and `Generate from video` actions are available
- **AND** existing preset list, edit, copy, default, and delete behavior is unchanged

### Requirement: Generated preset success leads to normal product surfaces

After finalize, the flow SHALL show the created preset and offer `Use preset in new video` and `View in Library`. The first action SHALL open content creation with that preset selected; the second SHALL open the ordinary Project Preset detail or edit route.

#### Scenario: Operator uses generated preset immediately

- **WHEN** an operator activates `Use preset in new video` after finalize
- **THEN** video creation opens with the generated preset selected
- **AND** its Materials and Video Template are resolved through normal seeding
