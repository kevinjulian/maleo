# Generation Cast Selection

## Purpose

Project reference is a keyed library of named entities. Scenes select which entities appear
(their "cast"), and the renderer binds each selected reference file to its exact subject via an
index-keyed reference map, so multi-subject scenes never blend or mis-assign identities.

## Requirements

### Requirement: Keyed reference entity library

The system SHALL represent the reference library as a set of named entities scoped to a workspace, each with a stable id, a role from the fixed visual role vocabulary, an image url when available, and a short text description. The system SHALL NOT collapse entities of the same role into a single slot.

The role SHALL be stored in a constrained column and resolved through a single shared resolver, never inferred from a free-text column or from tag ordering. Valid roles are `style`, `character`, `location`, `product`, and `prop`.

#### Scenario: Two characters coexist

- **WHEN** a workspace has two character references, one for a man and one for a woman
- **THEN** each is stored as a distinct entity with its own id, image url, and description, and both are independently resolvable

#### Scenario: Entity carries text and image

- **WHEN** an entity is resolved
- **THEN** both its text description and its image url are available to the renderer when present

#### Scenario: Role resolves identically everywhere

- **WHEN** the library UI and the generation path each resolve the same entity's role
- **THEN** both obtain the same value from the same shared resolver

#### Scenario: Product and location roles resolve

- **WHEN** a scene resolves a product reference and a location reference
- **THEN** both retain their roles through ordered reference resolution

### Requirement: Per-project roster

The system SHALL let a project attach a subset of workspace library entities as its roster, by
reference rather than by copy. Only roster entities SHALL be selectable by that project's scenes.

#### Scenario: Roster limits selection

- **WHEN** the library has five entities and a project's roster contains three
- **THEN** only those three ids are valid cast for that project's scenes

#### Scenario: Roster attaches without copying

- **WHEN** a project attaches a library entity to its roster
- **THEN** a selection row referencing the entity id is created, and the entity's role, label, description, and image are not duplicated

### Requirement: Per-scene cast field

The system SHALL give each scene an ordered visual reference assignment field: the existing `cast` field or its canonical successor. The field SHALL contain roster entity ids that appear in or guide that scene. An empty assignment SHALL mean no scene-specific reference entities are attached to that scene.

Scenes SHALL store reference ids only. `referenceUse` SHALL be configured on the Visual reference entry and resolved from that entry during generation.

User-facing UI SHALL describe this as scene references or visual references rather than requiring the word "cast" for non-character roles.

#### Scenario: Scene declares its visual references

- **WHEN** a scene features Anna in the office with the product on screen
- **THEN** its ordered scene reference assignment contains the ids for Anna, the office location, and the product

#### Scenario: Scene declares its cast

- **WHEN** a scene features the man and the cafe environment
- **THEN** its ordered scene reference assignment contains the ids for the man and cafe

#### Scenario: Empty cast is text-only

- **WHEN** a scene's reference assignment is empty and no project-level default applies
- **THEN** no reference images are attached and the prompt carries no reference map

#### Scenario: Non-character role is not mislabeled

- **WHEN** a scene selects a location reference
- **THEN** the editor presents it as a scene reference or location, not as a character cast member

#### Scenario: Scene stores ids only

- **WHEN** a scene selects Anna whose Visual reference entry is configured as `exact`
- **THEN** the scene stores Anna's reference id
- **AND** it does not store a scene-specific use-mode override

### Requirement: Planner cast tagging with closed-list validation

The system SHALL provide every planning or direction stage that selects scene or
shot references the project roster as a labeled closed list. Non-story scene
planners SHALL emit `cast` ids per scene from that list. For a canonical story
plan, the internal story visual-direction stage SHALL own the final per-planned-shot
reference bindings; frame and draft reference output is provisional until that
stage validates it.

An emitted existing entity id SHALL come from the supplied roster. For story visual
direction, an unknown id SHALL fail direction before approval. For compatibility
paths that predate approval-time validation, the system SHALL drop an unknown id
before render.

#### Scenario: Planner picks from roster

- **WHEN** a non-story planner writes a scene where the man speaks
- **THEN** it sets `cast` to the man's id, chosen from the provided roster list

#### Scenario: Story direction finalizes proposed references

- **WHEN** story frame or draft proposes references for a planned shot
- **THEN** story visual direction selects final existing entity ids from the supplied roster or planned-reference keys it declares
- **AND** generation does not treat the provisional values as independent authority

#### Scenario: Unknown story id blocks approval

- **WHEN** story visual direction emits an entity id not present in the project roster
- **THEN** direction validation fails before approval
- **AND** the unknown id does not reach reference materialization or render

#### Scenario: Unknown legacy id is dropped

- **WHEN** a compatibility path without approval-time visual direction carries an id absent from the roster
- **THEN** that id is removed during validation
- **AND** it does not reach render

### Requirement: Roster-size cast defaulting

The system SHALL default cast by roster size in the live generation path: size 0 yields empty cast
for every scene; size 1 auto-assigns the single entity to every scene; size 2 or more requires
planner-tagged cast, with a designated primary entity inheriting into any scene whose cast is empty.
The system SHALL implement this defaulting once, in the path that actually resolves references for
generation.

#### Scenario: Single-entity auto-cast

- **WHEN** a project roster has exactly one character entity and a scene's cast is untagged
- **THEN** that entity's reference image is attached to the scene at generation

#### Scenario: Primary inherited on empty cast

- **WHEN** the roster has two or more entities, one marked primary, and a scene's cast is empty after planning
- **THEN** the primary entity is used for that scene at generation

#### Scenario: Empty roster attaches nothing

- **WHEN** a project roster is empty
- **THEN** every scene generates with no reference images attached

### Requirement: Ordered cast resolution to aligned outputs

The system SHALL resolve a scene's `cast` in a single ordered pass into a structured ordered
reference list. That list SHALL preserve url, role, entity id, label, and description. Native-reference
prompt compilation SHALL derive both the ordered provider reference-image array and the index-keyed
reference map from that same ordered list, so index N in the prompt refers to array position N.
Text-only prompt compilation SHALL derive its reference brief from that same ordered list without
using image index wording. That ordered pass SHALL be the only resolution path; a second resolver
producing the same outputs by different rules SHALL NOT exist.

#### Scenario: Array and map share order

- **WHEN** a scene's cast is `["man", "woman"]` and the selected provider supports native references
- **THEN** the reference array is `[man_url, woman_url]` and the prompt map states `Image 1 = man`, `Image 2 = woman` in that same order

#### Scenario: Reference map binds each file

- **WHEN** the reference map is emitted for a multi-entity cast
- **THEN** it names each image index, its entity id, its description, and instructs the model to use that image only for that subject and not to blend identities

#### Scenario: Text-only brief uses same ordered references

- **WHEN** a scene has cast references and the selected provider uses text-only reference fallback
- **THEN** the prompt brief names the same ordered subjects by role, label, and description without saying that images are attached

#### Scenario: One resolver serves every entry point

- **WHEN** references are resolved for a scene or for a direct scene-generation request
- **THEN** all of them route through the same ordered resolution, applying the same opt-out, defaulting, and cap rules

### Requirement: Reference order and role preserved to provider

The system SHALL preserve reference order, role, label, entity id, and description through image
generation request boundaries until provider-aware prompt compilation is complete. The system SHALL
NOT flatten scene references to a bare url array before the worker has selected a provider and
compiled the final request shape.

#### Scenario: Media client keeps structured references

- **WHEN** an ordered, labeled reference array is submitted for generation
- **THEN** the media worker receives the images in the same order with their roles, labels, entity ids, and descriptions intact

#### Scenario: Provider receives supported subset

- **WHEN** provider-aware prompt compilation completes
- **THEN** the provider receives only the reference URL list and prompt wording supported by its declared reference mode

### Requirement: Multi-subject cast cap and anti-blend guidance

The system SHALL cap the number of subject entities attached to one scene and SHALL include
explicit anti-blend, per-subject binding language in the reference map to reduce identity bleed on
weaker providers. Reaching the subject cap SHALL NOT prevent non-subject references (environment,
style, prop) from being attached. The cap SHALL be defined once and applied by a single
implementation, and that implementation SHALL report which entities the cap dropped alongside the
entities it resolved, so any surface can describe the set that renders.

#### Scenario: Cast cap enforced

- **WHEN** a scene's cast exceeds the subject cap
- **THEN** the system limits attached subject references to the cap and prioritizes primary/hero entities

#### Scenario: Non-subject refs survive a full subject quota

- **WHEN** a scene's cast lists subjects beyond the cap followed by an environment entity
- **THEN** the over-cap subjects are skipped and the environment entity is still attached

#### Scenario: Anti-blend text present

- **WHEN** two or more subject references are attached
- **THEN** the reference map includes explicit "use only for X, do not blend identities" instructions per subject

#### Scenario: Dropped subjects are reported, not hidden

- **WHEN** a scene's cast exceeds the subject cap
- **THEN** the resolution result names the dropped subjects, and every surface that counts or lists the scene's references reports the capped set rather than an uncapped one

### Requirement: Roster excludes non-castable rows

The system SHALL exclude research citations, per-project style lock plates, text notes, and audio
assets from a project's roster. The system SHALL determine castability from the entity model rather
than from per-consumer exclusion filters.

#### Scenario: Citation never enters the roster

- **WHEN** the agent has recorded cited source urls for a project
- **THEN** none of them appear in that project's roster or are attachable as a subject reference

#### Scenario: One castability rule

- **WHEN** any consumer lists a project's roster
- **THEN** it applies no local exclusion filter of its own, and every consumer observes the same roster

### Requirement: Agent-created characters get a durable server-side identity

The system SHALL persist a character created by the agent as a workspace reference entity with a
stable id, so it is selectable as cast and survives a reload. The system SHALL NOT depend on the
client minting an id for an agent-created character.

#### Scenario: Agent character is castable

- **WHEN** the agent creates a character with a name and description and generates its portrait
- **THEN** a reference entity is persisted with that description and portrait, and it appears in the project's roster

#### Scenario: Identity is stable across applies

- **WHEN** a completed agent run that created a character is applied to the editor more than once (for example a run, then a reload that resumes the same settled job)
- **THEN** the character resolves to the same entity id both times and the library contains exactly one entry for it

#### Scenario: Character survives reload

- **WHEN** an agent-created character is applied to the editor and the page is reloaded
- **THEN** the character is still present, resolved from its persisted entity rather than from job state

### Requirement: Single effective-ref resolution

The system SHALL derive a scene's effective references — the project selection, excluded when the
scene opts out of project references, plus the scene's own cast, deduplicated in that order — in
exactly one implementation, shared by every surface that displays, counts, or generates references.
No caller SHALL re-derive the rule locally.

#### Scenario: Scene opt-out is honored on the generation path

- **WHEN** a scene sets `useGlobalReferences: false` and the project has selected two entities
- **THEN** generation attaches only the entities the scene itself casts, and none of the project's selections

#### Scenario: Editor and generation agree

- **WHEN** a surface shows the references a scene will generate with
- **THEN** the ids it lists are the ids the generation path resolves for that same scene

#### Scenario: Selection and cast overlap once

- **WHEN** an entity is both selected by the project and cast in the scene
- **THEN** it appears exactly once in the resolved references

### Requirement: Mentions resolve before generation

The system SHALL resolve project/material reference mentions into structured reference ids and
descriptions before image generation reaches a provider prompt. Provider-facing prompts SHALL NOT
contain editor mention syntax such as `@Reference Name`.

#### Scenario: Mention becomes reference description

- **WHEN** project visual material contains a mention of a selected reference
- **THEN** image intent carries that reference identity and description rather than raw `@mention` text

#### Scenario: Provider prompt contains no mentions

- **WHEN** an image prompt is compiled for any provider
- **THEN** the provider-facing prompt contains no unresolved `@mention` tokens

### Requirement: Story planning declares generated cast references

The system SHALL let a new video story plan declare the recurring cast references required by the planned story before asset generation. A planned cast reference SHALL include a stable plan-local key, role, label, description, POV visibility mode when applicable, and the story sections or shots where the reference appears.

Frame and draft MAY propose planned references as candidates. For a new canonical story plan, the validated output of story visual direction SHALL be the plan's final planned-reference set: direction MAY keep, drop, or add candidates, and every planned-shot binding key SHALL resolve to that set. A revision that re-runs direction SHALL replace the set with the new direction output rather than carrying the previous set forward.

The planner and direction SHALL use this for recurring visual subjects only. They SHALL NOT create cast references for one-off background extras, research citations, voice-only speakers, or abstract narrative motifs.

#### Scenario: POV prehistoric story declares a protagonist reference

- **WHEN** the user asks for `pov kamu hidup di jaman batu`
- **THEN** the story plan declares a planned protagonist reference for the POV subject
- **AND** the reference description focuses on visible first-person traits such as hands, clothing, tools, silhouette, or reflection rather than requiring a front-facing portrait in every shot

#### Scenario: Supporting recurring character is planned once

- **WHEN** a story plan uses the same elder or tribe member in several sections
- **THEN** the plan declares one planned cast reference for that character
- **AND** every section that features the character points to that planned reference key

#### Scenario: One-off extras do not become references

- **WHEN** a section mentions an unnamed background crowd that does not recur
- **THEN** the planner may describe the crowd in the visual prompt
- **AND** it SHALL NOT create a generated reference entity for that crowd

#### Scenario: Direction owns the final planned set

- **WHEN** the frame proposes a planned reference that direction binds to an existing roster entity instead
- **THEN** that candidate is absent from the approved planned-reference set
- **AND** no entity is materialized for it

#### Scenario: Revision replaces the planned set

- **WHEN** a revision re-runs direction and a previously planned subject no longer recurs
- **THEN** the revised plan's planned-reference set omits that subject
- **AND** no stale key from the prior revision survives into approval

### Requirement: Story approval preflights missing cast references

The approved snapshot of a directed story plan SHALL freeze the final planned-reference definitions — key, role, label, description, and POV visibility mode — together with the planned-shot direction, bindings, and direction-input fingerprint. Generation SHALL read planned-reference definitions only from the approved snapshot, never from the mutable draft plan.

Before `generate_story_assets` renders images from an approved story plan, the system SHALL materialize every planned reference in the approved set that is not yet materialized as a durable workspace `reference_entity`, attach it to the project roster, and record the resulting entity id in a materialization record keyed by approved revision and planned key. The materialization record SHALL live outside the approved snapshot and SHALL be the sole place a key resolves to an entity id. Materialization SHALL NOT rewrite approved bindings or definitions, and image input hashes SHALL use the logical binding (existing entity id or planned key), so materialization and retry do not stale approved imagery.

A retry SHALL reuse the recorded entity for each key rather than creating a duplicate. A planned reference with role `product` SHALL NOT be materialized automatically; direction reports it as a blocking reference requirement before approval. If a planned reference cannot be materialized, the story generation SHALL fail loudly with a retryable error before rendering sections that depend on it.

#### Scenario: Approval creates references before images

- **WHEN** a story plan has planned cast references and the user approves generation
- **THEN** the system creates or reuses the required reference entities first
- **AND** image generation receives entity ids resolved through the materialization record, not plan-local placeholder keys

#### Scenario: Generation reads the approved definitions

- **WHEN** the draft plan's planned references change after approval
- **THEN** materialization and generation for the approved revision still use the snapshot's definitions
- **AND** the draft change does not alter the approved run

#### Scenario: Retry reuses existing generated references

- **WHEN** a story generation run is retried after the cast preflight created references
- **THEN** the preflight reuses the same entity ids
- **AND** the workspace library and project roster do not gain duplicate generated references

#### Scenario: Materialization does not stale approved imagery

- **WHEN** a planned key is materialized to an entity id after some images were generated
- **THEN** the approved snapshot and image input hashes are unchanged
- **AND** previously generated images for those bindings remain reusable

#### Scenario: Products are never materialized

- **WHEN** an approved plan somehow carries a planned reference with role `product`
- **THEN** preflight refuses to materialize it
- **AND** dependent sections are not rendered

#### Scenario: Materialization failure blocks dependent image generation

- **WHEN** a planned cast reference cannot produce or resolve a canonical image
- **THEN** sections that depend on that reference are not rendered
- **AND** the run reports a retryable cast-reference error instead of silently generating text-only frames

### Requirement: Story sections bind generated references to images

The system SHALL resolve the effective references for each story image from the approved binding set of the measured beat that image illustrates, with planned keys resolved through the materialization record. It SHALL NOT use a positional planned-shot reference array (`visualRefIds[k]`) when planned-shot and measured-beat counts differ. Legacy plans without structured bindings SHALL keep their existing positional resolution.

Reference resolution for these generated story frames SHALL use the same effective-reference resolver as manual scene generation, including project selection, scene opt-out, dedupe, subject cap, provider ordering, and dropped-subject reporting. Provider capability SHALL change only prompt shape: the same ordered effective-reference set SHALL reach provider-aware compilation for native, text-only, and no-reference providers.

#### Scenario: Section uses protagonist reference

- **WHEN** a measured beat shows the POV protagonist's hands using a stone tool
- **THEN** the generated frame carries the protagonist entity id
- **AND** image generation attaches the protagonist reference image according to the existing ordered resolver

#### Scenario: Section combines protagonist and environment

- **WHEN** a measured beat binds both the protagonist and a recurring cave environment
- **THEN** both entity ids are resolved in deterministic order
- **AND** provider prompt binding derives from that same ordered reference list

#### Scenario: Adjacent beats use different directed subjects

- **WHEN** adjacent measured beats carry different approved entity bindings
- **THEN** each provider submission receives only its beat's effective references
- **AND** neither beat inherits the other's scene-specific subject

#### Scenario: Existing resolver owns caps and reporting

- **WHEN** a story beat references more subjects than the cap permits
- **THEN** the existing reference resolver chooses the rendered set and reports dropped entities
- **AND** the story asset generator does not apply a second local cap rule

#### Scenario: Provider capability changes prompt shape only

- **WHEN** the selected provider supports native, text-only, or no references
- **THEN** the same ordered effective-reference set reaches provider-aware compilation
- **AND** only the compiler changes attachment and wording behavior

### Requirement: Scene reference resolution never attaches all project references by default

When a project has multiple selected references for the same visual role, generation SHALL resolve scene references from explicit scene assignment, planner-emitted ids, continuity, or the project's designated primary reference. The system SHALL NOT attach every selected project reference to a scene merely because the project selected them.

If resolution cannot choose between multiple plausible references, generation SHALL report an ambiguous reference selection or require confirmation before provider calls. It SHALL NOT silently attach all candidates.

#### Scenario: One selected character is attached

- **WHEN** a project has Anna, Ben, and Maya selected
- **AND** a scene assignment names Anna only
- **THEN** image generation attaches Anna's references only
- **AND** Ben and Maya are not attached to that scene

#### Scenario: Ambiguous character choice blocks or asks

- **WHEN** a scene needs a woman character and both Anna and Maya match
- **THEN** generation reports the ambiguity or asks for assignment before image provider calls
- **AND** it does not attach both by default

#### Scenario: Group scene attaches selected group

- **WHEN** a scene assignment names Anna and Ben
- **THEN** image generation attaches Anna and Ben in deterministic order with binding text for each

### Requirement: Typed references preserve role-specific resolution behavior

The reference resolver SHALL preserve each selected reference's role and project-level `referenceUse`, then apply role-specific behavior. Character references SHALL bind identity. Style references SHALL guide look, mood, lighting, weather, palette, atmosphere, or visual grammar. Location references SHALL guide recurring place or set. Product references SHALL be user-selected and SHALL prefer exact preservation or direct placement when exact pixels matter. Prop references SHALL bind reusable objects.

#### Scenario: Character identity is bound

- **WHEN** a scene selects a Character reference
- **THEN** the reference map identifies that image as the selected character and instructs the provider not to blend it with other subjects

#### Scenario: Style does not consume subject cap

- **WHEN** a scene selects a Style reference and the subject cap is full
- **THEN** the Style reference remains available as style guidance and is not counted as a capped character subject

#### Scenario: Location guides setting

- **WHEN** a scene selects a Location reference
- **THEN** prompt compilation treats it as place or set context rather than as a person or product subject

#### Scenario: Product is not generated

- **WHEN** a scene needs a Product reference and none is selected
- **THEN** generation reports the missing user-selected Product reference
- **AND** it does not create a generated Product reference

### Requirement: Selection hints resolve missing scene references

When a scene has no explicit reference assignment for a role, the system SHALL use Visual Material `selectionHint` values to resolve candidate references before image provider calls. Hint matching SHALL be deterministic and SHALL compare normalized hints against scene title, visual prompt, narration, planned reference keys, and planner-provided labels.

Manual scene assignments SHALL win over hint resolution. Hint resolution SHALL NOT add unrelated project references to every scene by default.

#### Scenario: One character hint matches

- **WHEN** a project has a man character reference with `selectionHint: John, man, father`
- **AND** a woman character reference with `selectionHint: Anna, woman, mother`
- **AND** a scene says `Anna walks into the cafe`
- **THEN** hint resolution selects the woman character reference
- **AND** it does not select the man character reference

#### Scenario: Manual scene selection wins

- **WHEN** a scene already stores the man character reference id
- **AND** the scene text also matches the woman character hint
- **THEN** generation uses the stored man reference id
- **AND** it does not replace that id from hint matching

#### Scenario: Multiple matching characters are ambiguous

- **WHEN** two character references both match a scene through `selectionHint`
- **THEN** generation reports an ambiguous reference selection before provider calls
- **AND** it lists the matching candidate references for operator assignment

#### Scenario: No hint match means no guessed reference

- **WHEN** a scene has no explicit reference ids
- **AND** no Visual reference hint matches that scene
- **THEN** generation leaves the scene unassigned for that role
- **AND** it does not attach all project references as a fallback

### Requirement: Selection hints preserve role-specific caps

Hint-selected references SHALL pass through the same resolver as manually selected references. Subject caps SHALL apply to subject roles only, and non-subject roles such as style and location SHALL remain available according to existing role behavior.

#### Scenario: Style hint does not consume character quota

- **WHEN** a scene matches two character hints and one style hint
- **THEN** the style reference does not consume the character subject cap
- **AND** character cap reporting names only capped character subjects

### Requirement: Existing roster references precede new story references

Story visual direction SHALL select a compatible project-roster entity before
declaring a new planned recurring reference. Only entities attached to the project
roster SHALL be candidates; direction SHALL NOT silently select or attach an entity
from the wider workspace Reference Library.

A declared planned reference whose normalized label and role exactly match a roster
entity SHALL collapse deterministically to one roster entity id, with the tiebreak
defined by story visual-direction validation when the roster holds duplicates. This exact match is the
only automatic collapse; semantically similar but differently labeled subjects are
left to the model's roster-first instruction and to operator review.

Products SHALL require an operator-supplied roster entity.

#### Scenario: Compatible roster subject is reused

- **WHEN** the project roster already contains the recurring character needed by a story
- **THEN** direction binds that existing entity id
- **AND** generation does not create another reference entity for the character

#### Scenario: Unattached library item is not selected

- **WHEN** the workspace library contains a compatible entity that is not attached to the project roster
- **THEN** story direction does not bind or attach that entity automatically
- **AND** the existing project-roster boundary remains intact

#### Scenario: Missing product blocks approval

- **WHEN** a planned shot requires a product and no operator-supplied product entity is on the roster
- **THEN** direction reports a blocking reference requirement naming the product
- **AND** the plan cannot be approved until the operator attaches a product entity
