# story-beat-visual-intent Specification

## Purpose

What one measured narration beat shows, as fields rather than prose: its cast
drawn from the Story Bible's closed list, the visual moment, the action, the end
state the next beat continues from, and the camera. Plus the deterministic
compilation of that intent into provider-facing image intent, and the counted
invariants that gate a section before any image is generated.

The beat schema deliberately carries no style fields. A model authoring a beat
cannot restate the story's medium, lighting, palette or negatives because it has
nowhere to put them.

## Requirements

### Requirement: Measured beat authoring obeys approved sequence direction

When an approved semantic beat carries sequence direction, measured Beat Visual Intent authoring SHALL receive its purpose, presentation, visual concept, novelty key, native-text ownership, structured motion-graphic decision, and ordered planned-shot direction with reference bindings. Authoring MAY refine camera and composition for measured timing, and MAY distribute, split, or merge approved planned-shot intent across the measured beats, but SHALL NOT change primary presentation, copy native overlay text into required image pixels, or substitute another motif.

Each authored beat SHALL record its own ordered reference bindings, chosen only from the approved entity ids and planned-reference keys of its section. Beat authoring SHALL NOT introduce a new subject reference, substitute another roster entity, attach every project reference, or change `referenceUse`.

Sequence direction, including reference bindings, SHALL participate in image input hashes so changed direction marks prior imagery stale.

#### Scenario: Direction constrains measured visuals

- **WHEN** measured audio expands one directed semantic beat into several visual beats
- **THEN** every measured beat preserves the approved purpose and presentation
- **AND** camera refinement does not replace the approved visual concept

#### Scenario: More measured beats than planned shots

- **WHEN** two approved planned shots produce four measured visual beats
- **THEN** beat authoring distributes the approved visual intent and bindings across four beats
- **AND** every resulting binding comes from the approved section set

#### Scenario: Fewer measured beats than planned shots

- **WHEN** four approved planned shots produce two measured visual beats
- **THEN** beat authoring merges their presentation while retaining required recurring-subject coverage
- **AND** it does not fail solely because planned and measured counts differ

#### Scenario: Native text is not image text

- **WHEN** approved direction owns a label as native on-screen text
- **THEN** beat image intent excludes that label from must-include pixels
- **AND** timeline text materialization remains responsible for readability

#### Scenario: Direction edit invalidates image reuse

- **WHEN** editorial purpose, presentation, visual concept, novelty key, native text, or a reference binding changes
- **THEN** image input hash changes
- **AND** imagery generated from prior direction is stale

### Requirement: Beat authoring returns structured visual intent

Per-beat visual authoring SHALL return, for each measured narration beat, a
structured Beat Visual Intent carrying the beat index, the subject ids appearing in
the beat, an optional location id, the visual moment, the action, the end state, the
shot type, the camera angle, the framing, must-include and must-avoid details, and a
novelty key.

Authoring SHALL NOT return a single prose string as the provider-facing prompt.

Subject ids and the location id SHALL be drawn from the Story Bible's closed id
lists. Authoring SHALL NOT introduce a subject or location the bible does not
declare.

#### Scenario: Structured result per beat

- **WHEN** visuals are authored for a section's measured beats
- **THEN** each beat receives a structured intent with subject ids, visual moment, action, end state, and camera fields
- **AND** no beat's provider prompt is taken from a single authored prose string

#### Scenario: Cast comes from a closed list

- **WHEN** beat authoring names the subjects appearing in a beat
- **THEN** every subject id it returns exists in the Story Bible
- **AND** an id outside that list is a violation, not a new subject

### Requirement: Beat authoring receives continuity from the preceding beat

Authoring for a beat SHALL receive the preceding beat's end state, and the Story
Bible's subjects and locations as closed id lists, in addition to the beat's exact
narration text, the section's approved planned shots, the locked visual constraints,
and the project's Visual and Rules direction.

For the first beat of a section, the preceding end state SHALL be the last beat of
the preceding section where one exists, and absent otherwise.

#### Scenario: Continuity is supplied

- **WHEN** a beat after the first is authored
- **THEN** authoring receives the preceding beat's end state
- **AND** the compiled result can continue from what that beat showed

#### Scenario: Section boundary carries continuity

- **WHEN** the first beat of a section other than the first is authored
- **THEN** authoring receives the end state of the last beat of the preceding section

### Requirement: Planned POV shot grammar populates composition

Where a section carries planned POV shot grammar — camera role, location, body
action, prop or detail focus, emotional pressure, novelty key — that grammar SHALL
reach the compiled image intent's composition fields.

The grammar SHALL NOT be flattened into prose and then discarded before
compilation.

#### Scenario: POV grammar reaches composition

- **WHEN** a section's beats carry planned POV shot grammar
- **THEN** the compiled intent's composition carries the shot type, camera angle, and framing derived from that grammar
- **AND** the compiled prompt does not fall back to a default medium shot

#### Scenario: Grammar is not discarded

- **WHEN** a story plan records structured POV shot grammar
- **THEN** no stage converts it to prose as its only representation before compilation

### Requirement: Provider prompt is compiled deterministically from intent

The provider-facing story image prompt SHALL be produced by a deterministic,
model-free function mapping the Story Bible and a Beat Visual Intent into image
prompt intent, which is then compiled by the existing image prompt compiler.

Visual and Rules material channels SHALL be compiled into the intent's
must-include and must-avoid constraints rather than appended as sentences. Rules
SHALL take precedence over Visual guidance where the two conflict, preserving the
existing layer-order contract as field precedence.

Story beat compilation SHALL NOT concatenate the authored visual, the material
layers, the timeline guidance, and the style summary into a single prose field.

#### Scenario: Compilation is deterministic

- **WHEN** the same Story Bible and Beat Visual Intent are compiled twice
- **THEN** the resulting provider prompt is identical
- **AND** no model call was made during compilation

#### Scenario: Materials compile as constraints

- **WHEN** a project's Visual and Rules materials apply to a story beat
- **THEN** their content appears in the compiled intent's must-include and must-avoid constraints
- **AND** not as appended sentences inside the scene visual moment

#### Scenario: Rules win over visual guidance

- **WHEN** a Rules material contradicts a Visual material for the same beat
- **THEN** the compiled constraints reflect the Rules material

#### Scenario: Only the scene fields vary between adjacent beats

- **WHEN** two adjacent beats of one section are compiled
- **THEN** their prompts differ only in subject, scene, composition, and must-include content

### Requirement: Story image generation requires structured beat intent

Every measured story beat submitted for image generation SHALL carry structured Beat Visual Intent. If a measured beat lacks that intent, the section SHALL fail with a specific retryable error before any image provider call. The system SHALL NOT reconstruct provider-facing intent from the beat's prose visual prompt.

#### Scenario: Missing intent blocks generation

- **WHEN** an approved section has a measured visual beat with prose but no structured intent
- **THEN** no image provider call occurs for that section
- **AND** the section reports which beat needs visual re-authoring

#### Scenario: Structured beat generates

- **WHEN** every measured beat has structured intent and coverage checks pass
- **THEN** each image input is compiled from that intent and the Story Bible

### Requirement: Measured beats are the sole authority on a section's visual count

The number of visuals a section produces SHALL be the number of beats cut from its
measured narration audio at the timeline template's `maxVisualBeatSec`. Planner-approved
shots SHALL be treated as content intent — what the operator approved the section to
show — and SHALL NOT determine, constrain, or gate that count.

A section SHALL NOT be failed on the grounds that it carries more approved planned
shots than measured beats. Beat authoring SHALL merge the approved intent across the
beats the audio produced.

#### Scenario: More approved shots than measured beats generates

- **WHEN** a section carries four approved planned shots and its measured audio yields three beats
- **THEN** three visuals are authored covering the approved intent
- **AND** the section is not failed on the count difference

#### Scenario: Fewer approved shots than measured beats generates

- **WHEN** a section carries one approved planned shot and its measured audio yields four beats
- **THEN** four visuals are authored
- **AND** the section is not failed on the count difference

### Requirement: Section beats are gated by counted coverage invariants

Before any image provider submission for a section, the system SHALL check these
invariants over that section's Beat Visual Intents. Each SHALL be a count or a set
comparison; none SHALL use a tunable similarity threshold.

1. Every beat's subject ids SHALL be a subset of the Story Bible's subject ids.
2. Adjacent beats SHALL differ in at least one of visual moment, shot type, camera
   angle, location id, or subject ids.
3. Approved intent SHALL survive into the beats at subject granularity. Where the
   section carries structured planned-shot bindings, every binding in the section's
   approved set SHALL appear in the union of the section's beat bindings. Where it
   does not, the legacy alias test applies: where a Story Bible subject's alias
   appears in a planned shot's prose, that subject's id SHALL appear in the union of
   the section's beat subject ids. Neither form can detect a dropped shot that binds
   or names no subject, or one that differs from a covered shot only in camera
   treatment.
4. Where a Story Bible subject's alias appears in a beat's narration text, that
   subject's id SHALL appear in that beat's subject ids.
5. Every beat's reference bindings SHALL be a subset of the section's approved
   binding set.
6. After resolving every binding in the section's approved set — existing entity ids
   directly, planned keys through the materialization record — every resulting
   entity id SHALL still be attached to the project roster.

Invariants 1, 3, and 4 SHALL be skipped for a section with no Story Bible, because
there is no closed list to check membership against. Invariant 5 SHALL be skipped
for a section without structured bindings.

A violation of invariants 1–5 SHALL retry authoring for the section once, and on
continued failure SHALL mark the section failed and retryable with an error naming
the violated invariant and the beat positions involved. A violation of invariant 6
SHALL NOT be retried: authoring cannot fix it, so the section SHALL fail with an
error naming the detached entity and stating that the plan must be revised. The
system SHALL NOT satisfy a violated invariant by substituting another beat's intent
or emitting a placeholder.

#### Scenario: Invented cast is rejected

- **WHEN** a beat's subject ids include an id absent from the Story Bible
- **THEN** authoring is retried
- **AND** on continued failure the section is marked failed and retryable naming the invariant

#### Scenario: Beat author invents a reference

- **WHEN** an authored beat contains an entity id or planned key absent from the section's approved binding set
- **THEN** no image provider call is made for the section
- **AND** authoring retries once before the section becomes failed and retryable

#### Scenario: Adjacent beats that would render the same picture are rejected

- **WHEN** two adjacent beats match on visual moment, shot type, camera angle, location, and subject ids
- **THEN** no provider call is made for those beats
- **AND** the section records a retryable error naming the beat positions

#### Scenario: An approved binding reaches no beat

- **WHEN** a section's approved binding set contains an entity id that appears in no beat's bindings
- **THEN** the coverage check reports that binding as uncovered approved intent
- **AND** authoring is retried, and on continued failure the section is failed and retryable

#### Scenario: An approved shot's subject reaches no beat

- **WHEN** a section without structured bindings has a planned shot whose prose names a Story Bible subject whose id appears in no beat of the section
- **THEN** the coverage check reports that subject as uncovered approved intent
- **AND** authoring is retried, and on continued failure the section is failed and retryable

#### Scenario: Approved intent spread across fewer beats passes

- **WHEN** a section's approved planned shots name two Story Bible subjects and both ids appear across the section's beats
- **THEN** the coverage check passes regardless of how many planned shots or beats there are

#### Scenario: A planned shot naming no bible subject is not checked

- **WHEN** a planned shot's prose names no Story Bible subject alias and binds no reference
- **THEN** that shot contributes no coverage requirement
- **AND** the section is not failed on its account

#### Scenario: Narration names a subject the beat omits

- **WHEN** a Story Bible subject's alias appears in a beat's narration text and that subject's id is absent from the beat's subject ids
- **THEN** the coverage check reports the mismatch
- **AND** the section is failed and retryable

#### Scenario: Approved entity detached after approval

- **WHEN** an entity bound by the approved plan is detached from the project roster before its section generates
- **THEN** no provider call is made for the section
- **AND** the section fails without an authoring retry, naming the entity and asking for a plan revision

#### Scenario: Materialized planned reference detached after approval

- **WHEN** a planned key materializes to an entity that is then detached from the project roster before its section generates
- **THEN** the resolved-roster check fails for that key
- **AND** the section fails without an authoring retry, naming the key and its entity

#### Scenario: Authoring is retried once before failing

- **WHEN** a coverage invariant is violated on the first authoring pass
- **THEN** authoring runs a second time for that section before any section status is set
- **AND** the section is marked failed and retryable only if the second pass also violates an invariant

#### Scenario: No silent substitution on failure

- **WHEN** a coverage invariant fails after retry
- **THEN** the pipeline does not reuse another beat's intent or emit a placeholder

### Requirement: The story visual beat scan script is retired

The offline script that measures beats per planned shot and adjacent visual reuse
across persisted storyboards SHALL be removed once its measurements run as
pre-submission invariants.

#### Scenario: Measurement runs live

- **WHEN** a section is generated
- **THEN** plan-shot coverage and adjacent beat difference are checked before provider submission
- **AND** no offline script is required to observe them
