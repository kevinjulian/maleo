# Project Materials Specification

## Purpose

Project Materials are the user-facing generation context for a project, grouped into Story, Visual, Voice, and Rules. They replace the scattered reference families with one scannable surface, route stage-specific context into generation, and track whether a group is faithful to the reusable material or preset it came from.

## Requirements

### Requirement: Project materials group generation context

The system SHALL expose Project Materials as the user-facing generation context for a project. Project Materials SHALL be grouped into Story, Visual, Voice, and Rules.

Story materials SHALL cover narrative source and framing. Visual materials SHALL cover visual assets, typed visual references, reusable style-guide text, `referenceUse`, and image/video generation guidance. Voice materials SHALL cover narration and speech guidance. Rules materials SHALL cover hard constraints that generation and regeneration must obey.

Visual materials SHALL organize references using the fixed visual role vocabulary `style`, `character`, `location`, `product`, and `prop`. Those roles SHALL be presented within the Visual group rather than as separate top-level Project Materials groups. Logos SHALL belong to brand placement/rendering workflows outside Visual generation references.

#### Scenario: Materials groups are visible

- **WHEN** an operator opens Project Materials
- **THEN** the system shows Story, Visual, Voice, and Rules as the primary groups
- **AND** the system does not require the operator to choose from Image refs, Story refs, Brand refs, Audience refs, Voice refs, Asset prompts, Evidence refs, and Constraint refs as top-level groups

#### Scenario: Material details preserve richer inputs

- **WHEN** an operator edits the Visual group
- **THEN** the system can capture typed visual references, images, brand look, reusable style-guide text, and image-generation prompt guidance within that group

#### Scenario: Visual reference types stay inside Visual

- **WHEN** Visual materials include a character, product, and location
- **THEN** those references are shown as typed Visual references
- **AND** Character, Product, and Location do not appear as separate top-level Project Materials groups

#### Scenario: Rules are hard constraints

- **WHEN** an operator adds a rule such as "no captions" or "keep product exact"
- **THEN** generation and regeneration treat it as a constraint rather than optional inspiration

### Requirement: Project materials drawer replaces project ref in the editor

The editor SHALL label the floating generation-context control as Project Materials. Activating it SHALL open a Project Materials drawer or panel that explains and edits the project's materials.

The drawer SHALL present a compact scan view first, with one row per material group, each row summarizing current content and source. Detailed prompt and asset inputs SHALL appear after the operator opens a group.

#### Scenario: Editor opens materials drawer

- **WHEN** an operator clicks the Project Materials control in the editor
- **THEN** a materials drawer opens with Story, Visual, Voice, and Rules rows

#### Scenario: Scan view stays compact

- **WHEN** the materials drawer first opens
- **THEN** it shows group summaries rather than all prompt inputs and assets at once

#### Scenario: Visual material supports regeneration

- **WHEN** an operator regenerates a selected scene image
- **THEN** the system makes the Visual materials used for that regeneration reachable before or during the action

### Requirement: Project materials support reusable and project-local sources

The system SHALL allow Project Materials to come from a selected Project Preset, from reusable material records, and from project-local edits. Project-local edits SHALL NOT mutate reusable materials unless the operator explicitly saves them back.

The UI SHALL show whether a material group comes from the preset, a reusable material, or a project-local override. The operator SHALL be able to reset an override to the preset-provided value when a preset source exists.

#### Scenario: Material source is shown

- **WHEN** a material group comes from the selected Project Preset
- **THEN** the row identifies it as from the preset

#### Scenario: Project-local edit does not mutate reusable source

- **WHEN** an operator edits a material group for one project
- **THEN** the reusable material or Project Preset that originally supplied it is unchanged

#### Scenario: Override can reset to preset

- **WHEN** an operator changes a preset-supplied material group
- **THEN** the UI offers a reset action that restores the preset-provided material value

### Requirement: Virtual preset materials seed as project-local material snapshots

Project Materials SHALL support seeding from Material records selected by a Project Preset. Built-in material content SHALL be represented as persisted fixture Material records, not virtual preset-only material content. When fixture Materials are selected by a Project Preset, they SHALL become project-local Project Material snapshots when seeded into a project.

Fixture Material records SHALL appear as read-only fixture rows in Library > Materials. Editing a fixture Material SHALL fork it into a user-owned Material with a new immutable slug.

#### Scenario: Fixture preset material becomes project-local

- **WHEN** a built-in Project Preset supplies a fixture Story Material
- **AND** a project is created from that preset
- **THEN** the project's Story material stores the supplied body as project-local material content
- **AND** the fixture Material row is not mutated by project edits

#### Scenario: Fixture preset material has material record identity

- **WHEN** a fixture Material group is seeded into a project
- **THEN** the group's `materialId` records the local fixture Material id
- **AND** the element-source sidecar records the Project Preset identity that supplied the group

#### Scenario: Operator edits fixture-seeded material

- **WHEN** an operator edits a material group that was seeded from fixture preset material
- **THEN** the edited group becomes project-local
- **AND** the fixture Material and fixture Project Preset remain unchanged

### Requirement: Preset material seeding prefers explicit reusable materials over virtual content

When a Project Preset names a reusable Material record for a group, that reusable Material record SHALL be the source used for seeding. Virtual material fallback content SHALL NOT be used for fixture Project Presets after fixture migration.

#### Scenario: Reusable material id wins

- **WHEN** a Project Preset names a valid reusable Material record for Visual material
- **THEN** seeding uses the reusable Material record value
- **AND** provenance records the Project Preset as the seeding source while the material value retains the reusable `materialId`

#### Scenario: Fixture material fills built-in preset

- **WHEN** a built-in Project Preset supplies Voice material
- **THEN** the preset names a persisted fixture Material row
- **AND** seeding uses that fixture Material row rather than virtual material content

### Requirement: Material routing is stage-specific

The system SHALL route material groups to generation stages by relevance. Story generation SHALL consume Story and applicable Rules. Visual generation SHALL consume Visual and applicable Rules, plus Story context needed for scene meaning. Voice generation SHALL consume Voice and applicable Rules, plus Story text needed for narration.

The system SHALL NOT concatenate all material groups into every generation prompt without routing.

#### Scenario: Story generation excludes visual-only direction

- **WHEN** Story generation runs and Visual materials include image-generation instructions
- **THEN** those visual-only instructions do not redirect story research or planning

#### Scenario: Visual generation receives visual materials

- **WHEN** a scene image is generated
- **THEN** the prompt includes relevant Visual materials and applicable Rules

#### Scenario: Voice generation receives voice materials

- **WHEN** voiceover is generated
- **THEN** the synthesis receives relevant Voice materials and applicable Rules

### Requirement: Reusable materials are workspace-scoped

Reusable material records SHALL be scoped to a workspace. Every read and write SHALL be constrained to one workspace, and a material SHALL NOT be reachable from a workspace that does not own it.

A caller SHALL NOT select the owning workspace through a request body. A material belonging to another workspace SHALL be reported as absent rather than as forbidden, so the response does not disclose that the identifier is in use elsewhere.

#### Scenario: A material list is scoped to one workspace

- **WHEN** an operator lists materials
- **THEN** the result contains only materials owned by their workspace

#### Scenario: Another workspace's material is unreachable

- **WHEN** a request names a material owned by a different workspace
- **THEN** the system reports it as not found, and any write it attempted leaves the material unchanged

#### Scenario: The owning workspace is not caller-supplied

- **WHEN** a create or update request carries a workspace field in its payload
- **THEN** the request is rejected rather than writing into the named workspace

### Requirement: A material-backed group reports whether it still matches its source

The system SHALL distinguish a material group that is faithful to the reusable material it came from, from one the operator has since edited. Selecting a reusable material SHALL record which material supplied the group. Editing that group's content SHALL record the operator as the source while preserving the link to the material it came from.

The UI SHALL report a faithful group and an edited group differently, and SHALL offer a way to restore an edited group to the material it came from.

#### Scenario: A freshly selected material reads as faithful

- **WHEN** an operator selects a reusable material for a group
- **THEN** the group reports that it comes from that material

#### Scenario: An edited group stops claiming clean inheritance

- **WHEN** an operator edits the content of a group backed by a reusable material
- **THEN** the group reports that it has been modified from that material, and offers to restore the material's value

#### Scenario: Saving back makes the group faithful again

- **WHEN** an operator saves an edited group back to its reusable material and the write succeeds
- **THEN** the group reports that it comes from that material, and no longer offers to restore it

### Requirement: A hand-edited style bible survives regeneration

The generated style bible SHALL be presented as an editable Visual material. Once an operator edits it, the system SHALL NOT replace it during later generation.

Releasing that protection SHALL be an explicit operator action, and the UI SHALL indicate when a style bible is being preserved.

#### Scenario: Generation does not overwrite an edited style bible

- **WHEN** a project whose style bible has been edited by hand runs a generation that would otherwise produce one
- **THEN** the edited style bible is used and is not replaced

#### Scenario: An unedited style bible is still regenerated

- **WHEN** a project whose style bible has never been hand-edited runs generation
- **THEN** the system may generate and store a new style bible

#### Scenario: The operator releases the lock

- **WHEN** an operator explicitly allows regeneration to replace the style bible
- **THEN** later generation may replace it

### Requirement: Material-derived prompt text is normalized for generation

Project Materials SHALL provide generation with normalized material content, including deduped text and resolved reference mentions. Compatibility fields MAY feed that normalization, but they SHALL NOT cause duplicate guidance in provider-facing prompts.

Normalization SHALL happen once, on the path into generation, so every consumer — style bible generation, scene planning, and provider prompt compilation — reads the same normalized Visual material body.

#### Scenario: Compatibility fields merge into one Visual material

- **WHEN** legacy direction and Project Materials carry the same Visual guidance
- **THEN** generation receives one normalized Visual material body
- **AND** provenance still records the preset or operator source

#### Scenario: Every consumer reads the normalized body

- **WHEN** a project's Visual materials are normalized for a generation run
- **THEN** style bible generation, scene planning, and prompt compilation each read that same normalized body

### Requirement: Visual materials distinguish set, generated, locked, and reference use inputs

Visual material entries SHALL report whether they are missing, generated, user-set, preset-set, or locked. Each Visual reference entry SHALL carry a project-level `referenceUse` of `exact`, `inspiration`, `style`, or `direct_place`. Scenes SHALL select reference ids only; they SHALL NOT override `referenceUse` in v1.

A missing Style role MAY be filled and auto-used by a generated style guide. A missing Character or Location role MAY be filled by a generated draft, but the draft SHALL require operator approval before it is used as a generation reference. Product references SHALL be selected or uploaded by the user and SHALL NOT be generated. A user-set, preset-set, or locked Visual role SHALL NOT be replaced by generated content unless the operator explicitly requests regeneration for that role.

Generated entries SHALL be editable and savable as reusable Materials or reference entities. Editing a generated entry SHALL make the project-local value operator-owned, and saving it SHALL NOT mutate an unrelated reusable source.

#### Scenario: Missing style guide can be generated

- **WHEN** a project has no Style visual material and generation needs project-level visual consistency
- **THEN** the system may generate and auto-use a style guide draft from the brief, Visual materials, and applicable Rules

#### Scenario: User-set character reference is preserved

- **WHEN** an operator attaches a woman character image as a Character Visual reference
- **THEN** later generation preserves that reference and does not replace it with a generated character image

#### Scenario: Character draft requires approval

- **WHEN** the system generates a missing Character reference
- **THEN** the generated draft is not used for asset generation until the operator approves it

#### Scenario: Product is user selected

- **WHEN** a scene needs a product reference
- **THEN** the system requires a user-selected or uploaded Product reference
- **AND** it does not generate a Product reference automatically

#### Scenario: Reference use is configured on the visual reference

- **WHEN** an operator sets Anna's Character reference to `exact`
- **THEN** every scene that selects Anna uses that `referenceUse`
- **AND** the scene stores only Anna's reference id

#### Scenario: Locked visual reference survives regeneration

- **WHEN** an operator locks a Visual reference
- **THEN** regeneration keeps that reference unchanged unless the operator unlocks or explicitly replaces it

### Requirement: Reusable style guides remain exact Visual Material content

A generated style guide that the operator saves for reuse SHALL be stored as Visual Material content. Selecting that Material in another project SHALL copy or reference the same style-guide text as input to generation. The system SHALL NOT rewrite that saved style guide into a different style summary unless the operator explicitly asks to regenerate it.

#### Scenario: Saved style guide is reused without drift

- **WHEN** an operator saves a generated style guide as a reusable Visual Material and selects it in another project
- **THEN** the second project uses the saved style-guide text exactly
- **AND** it does not generate a replacement style guide by default

#### Scenario: Regeneration is explicit

- **WHEN** a project uses a saved Visual Material style guide
- **AND** the operator clicks a regenerate-style action
- **THEN** the system may generate a new style guide for that project without mutating the reusable Material unless the operator saves back

### Requirement: Visual reference settings carry selection hints

Visual Material reference entries SHALL include an optional `selectionHint` string. `selectionHint` SHALL describe when the reference should be chosen for scene assignment. It SHALL be stored beside `entityId`, `role`, `referenceUse`, `state`, and `locked`.

`selectionHint` SHALL NOT replace `referenceUse`: `referenceUse` answers how a selected reference is used, while `selectionHint` answers when that reference should be selected.

Reusable Visual Materials SHALL preserve `selectionHint` when saved, selected into a project, copied into project-local Materials, and saved back explicitly.

Visual Material authoring SHALL expose selected references as compact cards rather than a single undifferentiated asset list. Cards SHALL keep thumbnail or fallback, role, `referenceUse`, `selectionHint`, and state visible together. Adding a reference SHALL open a standard modal that lets the operator choose reference type, search and choose exactly one matching library reference, set or inherit the input scenario, and choose `referenceUse` before saving.

#### Scenario: Character hints describe when to choose a reference

- **WHEN** a Visual Material contains a woman character reference
- **AND** its `selectionHint` is `Anna, woman, female lead, mother`
- **THEN** the material stores that hint on the woman's Visual reference entry
- **AND** the scene stores only the woman's reference id when selected

#### Scenario: Reference use remains separate

- **WHEN** a Visual reference has `referenceUse: exact` and `selectionHint: woman, Anna`
- **THEN** generation treats `exact` as the use mode after the reference is selected
- **AND** it treats `woman, Anna` only as selection guidance

#### Scenario: Reusable material preserves hints

- **WHEN** an operator saves a Visual Material with a man character hint
- **AND** selects that Material in a different project
- **THEN** the second project's Visual Material copy includes the same `selectionHint`
- **AND** editing that project-local hint does not mutate the reusable Material unless the operator saves back

#### Scenario: Historical materials read without hints

- **WHEN** a project or Material record was saved before `selectionHint` existed
- **THEN** loading it returns valid Visual reference settings with an empty or absent hint
- **AND** no generation path throws because the hint is missing

#### Scenario: Visual material card keeps related controls together

- **WHEN** an operator opens Project Materials > Visual with Anna selected
- **THEN** Anna appears in a character reference card with thumbnail or fallback, role, `referenceUse`, `Selection hint`, and state visible together
- **AND** opening the card lets the operator edit when Anna should be selected without using a scene menu

#### Scenario: Material add reference filters by type

- **WHEN** an operator adds a Location reference to Visual Materials
- **THEN** the modal shows Location library references only
- **AND** it lets the operator search within Location references before saving one selection

### Requirement: Materials library presents material groups as first-class catalogue groups

Library > Materials SHALL present reusable Materials through the shared Library toolbar
and SHALL expose Story, Visual, Voice, and Rules as first-class groups.

The group filter SHALL select which group sections are rendered. When no group is
selected, all four group sections SHALL render. When a group is selected, only that
group's section SHALL render. Search SHALL combine with the active group filter and
SHALL narrow records within the rendered sections rather than removing a section.

A rendered group section with no matching records SHALL remain visible and SHALL offer
a create action for that group, so the full material model stays legible whether the
group is empty in this workspace or empty for this query.

When an operator adds a reference to a Visual Material, the reference's Input scenario SHALL be used as the default material selection hint when the operator has not typed a material-specific scenario. Once saved on the material, that material-specific selection hint SHALL remain an override and SHALL NOT be overwritten by later edits to the reference default.

#### Scenario: Materials groups are visible in the library

- **WHEN** an operator opens Library > Materials with no group filter selected
- **THEN** Story, Visual, Voice, and Rules are visible as material group sections
- **AND** the surface does not collapse them into an ungrouped flat list

#### Scenario: Selecting a group narrows the rendered sections

- **WHEN** an operator selects the Visual group filter
- **THEN** only the Visual group section renders
- **AND** Story, Voice, and Rules sections return when the group filter is cleared

#### Scenario: Materials search combines with group filters

- **WHEN** an operator selects Visual and searches for a matching term
- **THEN** only Visual materials matching that query are listed
- **AND** the Visual section still renders even if no Visual material matches

#### Scenario: Empty rendered groups keep add paths

- **WHEN** a rendered material group section has no records for the current workspace and query
- **THEN** the section remains visible
- **AND** it offers a create action for that group

#### Scenario: Visual Material defaults selection hint from reference Input scenario

- **WHEN** an operator adds a reference with Input scenario text to a Visual Material
- **AND** the operator leaves the material-specific scenario blank
- **THEN** the Visual Material stores that Input scenario as the selected reference's selection hint

#### Scenario: Material-specific scenario overrides reference default

- **WHEN** a Visual Material already has a selected reference with a material-specific selection hint
- **AND** the source reference's Input scenario changes later
- **THEN** the Visual Material keeps its existing selection hint

### Requirement: The Story group presents the workspace writer style

The Story group SHALL present the workspace's resolved writer style selection alongside the Story
material body, mirroring how the Visual group presents the derived style bible: shown within the
group it governs, stored outside the group's own editable body.

The selection SHALL be presented as a choice from the fixed profile library, never as free text,
so craft guidance cannot re-enter the prose channel it was extracted from.

Because the selection is workspace configuration rather than project material, the Story group
SHALL present it as inherited and SHALL indicate where it is changed. Editing it from the Story
group SHALL NOT create a project-local copy.

A workspace with no selection SHALL be presented as having none, and the Story group SHALL
continue to function unchanged.

#### Scenario: Selection is visible in the Story group

- **WHEN** an operator opens Project Materials for a project in a workspace with a writer style selected
- **THEN** the Story group shows the selected profile's label

#### Scenario: Selection is a picker, not free text

- **WHEN** an operator views the writer style within the Story group
- **THEN** the available values are the fixed profile library
- **AND** the operator cannot enter an arbitrary writer style as text

#### Scenario: Selection is shown as workspace-owned

- **WHEN** the Story group presents the writer style
- **THEN** it is presented as inherited from the workspace
- **AND** it is not written into the project's Story material body

#### Scenario: No selection leaves the group unchanged

- **WHEN** an operator opens Project Materials in a workspace with no writer style selected
- **THEN** the Story group presents no writer style
- **AND** the Story material body behaves as it did before this capability existed
