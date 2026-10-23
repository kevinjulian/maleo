# Content Presets

## Purpose

Named, workspace-scoped bundles of style knobs, references, settings, pacing, data-callout, template, and creative direction, with a single default, seeded into new projects and managed through a Library page, a creation-page picker, and an editor change-with-warning. A preset is the only place a style is defined; read-only builtins ship with the product.

## Requirements

### Requirement: Content presets bundle the editor's creative surfaces

A content preset SHALL be presented to operators as a Project Preset. A Project Preset SHALL be a named, described, workspace-scoped bundle of Project Materials plus one Video Template selection. It SHALL NOT be presented as an independent bundle of style, references, settings, pacing, and creative direction.

The preset MAY persist normalized internal fields needed for compatibility, but every user-facing create, library, and editor surface SHALL explain the preset as:

```text
Project Preset = Project Materials + Video Template
```

Style and creative direction SHALL be represented as material content or generated material summary, not as a separate top-level style selection inside the preset. A preset SHALL NOT carry an infographic style. A stored infographic style SHALL be dropped on read and SHALL NOT be written.

#### Scenario: Preset stores the full bundle

- **WHEN** a Project Preset is saved
- **THEN** its stored value contains Project Materials and a selected Video Template identity
- **AND** it does not require a separate user-facing style object to understand what the preset supplies

#### Scenario: Preset carries a name and description

- **WHEN** an operator saves a preset with a name and description
- **THEN** the preset stores both, and a save with a blank name is rejected as name-required

#### Scenario: A preset saved before project materials is read

- **WHEN** a preset whose stored bundle uses older style, reference, settings, pacing, or creative-direction fields is loaded
- **THEN** the system presents those values through Project Materials, Video Template, or project settings according to ownership

#### Scenario: A preset with an infographic style is read

- **WHEN** a preset whose stored bundle carries `infographicStyle` is loaded
- **THEN** the loaded preset has no infographic style
- **AND** applying it to a project changes no infographic setting

#### Scenario: Operator tunes material content

- **WHEN** an operator changes one material group on a Project Preset and saves
- **THEN** only that material group changes, and the preset remains a bundle of Materials plus Video Template

### Requirement: Library preset page manages presets end to end

The system SHALL provide a Library > Preset page that lists presets and lets an operator create, edit, and delete them. Creating and editing SHALL use a bundle editor that edits the preset's Project Materials and Video Template selection directly, without an open content project.

The list SHALL include read-only fixture presets shipped with the product alongside the workspace's own presets, and SHALL mark which entries are fixtures. Fixture presets SHALL be persisted as library rows, SHALL carry immutable slugs, and SHALL NOT be edited or deleted in place. Editing a fixture SHALL first copy it into a user-owned preset with a new immutable slug and apply the edit to the copy.

Fixture presets SHALL be listed before the workspace's own presets, in their authored order, so that a fixture update does not reorder the list. The default preset pointer MAY name a fixture preset row.

#### Scenario: Operator lists presets in the Library

- **WHEN** an operator opens Library > Preset
- **THEN** the system displays fixture presets and all saved workspace presets by name, indicating which entries are fixtures and which one is the default

#### Scenario: A new workspace has presets available

- **WHEN** an operator opens Library > Preset in a workspace that has never saved a preset
- **THEN** fixture presets are listed and selectable rather than an empty-state message

#### Scenario: Operator creates a preset in the Library

- **WHEN** an operator creates a preset and edits its Project Materials and Video Template selection in the bundle editor
- **THEN** the system saves a new user-owned preset containing exactly those bundle values and an immutable slug

#### Scenario: Operator edits a preset in the Library

- **WHEN** an operator edits an existing user-owned preset's bundle and saves
- **THEN** the preset's stored bundle is updated and the list reflects the change
- **AND** the preset slug is unchanged

#### Scenario: Operator edits a fixture preset

- **WHEN** an operator edits a fixture preset's bundle and saves
- **THEN** the system creates a new user-owned preset carrying the edited bundle, leaves the fixture unchanged, and the list shows both

#### Scenario: Operator deletes a preset

- **WHEN** an operator deletes a user-owned preset
- **THEN** the preset is removed and no longer appears in the list

#### Scenario: Operator attempts to delete a fixture

- **WHEN** an operator attempts to delete a fixture preset
- **THEN** the system refuses and the fixture remains in the list

#### Scenario: Default pointer moves to the fixture row

- **WHEN** a database whose default preset pointer names a virtual built-in is migrated
- **THEN** the pointer names the fixture preset row that replaced it
- **AND** new projects are created from that fixture preset

#### Scenario: Fixture presets keep their place in the list

- **WHEN** fixture bootstrap updates fixture presets and an operator opens Library > Preset
- **THEN** the fixture presets appear first in their authored order
- **AND** the workspace's own presets follow

#### Scenario: Operator deletes the default preset

- **WHEN** an operator deletes the preset currently marked as default
- **THEN** the default pointer is cleared and new projects are created with no preset applied

### Requirement: Built-in Project Presets seed material-first starting points

Built-in Project Presets SHALL be persisted as fixture Project Preset rows. A fixture Project Preset SHALL seed useful Project Materials and a selected Video Template by naming persisted Material and Video Template rows through local ids resolved during fixture bootstrap. A built-in SHALL NOT be considered complete when it only supplies legacy style, settings, pacing, creative-direction fields, or virtual material fallback content. A fixture SHALL NOT carry an infographic style.

#### Scenario: Fixture preset seeds materials

- **WHEN** an operator selects a built-in Project Preset on the creation page
- **THEN** the create flow seeds non-empty Project Materials for every group the fixture preset supplies
- **AND** each seeded group records the selected Project Preset as its source

#### Scenario: Fixture preset uses material records

- **WHEN** a new workspace has never created user-owned Material records
- **THEN** shipped fixture Material records are still available to fixture Project Presets
- **AND** the fixture Project Preset can seed Project Materials without virtual material fallback logic

#### Scenario: Built-in preset is not style-only

- **WHEN** a built-in Project Preset appears in the picker or library
- **THEN** its useful starting point is represented by Project Materials and Video Template selection
- **AND** the UI does not present legacy style or creative-direction fields as the preset's primary model

### Requirement: Animated Systems Explainer ships as a built-in Project Preset

The system SHALL include a built-in Project Preset named `Animated Systems Explainer`. The preset SHALL provide material content for Story, Visual, Voice, and Rules that supports animated systems explainer videos.

The preset's content SHALL encode reusable explanatory grammar and visual rules. It SHALL NOT instruct generation to copy a third-party channel, creator, owned character, exact artwork, script, or recognizable identity.

#### Scenario: Animated Systems Explainer appears in preset list

- **WHEN** an operator opens the Project Preset picker or Library > Presets
- **THEN** `Animated Systems Explainer` appears as a built-in preset

#### Scenario: Animated Systems Explainer seeds all material groups

- **WHEN** an operator selects `Animated Systems Explainer`
- **THEN** Story material describes question-led systems explanation
- **AND** Visual material describes flat editorial animation with diagrams, maps, flows, scales, timelines, and object metaphors
- **AND** Voice material describes calm, precise, curious narration
- **AND** Rules material constrains scenes to reveal, compare, locate, count, transform, or explain

#### Scenario: Animated Systems Explainer avoids channel imitation

- **WHEN** generation uses materials from `Animated Systems Explainer`
- **THEN** provider-facing prompts describe generic visual and narrative traits
- **AND** prompts do not name or request imitation of a third-party creator,
  channel, character, or product identity

### Requirement: Shipped Preset Identities Are Brand Neutral

Built-in preset names, slugs, descriptions, preview copy, and current source
identifiers SHALL use neutral creative categories rather than third-party creator
or channel names. Existing stored branded identifiers MUST migrate to neutral
identifiers or resolve through a scoped compatibility migration without remaining
user-visible.

#### Scenario: Fresh workspace seeds built-ins

- **WHEN** fixture bootstrap creates shipped Project Presets
- **THEN** high-energy challenge, editorial map explainer, and bright systems
  animation concepts use neutral names and slugs

#### Scenario: Existing workspace upgrades

- **WHEN** persisted preset or default points to replaced built-in identifier
- **THEN** it resolves to neutral replacement without duplicate fixture rows

### Requirement: Product Surfaces Avoid Focal Brand Identity

Current user-facing copy, component filenames, exports, tests, and product-style
comments SHALL NOT use `Focal` or `Focal-style` as Maleo product identity.
Image-coordinate identifiers such as `focalPoint` SHALL remain valid technical
terms.

#### Scenario: Product identity scan runs

- **WHEN** release hygiene check scans active source and UI copy
- **THEN** Focal-branded product identifiers fail check
- **AND** generic focal-point geometry does not fail check

### Requirement: Style Inspiration Uses Generic Traits

Commands that derive style from a reference SHALL translate reference into
generic traits such as pacing, composition, tone, structure, palette, typography,
and visual grammar. They SHALL NOT ask generation to impersonate or copy a
specific creator or channel identity.

#### Scenario: Operator requests reference-based style

- **WHEN** style-inspiration action builds provider-facing instruction
- **THEN** instruction requests transferable traits
- **AND** instruction excludes named identity imitation

### Requirement: Exactly one preset is the workspace default

The system SHALL track at most one default preset via a single default pointer. Marking a preset as default SHALL replace any previous default. The pointer MAY name a builtin preset, which does not copy the builtin into workspace storage.

#### Scenario: Operator sets a default

- **WHEN** an operator marks a preset as the default while another preset is already the default
- **THEN** only the newly selected preset is the default and the previous one is no longer marked

#### Scenario: Operator defaults to a builtin

- **WHEN** an operator marks a builtin preset as the workspace default
- **THEN** the default pointer names that builtin, no workspace preset row is created, and new projects seed from the builtin's bundle

#### Scenario: No default configured

- **WHEN** no preset is marked as default
- **THEN** the system reports that there is no default and applies no preset at create time

### Requirement: Content creation selects a preset to seed a new project

The content creation page SHALL let an operator pick a Project Preset before the project is created. Picking a Project Preset SHALL auto-select the preset's Project Materials and Video Template. The operator SHALL be able to override Materials and Video Template independently before generation.

When no preset is picked, the workspace default Project Preset SHALL seed the project; when neither exists, the project is created with empty or shipped-default Materials and no preset-selected Video Template.

Seeding SHALL be durable at the moment the project is created. The selected Materials and Video Template SHALL be written with the project row or project document, not left to a later autosave.

Seeding SHALL record, for each preset-supplied material group and template selection, the project-preset source and preset identity. Whether a value is eligible to be replaced by a later preset SHALL be decided by its recorded source, not by value comparison.

#### Scenario: Operator picks a preset on the creation page

- **WHEN** an operator selects a Project Preset on the creation page
- **THEN** the create flow auto-selects that preset's Project Materials and Video Template

#### Scenario: Operator overrides preset materials

- **WHEN** an operator changes Materials after selecting a Project Preset
- **THEN** the project is created with the overridden Materials and the selected preset remains unchanged

#### Scenario: Operator overrides preset video template

- **WHEN** an operator changes Video Template after selecting a Project Preset
- **THEN** the project is created with the overridden Video Template and the selected preset remains unchanged

#### Scenario: Creation falls back to the default

- **WHEN** an operator creates a project without picking a preset while a default Project Preset exists
- **THEN** the new project is seeded from the default preset's Materials and Video Template

#### Scenario: Snapshot is independent of the source preset

- **WHEN** an operator edits a Project Preset after a project was created from it
- **THEN** the previously created project retains its original Materials and Video Template selection unchanged

#### Scenario: The operator reloads immediately after creating

- **WHEN** a project is created with a Project Preset applied and the browser is reloaded before any autosave has run
- **THEN** the project loads with preset-supplied Materials and Video Template intact

#### Scenario: Seeding records the preset it came from

- **WHEN** a project is seeded from a Project Preset
- **THEN** each seeded material group and template selection records the project-preset source and that preset's identity

#### Scenario: Eligibility is not decided by value comparison

- **WHEN** a material group's current value happens to equal the shipped default but its recorded source is project-local
- **THEN** later preset seeding leaves that group alone unless the operator opts in to replacing project-local edits

### Requirement: Editor changes the active preset with an override warning

The content editor SHALL let an operator change the active Project Preset. Applying a Project Preset SHALL replace preset-inherited Materials and Video Template selection, and SHALL preserve project-local material or template overrides by default. The system SHALL NOT change project values until the operator confirms.

Before applying, the system SHALL report which inherited Materials and Video Template values will be replaced and which project-local overrides will be preserved. Replacing project-local overrides SHALL be available as an explicit opt-in and SHALL NOT be the default.

The editor SHALL offer exactly one Project Preset selection surface for preset changes. It SHALL NOT present a second, separate style-preset dropdown.

#### Scenario: Operator changes preset in the editor

- **WHEN** an operator chooses a different Project Preset in the editor
- **THEN** the system reports which inherited Materials and Video Template values will be replaced, names project-local overrides it will keep, and asks for confirmation

#### Scenario: Operator confirms the override

- **WHEN** an operator confirms the preset change without opting in to overwriting project-local edits
- **THEN** inherited Materials and Video Template selection are replaced with the selected preset's values and project-local overrides remain unchanged

#### Scenario: Operator opts in to overwriting edits

- **WHEN** an operator explicitly opts in to overwriting project-local Materials and Video Template values and confirms
- **THEN** every preset-owned group and template selection is replaced with the selected preset's value and records the project-preset source

#### Scenario: Operator cancels the override

- **WHEN** an operator dismisses the confirmation without confirming
- **THEN** Project Materials and Video Template selection are left unchanged

#### Scenario: Only one preset surface exists

- **WHEN** an operator opens the preset selection surface
- **THEN** the Project Preset list is the only control that selects a preset, and no separate style-preset dropdown is present

### Requirement: A preset bundle records provenance per axis

A preset bundle SHALL carry, per axis, the layer and defaulter identity that supplied it. The style
axis SHALL record one source for the whole knob object rather than one per knob, because the knobs
are authored and applied as a single unit.

#### Scenario: Style records one source for the axis

- **WHEN** a preset seeds a project's style knobs
- **THEN** the style axis records a single source
- **AND** no per-knob source is recorded

#### Scenario: Axes record independently of one another

- **WHEN** a preset seeds some axes while others are operator-owned
- **THEN** each axis records its own layer, and one axis's source does not determine another's

### Requirement: Preset reference seeding attaches renderable roster entries

When a Project Preset supplies project reference entity ids, applying that preset SHALL attach those entities to the project roster in the same operation family that writes the project's generation lock. A preset-applied reference SHALL NOT be persisted only as `projectReferences.entityIds`.

The system SHALL validate preset-supplied entity ids against the active workspace before attaching them. Cross-workspace or missing entities SHALL be reported as preset-application findings and SHALL NOT be silently written as inert generation locks.

#### Scenario: Creation from preset attaches selected references

- **WHEN** an operator creates a project from a Project Preset whose Project Materials select a workspace reference entity
- **THEN** the new project document contains that entity id in its generation lock
- **AND** the project roster contains one attachment row for that entity

#### Scenario: Editor preset change attaches selected references

- **WHEN** an operator applies a different Project Preset in the editor and confirms the change
- **THEN** every preset-supplied selected reference that belongs to the workspace is attached to the project roster
- **AND** attaching an entity already on the roster leaves only one roster row

#### Scenario: Invalid preset reference is reported

- **WHEN** a Project Preset names a reference entity that is missing or belongs to another workspace
- **THEN** the preset application reports that reference as unresolved
- **AND** the unresolved id is not written as an effective generation lock
