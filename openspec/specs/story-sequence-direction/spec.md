# story-sequence-direction Specification

## Purpose

Define asset-free editorial direction over complete ordered story drafts before approval and generation.

## Requirements

### Requirement: Story planning directs the complete sequence before approval

`plan_story` SHALL run one asset-free sequence-direction stage after all draft slots are filled and before the Story Plan is persisted for approval. The stage SHALL receive the complete ordered draft, stable semantic beat ids, planned shots, frame and draft planned-reference candidates, the project roster as a labeled closed list of stable entity ids, roles, labels, and descriptions, routed Visual and Rules material, and applicable timeline-template presentation constraints. It SHALL return one editorial decision for every stable semantic beat.

The Story Bible is authored after direction, its reference entries derive from validated direction, and it SHALL NOT be a direction input. Operator-required references recorded on a beat SHALL be a direction input.

The stage SHALL remain internal to `plan_story`. The system SHALL NOT expose a second public story-planning tool or add another approval artifact.

#### Scenario: New story is directed before review

- **WHEN** a new story draft completes
- **THEN** sequence direction evaluates all ordered beats together before the plan reaches approval
- **AND** no image, speech, music, or SFX asset is generated

#### Scenario: Public planner list remains singular

- **WHEN** callable video tools are listed
- **THEN** `plan_story` remains the only public story planner
- **AND** no `direct_story` tool is exposed

#### Scenario: Direction input is asset-free and project-scoped

- **WHEN** direction input is assembled
- **THEN** it contains only roster entities attached to the project, without media URLs
- **AND** no unattached workspace-library entity appears in it

### Requirement: Editorial decisions use existing story and presentation ownership

Each directed semantic beat SHALL record its stable beat id, editorial purpose, existing presentation category, visual concept, novelty key, optional native on-screen text, and nullable SFX cue. The containing section's existing emotion SHALL remain music intent. The presentation categories SHALL be `narrative`, `headline`, `explainer` and `transition`. A beat SHALL NOT carry a motion-graphic decision.

The beat's visual concept and novelty key SHALL remain the beat-level editorial treatment used by adjacency validation. Each planned-shot direction SHALL depict that concept concretely; it SHALL NOT introduce a second, competing treatment for the beat. Visual distinctness between individual images SHALL remain enforced on measured beats.

`null` SFX SHALL mean intentional silence. Direction SHALL NOT select concrete media URLs or introduce another music or rendering vocabulary.

A stored beat whose presentation is `infographic` SHALL read as `narrative`, and a stored motion-graphic decision SHALL be dropped on read.

#### Scenario: Directed beat is reviewable

- **WHEN** sequence direction succeeds
- **THEN** every canonical beat carries purpose, presentation, visual concept, novelty key, and an explicit nullable SFX cue
- **AND** optional native text remains a structured field rather than image-prompt prose

#### Scenario: Silence is valid

- **WHEN** a beat needs no editorial sound
- **THEN** its SFX cue is `null`
- **AND** generation does not replace silence with a generic cue

#### Scenario: Shot intent refines the beat concept

- **WHEN** a directed beat has two planned shots
- **THEN** each shot's visual intent depicts the beat's visual concept
- **AND** adjacency validation compares beats by presentation and novelty key, not shots

#### Scenario: A stored infographic beat is read

- **WHEN** a plan stored before infographics were removed has a beat with the `infographic` presentation and a stat motion graphic
- **THEN** the beat reads with the `narrative` presentation and no motion-graphic decision
- **AND** the plan validates without an infographic error

### Requirement: Sequence validation rejects structural engagement failures

The system SHALL validate direction using exact structural rules without semantic similarity scores or tunable taste thresholds. Every canonical beat SHALL have one decision. Adjacent beats SHALL NOT repeat the same normalized presentation and novelty key. Identical non-null SFX cues SHALL NOT occur on adjacent beats.

Native on-screen text SHALL remain separate from the generated-image visual concept. Direction SHALL NOT require an image model to reproduce readable text.

#### Scenario: Repeated adjacent treatment is rejected

- **WHEN** adjacent beats have the same normalized presentation and novelty key
- **THEN** validation identifies both stable beat ids
- **AND** the plan is not approval-ready

#### Scenario: Repeated generic SFX is rejected

- **WHEN** adjacent beats carry the same non-null SFX cue
- **THEN** validation rejects the sequence
- **AND** it does not replace either cue with another automatic sound

#### Scenario: Native text stays out of image concept

- **WHEN** a beat presents a factual label using native on-screen text
- **THEN** that text remains in the native text field
- **AND** generated-image instructions do not require reproducing it as pixels

### Requirement: Direction failure is visible and retryable before spend

Sequence direction SHALL retry once against the same draft when validation fails for a correctable model error. If it still fails validation, the Story Plan SHALL remain reviewable with a `needsDirection` state and errors naming affected beat ids and, for reference errors, planned-shot indexes. New canonical plans in that state SHALL NOT be approved or passed to asset generation.

`needsDirection` SHALL be a recomputed state, not a latch. Re-direction before approval SHALL run whenever the plan is in a needs-direction state or its direction inputs have drifted, and SHALL NOT be skipped merely because the current direction inputs match the recorded fingerprint. A plan whose staling edit has since been undone SHALL therefore become approvable again without a full re-plan. A refused approval SHALL NOT overwrite the plan's recorded direction errors with the refusal message, so the original cause stays readable.

A blocking reference requirement that only the operator can resolve — a required product with no roster entity — SHALL be reported as operator action rather than retried, and SHALL NOT trigger re-direction on every approval attempt. After the operator changes the project roster, direction SHALL re-run before the plan is next presented for approval.

Persisted legacy plans without direction SHALL remain readable and generatable without migration.

#### Scenario: Retry repairs invalid direction

- **WHEN** first direction result fails validation
- **THEN** direction retries once against the unchanged draft
- **AND** a valid retry becomes reviewable without another user action

#### Scenario: Continued failure spends no media credits

- **WHEN** direction remains invalid after retry
- **THEN** plan reports `needsDirection` and specific errors
- **AND** approval and asset generation are refused before provider spend

#### Scenario: Operator-only blocker is not retried

- **WHEN** direction reports a required product with no roster entity
- **THEN** the plan reports `needsDirection` naming the missing product as operator action
- **AND** no correction retry is spent on it

#### Scenario: Undone edit does not lock approval

- **WHEN** a storyboard edit stales direction and the operator then undoes that edit
- **THEN** re-direction runs before the next approval attempt
- **AND** the plan becomes approvable without re-planning the story

#### Scenario: Refusal preserves the cause

- **WHEN** an approval is refused because direction is stale or incomplete
- **THEN** the plan's recorded direction errors still name the original cause
- **AND** the refusal message does not replace them

#### Scenario: Legacy plan remains compatible

- **WHEN** a persisted plan predates sequence direction
- **THEN** it remains readable and generatable through legacy behavior
- **AND** read alone does not backfill invented direction

### Requirement: Directed planned shots carry exact reference decisions

Each directed semantic beat SHALL carry ordered direction for its planned shots.
Each planned-shot direction SHALL be addressed by planned-shot index within the
stable semantic beat and SHALL record its concrete visual intent, continuity or
novelty role, ordered reference bindings, and an operator-facing rationale of at
most 160 characters.

Each reference binding SHALL name exactly one existing project-roster entity id or
one planned-reference key from the plan's final planned-reference set. That target is
the binding's logical reference identity (`entity:<id>` or `planned:<key>`), and the
same identity SHALL be used wherever the subject recurs. A binding SHALL NOT store a
copied entity record, image URL, provider image index, or shot-level `referenceUse`
override.

Direction SHALL also return one entry per distinct bound identity recording the
aliases by which the narration names that subject. These aliases are the only
source the Story Bible uses for a reference-linked entry's aliases.

#### Scenario: Existing roster reference is selected

- **WHEN** a planned shot needs a subject represented by a compatible project-roster entity
- **THEN** direction binds that entity's stable id to the planned shot
- **AND** records a concise reason visible during Story Plan review

#### Scenario: Missing recurring subject becomes a planned reference

- **WHEN** a recurring subject has no compatible entity in the project roster
- **THEN** direction declares one planned reference and binds its plan-local key
- **AND** the planned reference records the recurring subject's role, label, stable visible traits, and POV visibility mode when applicable

#### Scenario: Recurring subject keeps one identity

- **WHEN** the same elder appears in shots across three sections
- **THEN** every binding for the elder names the same logical identity
- **AND** direction returns one alias entry for that identity

#### Scenario: One-off detail stays prompt content

- **WHEN** a planned shot contains a one-off background extra, abstract motif, or incidental object
- **THEN** direction MAY include it in visual intent
- **AND** SHALL NOT create a reference binding for it

### Requirement: Visual reference direction is validated before approval

For new canonical plans, visual direction SHALL validate exact structural and
referential invariants before approval. Every semantic beat SHALL have direction
for each of its planned shots and no extra entries. Every planned-shot binding SHALL
resolve to the supplied project roster or the plan's final planned-reference set.
Unknown entity ids, unknown planned keys, duplicate bindings within a shot, a blank
or over-length rationale, a planned reference with role `product`, a bound identity
without an alias entry, an operator-required reference not bound in any planned
shot of its beat, and a planned shot whose bindings exceed the existing reference
caps SHALL make direction invalid. The caps are the existing shared constants: at
most `DEFAULT_CAST_SUBJECT_CAP` bindings with a subject role, and at most
`MAX_REFERENCE_IMAGES` bindings in total, per planned shot. Direction SHALL NOT bind
a prop that the shot does not physically show; abstract motifs and diagrams remain
visual intent.

A declared planned reference whose normalized label and role exactly match a
project-roster entity SHALL collapse to that entity id before validation. When
several roster entities share that normalized label and role, the collapse SHALL
choose deterministically: the entity marked primary on the project roster, then the
most recently updated, then the lowest id.

#### Scenario: Off-roster entity is rejected

- **WHEN** direction emits an entity id absent from the supplied project roster
- **THEN** validation names the semantic beat and planned-shot index
- **AND** the plan is not approval-ready

#### Scenario: Existing exact match replaces planned duplicate

- **WHEN** direction proposes a planned reference whose normalized label and role match a roster entity
- **THEN** the binding uses the existing entity id
- **AND** no duplicate reference is materialized

#### Scenario: Over-cap shot is rejected

- **WHEN** a planned shot binds four subject-role entities, or five references in total
- **THEN** validation names the beat and planned-shot index and the exceeded cap
- **AND** the plan is not approval-ready, so review never shows a reference the resolver would drop

#### Scenario: Duplicate roster labels collapse deterministically

- **WHEN** a proposed planned reference matches two roster entities with the same normalized label and role
- **THEN** the collapse binds the primary entity, or else the most recently updated one
- **AND** repeated direction runs over the same inputs choose the same entity

#### Scenario: Missing or extra shot direction is rejected

- **WHEN** direction omits a planned shot or returns an index the beat does not have
- **THEN** validation names the beat and index
- **AND** the plan is not approval-ready

#### Scenario: Missing product cannot be fabricated

- **WHEN** a planned shot requires a product and no operator-supplied product entity exists
- **THEN** direction reports the missing product reference as a blocking review item
- **AND** no product reference image is generated automatically
