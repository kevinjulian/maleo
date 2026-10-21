# reference-entity-model Specification

## Purpose

A reference has ONE owner of its identity and role: a workspace-scoped `reference_entity` carrying a
stable id, a CHECK-constrained role, one canonical image, and a written description that reaches the
generation reference map. Projects and scenes SELECT entities; they never copy them.

This exists because the previous model spread one concept across eight stores and carried two
orthogonal axes (asset type and scene role) in a single free-text `kind` column. Every consumer
re-derived role with its own filter and its own fallback, and the fallbacks disagreed — the same
reference rendered as Style in the library and bound as Character at generation. Two data-corruption
paths followed from that shape: role edits forked the row (role was in the dedupe key) and two
references sharing a source url overwrote each other's identity (the url-match fallback did not
compare ids). Both are structurally impossible here rather than patched.

Corollary: things that are not castable subjects do not live in the reference store. Citations,
per-project style locks, text notes, and voice definitions each have their own table, because a cited
webpage reaching the roster meant it could be attached to a scene as a character reference.

## Requirements

### Requirement: Workspace-scoped reference entity

The system SHALL store each castable reference as a single `reference_entity` row scoped to a
workspace, carrying a stable id, a role, a label, a text description, and one canonical image url.
The system SHALL NOT store a reference's identity across multiple tables or derive it from a
client-supplied key nested inside a JSON column.

"A single row" SHALL be enforced on the write path, not merely asserted. Two entities in one workspace
sharing a role, a label, and a canonical image url are the same reference, and that tuple is the
entity's **content key**. Creating an entity whose content key already exists SHALL reuse and update
the existing row rather than insert a second one.

Matching SHALL be by id first and content key second. A caller that names an existing id is editing
that entity — including renaming it, which changes its content key — and an edit SHALL NOT be
redirected onto another row. The content key applies only when the supplied id matches no existing row.

An entity with no canonical image url has no content key and SHALL NOT be matched against any other
entity: an entity awaiting an image is not a duplicate of another entity awaiting one.

#### Scenario: Entity owns its identity

- **WHEN** a reference entity is created
- **THEN** its row primary key is the only identifier for it, and no separate logical id is stored inside `meta_json` or any other JSON column

#### Scenario: Entity is reachable across projects in a workspace

- **WHEN** two projects belong to the same workspace and the workspace library holds one character entity
- **THEN** both projects can select that same entity by id without copying it

#### Scenario: Entity carries description and canonical image

- **WHEN** an entity is resolved for generation
- **THEN** both its text description and its canonical image url are available

#### Scenario: A caller minting a new id reuses the matching entity

- **WHEN** a caller creates an entity with an id no row holds, and its workspace, role, label, and canonical image url match an existing entity
- **THEN** the existing entity is returned and updated
- **AND** the workspace holds one row for that reference, not two

#### Scenario: Creating from a project does not fork the library

- **WHEN** several projects in one workspace each add the same reference and none supplies an existing id
- **THEN** the workspace library holds one entity for it
- **AND** every project's roster attaches that same entity

#### Scenario: An edit by id is an edit, not a merge

- **WHEN** a caller supplies the id of an existing entity and changes its label to match another entity's content key
- **THEN** the named entity is updated in place
- **AND** the other entity is left untouched

#### Scenario: Entities without an image are never matched to each other

- **WHEN** two entities in a workspace share a role and a label and neither has a canonical image url
- **THEN** they remain two entities

### Requirement: Pre-existing duplicate entities are collapsed for display

A workspace may already hold several rows describing one reference, created before the content key was
enforced. Surfaces that present the reference library SHALL show one entry per content key rather than
one per row.

Those rows SHALL NOT be deleted or repointed to achieve this. Each is attached to some project's roster
and named by some document's generation lock, so removing one empties a roster and makes a lock
unresolvable. Every id SHALL stay resolvable.

The surviving entry SHALL be chosen deterministically, so the library does not reorder between reads.
Where a project's own roster copy is one of the duplicates, that copy SHALL be the one presented, so a
selection made against it still resolves.

#### Scenario: Duplicate rows show as one library entry

- **WHEN** a workspace holds seven entities sharing a role, label, and canonical image url
- **THEN** the reference library shows one entry for them

#### Scenario: The collapsed entry is stable between reads

- **WHEN** the reference library is read twice with no write in between
- **THEN** the same row represents that reference both times

#### Scenario: A project's own copy is the one shown

- **WHEN** a project's roster attaches one of the duplicate rows and the library also holds an older one
- **THEN** the surface presents the attached copy
- **AND** a selection naming the attached copy resolves rather than reporting as unattached

#### Scenario: Collapsing does not retire any id

- **WHEN** duplicate rows are collapsed for display
- **THEN** every one of those ids still resolves to an entity for generation and for roster attachment

### Requirement: Constrained role vocabulary

The system SHALL constrain `reference_entity.role` to exactly `style`, `character`, `location`, `product`, and `prop` at the database level. The system SHALL resolve a reference's role from that column only, through a single shared resolver, and SHALL NOT derive role from a free-text column or from tag ordering.

`location` SHALL represent a recurring place, set, room, landscape, or spatial layout. `style` SHALL represent visual grammar, palette, medium, lighting, mood, atmosphere, and look guidance rather than a castable subject. Product references SHALL be user-selected or uploaded; the system SHALL NOT generate Product reference entities automatically. Logos SHALL NOT be stored as Visual generation references in this vocabulary.

#### Scenario: Invalid role rejected at write time

- **WHEN** a write attempts to store a role outside the five permitted values
- **THEN** the database rejects the write

#### Scenario: One resolver, one answer

- **WHEN** the UI renders an entity's role and the generation path resolves the same entity's role
- **THEN** both call the same shared resolver and obtain identical values

#### Scenario: Role is not part of any uniqueness key

- **WHEN** an entity's role is changed from `style` to `character`
- **THEN** the change is an update to the existing row, and no duplicate row is created

#### Scenario: Location and style are distinct roles

- **WHEN** an operator creates a recurring office set and a rainy mood reference
- **THEN** the office set is stored as `location` and the rainy mood reference is stored as `style`

#### Scenario: Logo role is rejected

- **WHEN** a write attempts to store a reference entity with role `logo`
- **THEN** the database rejects the write because logos belong to brand placement, not Visual generation references

### Requirement: Project selection layer

The system SHALL represent a project's attached references as selection rows referencing entities by
foreign key, carrying no copy of the entity's role, label, description, or image. Selection SHALL be
unique per project, entity, and scene key.

#### Scenario: Selection references, never copies

- **WHEN** a project attaches a workspace entity
- **THEN** a selection row is created holding the project id, entity id, and scene key, and the entity's attributes are not duplicated into it

#### Scenario: Editing an entity propagates to every project

- **WHEN** an entity's label is edited in the workspace library and three projects have selected it
- **THEN** all three projects observe the new label without any per-project write

#### Scenario: Duplicate selection is rejected

- **WHEN** the same entity is attached twice to one project with the same scene key
- **THEN** the second attach is a no-op rather than a second row

### Requirement: Nesting of selection scopes

The system SHALL enforce that a scene's cast is a subset of its project's selected references, and
that a project's selected references are a subset of its workspace library.

#### Scenario: Scene cannot cast an unselected entity

- **WHEN** a scene declares a cast id that the project has not selected
- **THEN** that id is dropped before render

#### Scenario: Project cannot select an out-of-workspace entity

- **WHEN** a project attempts to select an entity belonging to a different workspace
- **THEN** the selection is rejected

### Requirement: Reference library holds only castable subjects

The system SHALL restrict the reference library to visual references that can guide or appear in generated images: `style`, `character`, `location`, `product`, and `prop`. Research citations, brand logos for exact placement, per-project generated style lock plates, text notes, and audio/voice definitions SHALL NOT be resolvable as reference entities, and SHALL each have a dedicated store.

Subject castability SHALL be derived from role and image availability in the shared entity decode. `character`, `product`, and `prop` MAY be castable subjects when they have safe canonical images. `style` SHALL guide look but SHALL NOT consume subject cap quota as a character. `location` SHALL be selectable as scene context and SHALL NOT be treated as a person or product subject.

#### Scenario: Citation is not a reference

- **WHEN** the agent records a cited source url during research
- **THEN** it is written to the citation store and does not appear in any project's roster

#### Scenario: Style lock is project state

- **WHEN** a project's generated style lock is saved
- **THEN** it is stored as per-project style state, one row per project, and is not resolvable as a cast entity unless the operator saves it as reusable Visual Material content

#### Scenario: Voice is not a visual reference

- **WHEN** a project's voice cast is read
- **THEN** it resolves from the speaker store, carries no image, and is never resolvable as a visual reference entity

#### Scenario: Text note is not a cast entity

- **WHEN** a project's notes are read
- **THEN** they resolve as text-only project notes and none of them appears in the project's roster

#### Scenario: Style does not consume character quota

- **WHEN** a scene uses two character references and one style reference
- **THEN** the style reference does not consume the subject cap slot used for character identity binding

#### Scenario: Legacy environment becomes style

- **WHEN** a pre-change entity has role `environment`
- **THEN** migration or compatibility parsing treats it as `style`
- **AND** the operator can edit it to `location` if it represents a recurring place

### Requirement: Single asset mirror row per entity

The system SHALL mirror a reference entity into the asset library as at most one row, keyed
independently of the entity's origin or generated status. The system SHALL delete mirror rows on
entity deletion rather than marking them with a tombstone status.

#### Scenario: Origin change does not fan out

- **WHEN** an entity's origin changes from linked to generated
- **THEN** its existing mirror row is updated in place and no additional mirror row is created

#### Scenario: Delete removes the mirror

- **WHEN** an entity is deleted
- **THEN** its mirror row is removed from the asset library, leaving no tombstone

#### Scenario: Re-adding after delete leaves one row

- **WHEN** an entity is deleted and an entity with the same canonical image is then created
- **THEN** exactly one mirror row exists for it

### Requirement: Flat project selection

The system SHALL represent a project's attached references as a single flat list of entity ids. The
system SHALL NOT partition that selection into parallel per-kind arrays, and SHALL NOT require an id
prefix to distinguish what an id refers to.

#### Scenario: One list, not four buckets

- **WHEN** a project's attached references are read
- **THEN** they resolve as one flat list of entity ids, with each entity's role coming from the entity itself

#### Scenario: Count has one code path

- **WHEN** a project's reference count is computed
- **THEN** it derives from that one list, with no branch selecting between an older and newer storage shape

#### Scenario: Product needs no id prefix

- **WHEN** a catalogue product is attached to a project
- **THEN** it is selected as a `product`-role entity by its own id, with no `prod_` prefix encoding its kind

#### Scenario: Reference needs no media-asset alias

- **WHEN** a reference is used where a media asset is expected
- **THEN** it resolves through its entity id, with no `refmedia:` prefixed alias standing in for it

### Requirement: Selection is expressed in one shape wherever it is stored

The system SHALL express a project's reference selection in exactly one shape — the flat entity-id
list — in every place it is persisted, so no reader has to branch on storage generation.

> The storyboard document carries `{ prompt, entityIds }` and is the generation lock. This is the
> design, not a compromise. `flatten-project-references` proposed making the project-reference
> relation the sole source of the selection; that was investigated and rejected, because the two
> stores hold different facts. The relation is the project's ROSTER — which entities are attached —
> and the document's `entityIds` is which of those apply to every clip. Where a project has both,
> the document selection is a strict subset of the relation in every case measured (23 of 23).
> Collapsing them would erase the distinction the reference tiers are built on.

#### Scenario: Every persisted copy carries the flat shape

- **WHEN** a storyboard document or a preset bundle is saved
- **THEN** its embedded selection is the flat entity-id list, and no four-bucket copy is written

#### Scenario: Legacy document still loads

- **WHEN** a storyboard document written before this change is loaded
- **THEN** its embedded selection is normalised into the flat shape and the project loads without error

### Requirement: Speaker is named distinctly from cast

The system SHALL name the voice model distinctly from the visual cast model, so that "cast" refers
unambiguously to visual reference entities.

#### Scenario: Voice and visual cast are distinguishable

- **WHEN** an operator manages voices and manages visual references
- **THEN** the two use distinct names, and neither is labelled "cast" in a way that would apply to the other

#### Scenario: Voices resolve from the speaker store

- **WHEN** a project's voices are read
- **THEN** they resolve from the speaker store rather than from reference rows carrying a voice key

### Requirement: The project roster is writable by an operator

The system SHALL let an operator attach a workspace reference entity to a project and detach it
again. Attaching SHALL be idempotent, and SHALL be refused when the entity belongs to a different
workspace than the project.

#### Scenario: Attaching an entity to a project

- **WHEN** an operator attaches a workspace entity to a project
- **THEN** it becomes part of the project's roster, and attaching it again leaves one attachment

#### Scenario: Detaching an entity from a project

- **WHEN** an operator detaches an entity from a project
- **THEN** it leaves the project's roster and remains in the workspace library

#### Scenario: The generation lock is effective only for attached entities

- **WHEN** an entity is named in a project's generation lock but is not attached to the project
- **THEN** it contributes no reference image at generation time, so a surface that locks an entity SHALL also attach it

#### Scenario: Cross-workspace attachment is refused

- **WHEN** an attachment names an entity from another workspace
- **THEN** it is rejected with an error rather than silently ignored

### Requirement: The project's lead subject is set by the operator

The system SHALL let an operator designate which attached entity is the project's lead subject, and
SHALL keep at most one lead subject per project.

#### Scenario: Designating a lead subject

- **WHEN** an operator marks an attached entity as the project's lead subject
- **THEN** it is recorded as the project's primary reference and any previous one is cleared

#### Scenario: Clearing the lead subject

- **WHEN** an operator clears the project's lead subject
- **THEN** no entity is primary for that project

### Requirement: The entity model is the only reference store

The system SHALL resolve every reference from the entity model. No fallback path to a legacy
reference table SHALL remain, and no reference SHALL be addressable by a client-generated key nested
inside a JSON column.

#### Scenario: No legacy fallback on read

- **WHEN** a project's references or roster are read
- **THEN** they resolve solely from the entity model, with no fallback to a legacy reference table

#### Scenario: No dual id resolution

- **WHEN** a reference is looked up or deleted by id
- **THEN** the lookup matches on the entity's own primary key only, never additionally on a key extracted from JSON

#### Scenario: Every consumer sees one roster

- **WHEN** any consumer lists a project's roster
- **THEN** it applies no local exclusion filter of its own, and every consumer observes the same roster

### Requirement: A text note is written to the note store

The system SHALL write a text-only note to the project note store. The system SHALL NOT write notes
into the reference store.

#### Scenario: Note round-trips through its own store

- **WHEN** an operator creates a text note and reloads the project
- **THEN** the note is read back from the note store and never appears in the project's roster

### Requirement: One decode owns the reference entity row

The system SHALL decode a `reference_entity` row into a domain entity in exactly one module.
The row's database shape — the `_json` suffixes, the 0/1 integers, the `canonical_` prefix —
SHALL NOT be interpreted anywhere else. Every other view of an entity, including the roster
and the cast used for generation, SHALL be a projection of the decoded entity rather than a
second reading of the row.

#### Scenario: Generation and the editor read one decode

- **WHEN** the generation path resolves a project's attached entities
- **THEN** it obtains them from the same decode the editor's payload is built from
- **AND** it does not read `is_primary`, `canonical_image_url` or `tags_json` itself

#### Scenario: One roster, one answer

- **WHEN** two surfaces ask which entities a project has attached
- **THEN** both receive a set derived from the same decode
- **AND** the two sets differ only by a castability rule that is stated in that module

### Requirement: Castability rules are stated once

The rules that decide whether a decoded entity can be cast — that a style entity binds a
global look rather than an indexed subject, and that an entity without an image cannot be
bound to a reference image — SHALL be expressed once, in the module that owns the decode, and
named. A surface that needs the castable set SHALL obtain it from there rather than filtering
rows itself.

#### Scenario: A style entity is excluded from the cast in one place

- **WHEN** a project's roster contains a style entity
- **THEN** the castable projection omits it
- **AND** no consumer applies its own style exclusion

#### Scenario: An imageless entity is excluded from the cast in one place

- **WHEN** a project's roster contains an entity with no canonical image
- **THEN** the castable projection omits it
- **AND** no consumer applies its own image check

#### Scenario: The wire view is not the castable view

- **WHEN** the editor requests a project's attached entities
- **THEN** it receives every attached entity, including style and imageless ones
- **AND** the castable projection used by generation is a narrowing of that same decode

### Requirement: The row shape stops at the seam on writes as well as reads

A route that creates or updates a reference entity or a project note SHALL answer with the
domain shape, not the row it wrote. Applying the decode on reads while returning rows from
writes SHALL NOT be permitted.

#### Scenario: Creating a reference entity answers in the domain shape

- **WHEN** a client attaches a reference entity to a project
- **THEN** the response carries the entity in the same shape a read would return
- **AND** it contains no `selection_id`, `tags_json`, `canonical_image_url` or 0/1 integer flag

#### Scenario: Creating a note answers in the domain shape

- **WHEN** a client creates a project note
- **THEN** the response carries the note in the shape a read would return
- **AND** it contains no `is_default` integer

### Requirement: The reference map and the subject cap report have one producer

The resolver that computes a scene's references SHALL be the only producer of that scene's
**Reference map**, and its report of entities dropped by the **Subject cap** SHALL reach the
surface that presents the run. A consumer SHALL NOT discard the resolver's map and rebuild an
equivalent one.

#### Scenario: The map is not rebuilt

- **WHEN** the generation path resolves a scene's references
- **THEN** it uses the reference map the resolver returned
- **AND** no second module composes an equivalent map for the same scene

#### Scenario: A capped subject is reported on the agent path

- **WHEN** the subject cap drops an entity from a scene during an agent run
- **THEN** the run reports that the subject was dropped
- **AND** the count it presents is the capped set, matching what the render used

### Requirement: An id absent from the roster is reported, not dropped in silence

The resolver that computes a scene's references SHALL distinguish two reasons an id yields no
reference: the id is absent from the project's **roster**, or the id resolved but was dropped by the
**Subject cap**. It SHALL report both, and the surface that presents the run SHALL surface both.

A selected id that contributes nothing to a render SHALL NOT do so without saying it. Reporting the
cap alone is insufficient: an id that never entered the roster never reaches the cap, so a report
built only from capped entities cannot mention it.

A roster miss SHALL additionally be **blocking**. The generation path SHALL preflight project-level
selected references and scene cast references against the project roster **before any image provider
call**. If a selected id cannot resolve to an attached reference entity, the run SHALL park or fail
with a structured unresolved-reference finding rather than generating images that silently omit it.
A cap drop remains non-blocking: it is a declared limit, not a broken selection.

The system SHALL NOT substitute an unrelated roster entry for a missing selected id.

#### Scenario: A selected id that is not on the roster is reported

- **WHEN** a scene's cast declares an entity id that is not attached to the project
- **THEN** the resolver reports that id as absent from the roster
- **AND** the run states that the reference contributed nothing

#### Scenario: The two drop reasons are distinguishable

- **WHEN** one scene declares an id absent from the roster and another declares an id the subject cap drops
- **THEN** the resolver reports the first as a roster miss and the second as a cap drop
- **AND** a consumer can tell the two apart without inspecting the roster itself

#### Scenario: No selected id disappears without a report

- **WHEN** a run resolves a scene whose declared cast yields fewer references than ids declared
- **THEN** every id that yielded no reference appears in the resolver's report under one of the two reasons

#### Scenario: Roster miss blocks before provider calls

- **WHEN** a project generation lock names `Sketch Stickman` and the project roster does not attach that entity
- **THEN** image generation stops before any provider call
- **AND** the run reports that `Sketch Stickman` is not attached to the project

#### Scenario: Unrelated roster entry is not substituted

- **WHEN** a selected reference is missing but another entity is attached to the project roster
- **THEN** generation does not backfill the unrelated entity in place of the selected id

#### Scenario: Cap drop does not block

- **WHEN** every selected id resolves but the subject cap drops one of them
- **THEN** generation proceeds and the cap drop is reported

#### Scenario: Fixed roster allows generation

- **WHEN** the missing selected reference is attached to the project roster and has a safe canonical image url
- **THEN** generation preflight passes for that reference
- **AND** provider calls receive it through the normal ordered reference resolver

### Requirement: Entity catalogue visibility does not depend on asset mirrors

The system SHALL expose workspace `reference_entity` rows through the reference catalogue even when their mirrored `content_assets` rows are missing, sparse, or stale. Asset mirrors MAY contribute media-library metadata, but they SHALL NOT be the source of truth for whether a castable reference appears in the Reference Library.

A catalogue entry's id SHALL be the entity id already stored in project documents and generation locks, so switching the catalogue's source of truth does not invalidate existing selections.

Reference suppression (operator deletion) SHALL be keyed so that it still applies when the catalogue is read from entities. A reference the operator deleted SHALL NOT reappear because its asset mirror row is gone.

#### Scenario: Entity without mirror appears in catalogue

- **WHEN** a workspace has a `reference_entity` row with a safe canonical image url and no matching `content_assets` mirror
- **THEN** the reference catalogue includes that entity with its id, role, label, description, and canonical image url

#### Scenario: Sparse mirror does not hide other entities

- **WHEN** a workspace has many reference entities but only two asset mirror rows
- **THEN** the Reference Library lists the entity set rather than only those two mirrored assets

#### Scenario: Catalogue ids match stored selections

- **WHEN** a project document selects a reference id and the catalogue is read from canonical entities
- **THEN** the catalogue exposes that same id for that reference
- **AND** the existing selection still resolves without rewriting the document

#### Scenario: Deleted reference stays deleted

- **WHEN** an operator has deleted a reference and its asset mirror row is missing
- **THEN** the entity-sourced catalogue still omits that reference

### Requirement: Generation lock reconciliation preserves roster boundaries

A project generation lock SHALL only be effective for references attached to that project roster. When a lock names a workspace entity that is not attached, the system SHALL reconcile it through explicit roster attachment during preset/manual selection flows or report it as unresolved before generation.

#### Scenario: Locked workspace entity is attachable

- **WHEN** a project generation lock names an entity in the same workspace but the project roster lacks it
- **THEN** preset/manual selection reconciliation can attach that entity to the roster
- **AND** generation preflight reports the mismatch if reconciliation has not occurred

#### Scenario: Locked foreign entity is not attachable

- **WHEN** a project generation lock names an entity from another workspace
- **THEN** the system refuses to attach it
- **AND** generation reports it as unresolved rather than fetching or rendering it

### Requirement: Generated story references have idempotent content keys

The system SHALL create agent-derived story references through a server-side helper that computes an idempotent content key from workspace, role, normalized label, normalized description, and intended generated-reference purpose. The helper SHALL return an existing matching entity when one exists and SHALL attach that entity to the project roster.

The idempotent key SHALL be stable across approval retries, reloads, and resumed workflow runs. It SHALL NOT depend on `Date.now()`, random ids, chat message order, or client-minted ids.

#### Scenario: Retry does not duplicate a protagonist

- **WHEN** a `pov kamu hidup di jaman batu` plan is approved twice after a retry
- **THEN** the workspace contains one generated protagonist reference for that plan intent
- **AND** the project roster points to the same entity id both times

#### Scenario: Resumed workflow preserves ids

- **WHEN** a workflow run is suspended after creating generated story references and then resumes
- **THEN** the resumed run resolves the same entity ids from persisted story plan data or the idempotent content key

### Requirement: POV subject references may use non-portrait canonical images

The reference entity model SHALL allow an agent-derived character reference for a POV subject to use a canonical image that represents the visible form used by the video, such as first-person hands, clothing/body silhouette, tool grip, or reflection. A character reference SHALL NOT require a front-facing portrait when the story plan declares a POV visibility mode that would make a portrait misleading.

#### Scenario: Hands reference is valid character reference

- **WHEN** a POV protagonist is only visible through hands and worn materials
- **THEN** the generated reference entity may store a canonical image of those hands/materials
- **AND** generation can bind it as the protagonist reference

#### Scenario: Portrait requested only when useful

- **WHEN** the story plan marks a recurring supporting character as face-visible
- **THEN** the generated reference helper may create a portrait-style canonical image for that supporting character
- **AND** this rule does not apply to the POV protagonist unless the plan marks face visibility

### Requirement: Generated story references record provenance

Generated story references SHALL record enough provenance to explain why they exist: source story plan id or run id, plan-local key, prompt or description used to create the canonical image, and generated origin. This provenance SHALL be available for debugging duplicate prevention and prompt/reference mismatches without treating the provenance as the entity's primary identity.

#### Scenario: Reference provenance names the story plan

- **WHEN** the agent creates a generated story reference during approval
- **THEN** the entity or its associated trace records the story plan/run and plan-local key that requested it

#### Scenario: Provenance is not identity

- **WHEN** the same generated reference is reused through the idempotent content key
- **THEN** its provenance may accumulate another run/plan pointer
- **AND** the system still treats the existing entity id as the reference identity
