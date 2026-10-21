# reference-library-ui Specification

## Purpose

TBD - created by archiving change consolidate-reference-ui. Update Purpose after archive.

## Requirements

### Requirement: Single reference library surface

The system SHALL present one reference library component across every surface that browses or edits
references. Each surface SHALL expose the same capabilities — search, role grouping, usage count,
create, edit, delete — differing only in layout mode, not in available operations. Every surface
SHALL read its references from one pool that distinguishes workspace-library entities from the
project's roster, rather than from separate lists merged per surface.

#### Scenario: Same capabilities in every mount

- **WHEN** the reference library is opened from the project rail and from the timeline editor
- **THEN** both offer search, role grouping, usage count, and the same create/edit/delete operations

#### Scenario: Usage count reflects all attachments

- **WHEN** an entity is selected by a project and cast in two scenes
- **THEN** the library shows a usage count covering both the project selection and the scene casts

#### Scenario: One pool behind every surface

- **WHEN** an entity is created, edited, or deleted from any surface
- **THEN** every other surface reflects the change without a per-surface merge of separate reference lists

### Requirement: Selection reflects scope nesting

The system SHALL present reference selection as a pick from the tier above: a project selects from
its workspace library, and a scene casts from the project's selection. The system SHALL make an
entity's current tier visible at every level.

#### Scenario: Scene picker lists only project selections

- **WHEN** an operator opens the cast picker for a scene
- **THEN** only entities the project has selected are offered, and the workspace library is reachable through an explicit add step

#### Scenario: Tier is visible

- **WHEN** an operator views an entity in the workspace library
- **THEN** the surface indicates whether the current project has selected it

### Requirement: Entity editor exposes description and canonical image

The system SHALL let an operator edit an entity's role, label, description, and canonical image in
one editor. The system SHALL treat the description as a first-class generation input, not an
optional annotation.

#### Scenario: Description is editable and persisted

- **WHEN** an operator writes a description for a character entity and saves
- **THEN** the description persists on the entity and is carried into the reference map at generation

#### Scenario: Role change is a single edit

- **WHEN** an operator changes an entity's role in the editor and saves
- **THEN** the entity's role is updated in place and no duplicate entity appears in the library

### Requirement: Voice speakers are named distinctly from cast

The system SHALL name the voice/speaker model distinctly from the visual cast model in all
user-facing surfaces and in the code that backs them, so that "cast" refers unambiguously to visual
reference entities.

#### Scenario: Speaker and cast are distinguishable

- **WHEN** an operator manages voices and manages visual references
- **THEN** the two surfaces use distinct names, and neither is labeled "cast" in a way that would apply to the other

### Requirement: Reference packs removed

The system SHALL NOT provide reference packs as a mechanism for sharing references between projects.

#### Scenario: Reuse is served by the workspace library

- **WHEN** an operator wants a reference available in a second project
- **THEN** they select the existing workspace entity into that project, with no pack snapshot or apply step

### Requirement: Reference counts describe what renders

The system SHALL make every displayed count or list of a scene's references equal to the resolved
set that generation would attach for that scene, including the scene's opt-out and the subject cap.
Surfaces SHALL mark references that the subject cap drops rather than counting them as attached.

#### Scenario: Card count matches the render

- **WHEN** a scene's cast exceeds the subject cap and its reference count is shown on a studio or board card
- **THEN** the count excludes the capped-out subjects, matching the scene editor and the generated result

#### Scenario: Opted-out scene shows only its own cast

- **WHEN** a scene sets `useGlobalReferences: false`
- **THEN** every surface shows only the scene's own cast for it, and generation attaches the same set

### Requirement: A reference can be placed on the timeline by dragging it

The reference library SHALL allow an entity's image to be dragged onto the timeline. Placing one this way SHALL admit the image as a project asset and create the clip in the same action, and the admitted asset SHALL record which workspace entity it came from.

The project SHALL keep its own asset rather than the clip pointing at the workspace entity, so that a later edit to the entity does not silently change what an existing clip renders.

Repeated drags of the same entity SHALL NOT accumulate assets.

#### Scenario: A reference is dragged onto the timeline

- **WHEN** the operator drags a reference entry onto the timeline
- **THEN** a clip is created, its image is admitted as a project asset, and the asset records which workspace entity it came from

#### Scenario: The same reference is dragged twice

- **WHEN** the operator drags the same reference entry onto the timeline a second time
- **THEN** a second clip is created and both reference the one admitted asset

#### Scenario: The workspace entity changes afterwards

- **WHEN** the workspace-library entity is edited after a reference was placed
- **THEN** the placed clip keeps the asset it was created with

### Requirement: Placing a reference does not change what the project generates against

Dragging a reference onto the timeline SHALL NOT attach the entity to the project's roster and SHALL NOT change the project's generation selection. Those remain the effect of the library's explicit select action.

The two are separate decisions: placing an image says what a clip shows, and selecting an entity says what every clip generates against. A drag is the cheapest gesture the editor has and the easiest to make by accident, so it must not be able to write the selection that steers generation.

The consequence is a real seam and SHALL be treated as intended rather than as a defect: an entity whose image has been placed is not thereby cast, and generation will not use it until it is also selected.

#### Scenario: A character reference is dragged onto the timeline

- **WHEN** the operator drags a character reference onto the timeline and does not select it
- **THEN** the clip shows that image, and generation still does not cast that character

#### Scenario: Selecting after placing

- **WHEN** the operator selects an entity whose image they had already dragged onto the timeline
- **THEN** the entity is attached and generation casts it, and the already-placed clip is unaffected

#### Scenario: Removing a selection after placing

- **WHEN** the operator removes an entity from the project's selection
- **THEN** a clip placed from that entity's image keeps rendering, because it holds the project's own asset

### Requirement: Reference Library displays canonical workspace entities

The Reference Library SHALL display the canonical workspace reference entity pool, with project roster state layered onto each entry. The UI SHALL NOT treat the asset library mirror as the only source of visible references.

#### Scenario: Library survives missing mirrors

- **WHEN** the workspace contains reference entities whose asset mirror rows are missing
- **THEN** the Reference Library still shows those entities as selectable reference entries

#### Scenario: Roster state is layered on catalogue entries

- **WHEN** an entity is in the workspace library and attached to the current project roster
- **THEN** the Reference Library entry indicates that it is in the current project roster
- **AND** an unattached entity remains visible as available to attach

### Requirement: Unresolved selected references are visible before generation

When the current project generation lock names an entity that is not renderable from the project roster, the Reference Library or Project Materials surface SHALL expose that mismatch before generation starts.

#### Scenario: Selected but unattached reference is marked

- **WHEN** the project document selects a reference id that is not attached to the project roster
- **THEN** the references surface marks that selected reference as unresolved or not attached
- **AND** offers an attach or remove path rather than leaving the selection invisible

### Requirement: Catalogue image entries render their actual thumbnails

The Reference Library SHALL render actual image thumbnails for catalogue entries whose catalogue payload includes a usable image source. Current catalogue wire entries use `src` for the image URL, `note` for description text, and `kind` for reference role; web consumers SHALL normalize that payload before rendering surfaces that expect `imageUrl`, `description`, and role-like fields.

The Reference Library SHALL use a visual fallback only when a normalized catalogue entry truly has no usable image URL. It SHALL NOT show a solid color card for an entry solely because the client read the wrong field name.

#### Scenario: Catalogue src appears as thumbnail

- **WHEN** `/api/operations/catalogue` returns an image entry with `src`
- **THEN** `/library/references` renders that source as the entry thumbnail
- **AND** the entry keeps its label and description text

#### Scenario: Image lab picker receives renderable references

- **WHEN** the image lab reference picker reads the same catalogue response
- **THEN** entries with `src` are available as selectable reference images
- **AND** selected references submit absolute image URLs to the generation request

#### Scenario: Fallback only represents missing media

- **WHEN** a normalized catalogue entry has no image URL after boundary parsing
- **THEN** the Reference Library may render a labeled fallback
- **AND** entries with a valid image URL do not use the fallback in place of the image

### Requirement: Reference Library thumbnails are mobile-safe

Reference Library image cards SHALL render usable thumbnails on phone-width viewports without horizontal scrolling or label overlap. Grid columns, image aspect boxes, and labels SHALL adapt so the image remains visible and text stays within its card.

#### Scenario: Phone-width reference grid

- **WHEN** an operator opens `/library/references` on a phone-width viewport
- **THEN** reference image cards render in a single-column or compact multi-column grid that fits the viewport
- **AND** each card with a valid image URL shows its thumbnail
- **AND** card labels do not overlap neighbouring cards or controls

### Requirement: Reference surfaces expose typed visual roles

Reference Library and Project Materials Visual reference surfaces SHALL expose the fixed visual role vocabulary `style`, `character`, `location`, `product`, and `prop`. Creating or editing a reference SHALL require one of those roles and SHALL persist that role through the shared reference entity model.

Surfaces SHALL filter and group by role without splitting the reference store into separate top-level libraries. The same reference entry SHALL remain reachable from the Reference Library, Project Materials Visual detail, and scene assignment surfaces according to scope. Logo management SHALL be absent from this Visual reference surface and belong to brand placement UI instead.

#### Scenario: Operator creates a character reference

- **WHEN** an operator uploads a woman image and chooses `character`
- **THEN** the reference is saved with role `character`
- **AND** it appears under Character references in Visual Materials and Reference Library filters

#### Scenario: Operator creates a location reference

- **WHEN** an operator uploads an office set image and chooses `location`
- **THEN** the reference is saved with role `location`
- **AND** scene assignment can select it as a location reference

#### Scenario: Role filters do not fork libraries

- **WHEN** an operator filters Reference Library to Product references
- **THEN** the surface shows product-role entries from the same canonical reference pool
- **AND** clearing the filter returns the other visual roles without switching libraries

#### Scenario: Logo is not offered

- **WHEN** an operator creates a Visual reference
- **THEN** `logo` is not offered as a role
- **AND** the UI directs exact brand marks to brand placement rather than image generation references

### Requirement: Visual reference use is configured on the reference

Project Materials Visual reference surfaces SHALL let the operator set `referenceUse` on each Visual reference entry. Valid values SHALL be `exact`, `inspiration`, `style`, and `direct_place`. Scene assignment surfaces SHALL show the configured use mode but SHALL only select reference ids in v1.

#### Scenario: Character use is set once

- **WHEN** an operator sets Anna's Character reference to `exact`
- **THEN** every scene that selects Anna uses the exact mode unless the operator changes Anna's Visual reference entry

#### Scenario: Scene does not override use mode

- **WHEN** the operator assigns Anna to a scene
- **THEN** the scene assignment stores Anna's id
- **AND** it does not store a scene-specific `referenceUse`

### Requirement: Scene reference assignment is explicit in the editor

The storyboard or scene inspector SHALL let an operator assign project-selected typed Visual references to a scene. The assignment UI SHALL show the role, label, thumbnail or fallback, and usage state for each candidate. It SHALL make ambiguous multi-reference choices explicit rather than hiding them in prompt text.

#### Scenario: Three characters are available

- **WHEN** a project has Anna, Ben, and Maya as selected character references
- **AND** the operator opens a scene's reference assignment control
- **THEN** the UI lists all three as character candidates
- **AND** generation uses only the characters selected for that scene

#### Scenario: Ambiguous scene is not silently guessed

- **WHEN** a scene text says "a woman enters the office" and the project has two selected woman character references
- **THEN** the scene assignment UI marks the choice as needing selection or confirmation
- **AND** generation does not silently attach both characters by default

### Requirement: Visual reference states are visible

Visual reference surfaces SHALL show whether each role is missing, generated, user-set, preset-set, or locked. Generated entries SHALL expose accept/edit/lock/save paths. Locked entries SHALL expose unlock or replace paths without implying that regeneration may overwrite them.

#### Scenario: Generated character awaits acceptance

- **WHEN** the system generates a missing Character reference
- **THEN** the Visual Materials surface labels it as generated
- **AND** the operator can accept, edit, lock, or save it

#### Scenario: Locked product is visibly protected

- **WHEN** an operator locks a Product reference
- **THEN** the UI marks it as locked
- **AND** regeneration controls do not imply that the product will be replaced automatically

### Requirement: Reference surfaces expose selection hints

Library Material and Project Materials Visual reference surfaces SHALL let operators view and edit `selectionHint` for each selected Visual reference. Scene assignment surfaces SHALL show the selected reference's hint read-only where useful, but SHALL write scene reference ids only.

The UI SHALL use the label `Selection hint`, `Input scenario`, or equivalent concise use-when wording. It SHALL NOT call this field `anchor` in user-facing copy for v1.

Visual Material surfaces SHALL select Visual references from the workspace Reference Library. Creating, uploading, URL-pasting, or generating a reference image SHALL remain owned by Library > References, where the operator sets the reference type and default input scenario before the reference is reused by Materials.

Selected Visual references SHALL be shown as compact cards with thumbnail or fallback, label, use-when text, role, `referenceUse`, and state. The Material add/edit modal SHALL use the standard back/title/close header and Cancel/Save/Delete footer action pattern. Adding a reference SHALL follow `Reference type` > `Select reference` > `Input scenario` > `Reference use`; selecting a card SHALL choose one pending library reference, and Save SHALL commit it to the Material.

#### Scenario: Library Material authors reusable hints

- **WHEN** an operator opens a reusable Visual Material in Library Materials
- **THEN** each selected Visual reference exposes a `Selection hint` input
- **AND** saving the Material persists the hint with that reference setting

#### Scenario: Library Material selects one existing reference

- **WHEN** an operator opens a reusable Visual Material in Library Materials
- **AND** chooses to add a Character reference
- **THEN** the modal shows only Character references from the workspace library
- **AND** clicking a reference card marks one pending selection
- **AND** Save adds that one reference to the Visual Material with editable `Selection hint` and `referenceUse`

#### Scenario: Library Reference owns image creation

- **WHEN** an operator needs a new reference image
- **THEN** Library > References offers generate, upload, and URL image source controls
- **AND** the Material add-reference modal does not duplicate those creation controls

#### Scenario: Project Materials tune project-local hints

- **WHEN** an operator opens Project Materials > Visual
- **THEN** each selected Visual reference exposes its current `Selection hint`
- **AND** editing it updates the project-local Material copy

#### Scenario: Scene assignment shows why a ref matched

- **WHEN** a scene reference assignment surface lists Anna
- **THEN** it shows Anna's role, use mode, and selection hint or match reason
- **AND** choosing Anna writes Anna's reference id to the scene

#### Scenario: Scene surface does not edit hints

- **WHEN** an operator opens a scene assignment surface
- **THEN** it may show `Selection hint` and match reason for each candidate
- **AND** it does not expose full hint editing or write hint text into the scene document

#### Scenario: Ambiguous scene asks for choice

- **WHEN** a scene matches both Anna and Maya
- **THEN** the UI marks the scene reference choice as needing selection or confirmation
- **AND** it does not hide the ambiguity in prompt text

#### Scenario: Material reference modal is searchable

- **WHEN** an operator adds a Visual reference from a Material
- **THEN** the modal filters candidates by selected type
- **AND** it provides search within those candidates before Save

### Requirement: References library uses shared library search and group controls

Library > References SHALL use the shared Library toolbar for search and reference filtering. Images, Products, and Notes SHALL be presented as source groups or group filters in that toolbar rather than as a separate control pattern. Search SHALL remain available for every searchable source group.

Library > References SHALL also expose a reference role/type filter for image/entity references where role metadata exists. Supported role/type options SHALL include Style, Character, Location, Product, and Prop. Search SHALL combine with the active source group and active role/type filter.

Library > Voices SHALL use the shared Library toolbar for search only in the first pass. Voice language metadata MAY remain visible on rows, but it SHALL NOT create a language group filter until a stronger operator taxonomy is defined.

#### Scenario: Reference source groups use the shared toolbar

- **WHEN** an operator opens Library > References
- **THEN** Images, Products, and Notes are reachable through the shared Library toolbar group controls
- **AND** they are not presented through a separate page-specific tab pattern

#### Scenario: Reference role filter narrows image references

- **WHEN** an operator opens Library > References and selects the Character role/type filter
- **THEN** image/entity reference cards are narrowed to character references
- **AND** clearing the role/type filter restores every image/entity reference in the active source group

#### Scenario: Reference search remains available across searchable groups

- **WHEN** an operator switches among Images, Products, and Notes
- **THEN** the search control remains in the shared Library toolbar for groups that can be searched
- **AND** the query combines with the active reference group

### Requirement: Reference cards open detail and edit flows

Library > References SHALL let an operator open a reference detail view by clicking a reference card. The detail view SHALL show the reference's core creative metadata, including label, role/type, image or source preview when available, prompt/source metadata when available, and Input scenario when available.

The detail view SHALL expose an edit flow for editable references. Editing SHALL update the canonical reference record, including Input scenario, rather than writing only a catalogue mirror. Read-only or fixture references SHALL make edit unavailability clear without hiding the inspect details.

#### Scenario: Clicking a reference card opens detail

- **WHEN** an operator clicks a reference image/entity card
- **THEN** a detail view opens for that reference
- **AND** the operator can see label, role/type, preview, and Input scenario when those fields exist

#### Scenario: Editing Input scenario saves to the reference

- **WHEN** an operator edits a reference's Input scenario and saves
- **THEN** the reference record persists the new Input scenario
- **AND** returning to the reference card/detail shows the saved text

#### Scenario: Voices use shared search without group chips

- **WHEN** an operator opens Library > Voices
- **THEN** search appears in the shared Library toolbar
- **AND** no voice group filter chips are shown
- **AND** each voice may still show language metadata as row information
