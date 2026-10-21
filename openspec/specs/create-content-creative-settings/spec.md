# create-content-creative-settings Specification

## Purpose

Defines how the create-content timeline editor separates audience-facing creative Style controls from Project generation/export mechanics.

## Requirements

### Requirement: Style rail owns creative defaults

The create-content timeline editor SHALL group the elements it presents by product domain: Project, Brand, Output, Audio, Data & Motion, and Selected Clip when a clip is selected. These are UI domains, not pure provenance scopes. It SHALL NOT group this surface by historical rails such as Style, Settings, Templates, or Elements.

Each creative Style group SHALL use a collapsible inspector section, separated by borders rather than nested cards. Known default sources SHALL remain named and openable where applicable. Style and Project Settings SHALL NOT show Changed/inherited indicators or change counts. Recorded provenance and default-action protection SHALL remain intact.

Creative Style SHALL retain compact named value summaries and its existing complex-control detail editors. Cheap booleans and short selects MAY stay inline. Project Settings SHALL instead follow its inline mechanics requirement.

Elements whose names collide but whose data does not SHALL be presented under distinct labels and SHALL NOT be merged into one heading. In particular, the gate controlling whether data callouts are generated at all SHALL be presented separately from data-callout styling, and narration timing SHALL be presented separately from retention overlay devices.

#### Scenario: Operator sees elements grouped by scope

- **WHEN** an operator opens the creative Style surface in a video project
- **THEN** elements are grouped into Project, Brand, Output, Audio, Data & Motion, and Selected Clip only when a clip is selected
- **AND** the groups are separated by borders rather than nested cards

#### Scenario: Operator scans before editing

- **WHEN** the creative Style surface opens
- **THEN** the main view shows compact element rows with current value summaries within collapsible sections, without Changed indicators
- **AND** complex controls are hidden until the operator opens a row detail

#### Scenario: Cheap controls stay inline

- **WHEN** an element is edited by a compact boolean toggle or a select with fewer than five options
- **THEN** that control may be edited from the scan row without opening detail

#### Scenario: Complex controls use detail

- **WHEN** an element uses a color picker, voice list, provider configuration, data-callout style editor, motion editor, or multi-field editor
- **THEN** the full control opens from row detail rather than rendering inline by default

#### Scenario: Operator edits creative defaults

- **WHEN** an operator opens an element row detail from the creative Style surface
- **THEN** creative defaults remain editable without requiring a separate historical Style rail

#### Scenario: Creative defaults preserve render behavior

- **WHEN** an operator changes a regrouped creative control
- **THEN** preview and export use the same underlying setting and render behavior as before the regrouping

#### Scenario: An inherited element is not individually annotated

- **WHEN** every element in a product-domain group carries the value its default source supplied
- **THEN** the default source is named once in the group header and inherited rows do not repeat it

#### Scenario: Inherited rows come from multiple defaults

- **WHEN** a group contains inherited elements from more than one default source
- **THEN** the group header says "Multiple defaults"
- **AND** rows expose their row-level source where needed instead of falling back to a generic inherited label

#### Scenario: A diverging element is annotated

- **WHEN** an operator-owned Style element is shown or its detail is opened
- **THEN** no Changed badge or count is displayed
- **AND** existing reset and default-write actions remain available with their destinations and protections

#### Scenario: Style sections disclose with keyboard

- **WHEN** an operator activates a creative section heading
- **THEN** its properties collapse or expand and focus remains on the disclosure

#### Scenario: Word-collided elements are not merged

- **WHEN** the creative Style surface presents the data-callout gate and data-callout styling
- **THEN** they appear as distinct labelled elements
- **AND** narration timing and retention overlay devices likewise appear separately

### Requirement: Project panel owns generation and export mechanics

The create-content timeline editor SHALL present project-local mechanics as inline editable properties within inspector-style, border-separated sections. Aspect ratio and render backend SHALL be in Output; image and video provider information SHALL be in Output unless a narrower provider group exists; voice provider, voice and narration language SHALL be in Audio. Project Settings SHALL NOT show Changed/inherited badges, changed counts, duplicate value summaries, or a separate row-detail body. Sections SHALL use the same hierarchy, spacing, control density and disclosure behavior as the clip inspector.

Existing project writers, provider permissions, read-only constraints, provider health/error feedback, voice audition and default actions SHALL remain functional. Provider information managed elsewhere SHALL remain clearly read-only with its ownership explanation. Inline edits SHALL retain operator provenance and autosave behavior without altering the persisted schema.

#### Scenario: Operator edits generation mechanics

- **WHEN** an operator opens Project Settings in a video project
- **THEN** format, provider, voice default, language and export controls are visible within Output and Audio sections
- **AND** editable controls work directly in those sections without opening another detail body

#### Scenario: Operator picks and auditions a voice

- **WHEN** an operator selects a configured voice provider
- **THEN** its available voices and existing sample audition controls are reachable inline in Audio
- **AND** selecting a voice updates the existing project setting

#### Scenario: Status badges are absent

- **WHEN** the project contains both inherited and operator-owned settings
- **THEN** Project Settings shows their effective values without Changed/inherited indicators or change counts
- **AND** editing still records operator provenance and preserves operator values during subsequent preset seeding

#### Scenario: Provider configuration remains truthful

- **WHEN** a provider is loading, unavailable, failed, or managed by an instance owner
- **THEN** its existing status, retry or read-only explanation remains reachable in the section
- **AND** an unsupported configuration is not exposed as a working project-level edit

### Requirement: Restructuring preserves persisted project state

The regrouping SHALL NOT require migration of existing project editor state or storyboard state for style reference, brand, background, retention overlays, providers, voice defaults, aspect ratio, or render backend. Provenance records SHALL be additive: a project persisted without them SHALL load with every seedable element reading as operator-owned.

#### Scenario: Existing project opens after restructuring

- **WHEN** an existing video project is opened after the regrouping
- **THEN** its previously saved creative, provider, voice, aspect ratio, and render settings are loaded and remain editable from their new scope groups

#### Scenario: A project without provenance opens safely

- **WHEN** a project persisted before provenance was recorded is opened
- **THEN** it loads without error and each seedable element reads as operator-owned

### Requirement: A clip scope group appears only for a selected clip

The settings surface SHALL present a Selected Clip scope group when a clip is selected, and SHALL omit it otherwise. An element in the Selected Clip group that the clip does not itself set SHALL indicate the scope it inherits from in its row detail.

#### Scenario: Clip group appears on selection

- **WHEN** an operator selects a clip
- **THEN** a Selected Clip group appears naming the default source supplying that clip when known

#### Scenario: Clip group is absent without a selection

- **WHEN** no clip is selected
- **THEN** no Selected Clip group is presented

#### Scenario: An inherited clip element names its source scope

- **WHEN** a clip element takes its value from a wider scope rather than from the clip
- **THEN** opening that row detail indicates which scope it inherits from

### Requirement: Row drill-down is accessible

The creative Style row detail surface SHALL preserve keyboard and screen-reader usability. Opening detail SHALL move focus into the detail surface. Escape or Close SHALL dismiss it. After dismissal, focus SHALL return to the row that opened it.

#### Scenario: Detail focus is managed

- **WHEN** an operator opens a creative Style element row detail with keyboard focus
- **THEN** focus moves into the detail surface
- **AND** closing the detail returns focus to the originating row

#### Scenario: Detail closes with Escape

- **WHEN** a creative Style element row detail is open
- **AND** the operator presses Escape
- **THEN** the detail surface closes without committing unrelated changes

Project Settings SHALL expose inline controls with associated labels and keyboard access. Section disclosure SHALL retain focus on its toggle and SHALL NOT require opening a detail surface to edit a field.

#### Scenario: Inline settings keyboard editing

- **WHEN** an operator tabs through Project Settings and opens an Audio or Output disclosure
- **THEN** its editable fields are labelled and reachable by keyboard
- **AND** their keys do not inadvertently trigger timeline editing shortcuts
