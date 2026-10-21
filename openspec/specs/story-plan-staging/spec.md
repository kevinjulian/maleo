# Story Plan Staging Specification

## Purpose

Define story planning as ordered stages — an optional research pass, a cheap frame call, a skeleton derived by computation, a draft that fills the skeleton's slots, and whole-sequence editorial direction before approval — and what each stage does when it fails: degrade to defaults, retry one slot, or fail visibly, but never fabricate narration about another subject.

## Requirements

### Requirement: Story planning runs as staged steps

Story planning SHALL require pre-research clarification or an explicit recorded bypass before
sequencing its authored **frame**, **skeleton**, **draft**, and **sequence-direction** stages with optional research and
post-research clarification: pre-research clarification, frame, research when required, post-research
clarification when required, skeleton, draft, then sequence direction.

The **pre-research clarification** checkpoint SHALL complete before frame begins. Its accepted answers
SHALL be supplied to frame and research as structured planning decisions without replacing the original
request.

The **frame** stage SHALL be a model call that returns the plan's framing only — plan kind, arc,
narration language, the engagement spine, planned references, and the grounding decision — and SHALL NOT
produce narration.

The **research** stage SHALL run between the frame and the skeleton when grounding is called for. It SHALL
NOT require approval and SHALL NOT generate assets. It SHALL be addressable as its own stage, so it can be
re-run without re-running the frame.

The **post-research clarification** checkpoint SHALL run after completed research only when evidence
analysis finds a material editorial decision. It SHALL suspend before skeleton, persist prepared
planning state and research identity, and supply accepted answers to skeleton and draft. When analysis
emits no questions or fails, planning SHALL continue without suspension.

The **skeleton** stage SHALL NOT call a model. It SHALL derive section slots by computation from
the selected arc, the resolved section count, the resolved writer style, and applicable clarification
decisions, producing for each slot a chapter function, an obligation, a default emotion, and a word
budget.

The **draft** stage SHALL be a model call that fills narration, shots, and per-section editorial
inputs into the slots the skeleton produced. It SHALL NOT invent the plan's structure, which is
already fixed by the skeleton.

The **sequence-direction** stage SHALL be one model call over the complete ordered draft. It SHALL
assign reviewable editorial decisions without changing section or beat identity, narration,
citations, or story structure, and SHALL generate no assets.

#### Scenario: Pre-research clarification precedes frame

- **WHEN** a new story build does not carry an explicit clarification bypass
- **THEN** its pre-research batch resolves before frame begins
- **AND** accepted answers are available to frame and its grounding decision

#### Scenario: Explicit bypass enters frame directly

- **WHEN** the user explicitly skips questions or requests one-shot generation
- **THEN** the bypass is recorded
- **AND** frame begins without clarification suspension

#### Scenario: Frame produces no narration

- **WHEN** the frame stage completes
- **THEN** it has produced plan kind, arc, language, engagement, planned references, and a grounding decision
- **AND** it has produced no narration text

#### Scenario: Skeleton calls no model

- **WHEN** the skeleton stage runs
- **THEN** section slots are derived by computation
- **AND** no model call is made

#### Scenario: Draft fills existing slots

- **WHEN** the draft stage completes
- **THEN** each drafted section occupies a slot the skeleton produced
- **AND** the number and order of sections match the skeleton

#### Scenario: Research runs before the skeleton

- **WHEN** the frame's grounding decision calls for grounding
- **THEN** research runs after frame and before any post-research clarification, skeleton, draft, or sequence direction
- **AND** drafted sections can cite retrieved sources

#### Scenario: Research costs no approval

- **WHEN** the research stage runs
- **THEN** the run is not suspended for approval
- **AND** no asset-generating provider call is made

#### Scenario: Post-research clarification resumes held stages

- **WHEN** completed research exposes a material editorial choice
- **THEN** planning suspends before skeleton with prepared state persisted
- **AND** accepted answer resumes at skeleton without re-running frame or research

#### Scenario: Research exposes no material choice

- **WHEN** evidence analysis emits no valid question
- **THEN** planning continues directly to skeleton
- **AND** no additional user suspension occurs before drafting

#### Scenario: Direction evaluates completed draft

- **WHEN** every draft slot has completed or visibly degraded
- **THEN** sequence direction evaluates the complete ordered draft
- **AND** the plan is not persisted for approval until direction succeeds or reports `needsDirection`

### Requirement: A failed stage degrades without fabricating content

When the frame stage fails, the system SHALL retry it once. The retry SHALL use a shorter timeout
than narration drafting requires, because the frame returns a small framing object rather than a
script.

If the frame still fails, the system SHALL fall back to the requested plan kind's default arc and
to the job's configured narration language. The system SHALL NOT infer narration language by
matching the brief against a word list, because topic words are not language markers.

If no usable frame can be produced, planning SHALL fail visibly with the underlying error. The
system SHALL NOT emit narration about a topic other than the brief's under any failure condition.

When the draft stage fails for a slot, the system SHALL retry that slot against the existing
skeleton. It SHALL NOT re-derive the frame or the skeleton, and it SHALL NOT restate the full plan
schema in order to retry.

#### Scenario: Frame retries cheaply

- **WHEN** the frame stage fails
- **THEN** it is retried once with a timeout shorter than narration drafting's

#### Scenario: Frame failure falls back to defaults

- **WHEN** the frame stage fails after its retry
- **THEN** the arc is the requested plan kind's default
- **AND** the narration language is the job's configured language

#### Scenario: Language is never guessed from topic words

- **WHEN** a narration language must be resolved without a frame
- **THEN** it comes from job configuration
- **AND** it is not derived by matching the brief against a word list

#### Scenario: Unplannable brief fails visibly

- **WHEN** no usable frame can be produced
- **THEN** planning fails and reports the underlying error
- **AND** no narration is emitted

#### Scenario: No narration is fabricated about another topic

- **WHEN** any planning stage fails
- **THEN** the system emits no narration whose subject differs from the brief

#### Scenario: Draft retries one slot

- **WHEN** the draft stage fails for a single slot
- **THEN** that slot is retried against the existing skeleton
- **AND** the frame and skeleton are not recomputed

### Requirement: A degraded plan is marked, not silently shipped

A plan produced with a degraded frame SHALL be marked so an operator can see that its framing came
from defaults rather than from the brief. A slot whose draft never succeeded SHALL remain in the
plan with empty narration and a status indicating it needs drafting, rather than being dropped or
filled with substitute text.

#### Scenario: Degraded frame is visible

- **WHEN** a plan is produced after a frame fallback
- **THEN** the plan reports that its framing was defaulted

#### Scenario: Undrafted slot is kept and marked

- **WHEN** a slot's draft fails after retry
- **THEN** the slot remains in the plan with empty narration
- **AND** it is marked as needing drafting rather than dropped or substituted

### Requirement: Structure and framing survive as reviewable plan state

The selected arc, each slot's chapter function and obligation, the engagement spine, the grounding
decision, and the identity of the research bundle the plan was drafted against SHALL be persisted with the
plan, so a plan rehydrated in a later step carries the structure and the evidence it was drafted against
rather than only its narration.

#### Scenario: Arc survives rehydration

- **WHEN** a persisted plan is reloaded in a later generation step
- **THEN** it carries its arc, each section's chapter function and obligation, and its engagement spine

#### Scenario: Research identity survives rehydration

- **WHEN** a persisted plan that was grounded is reloaded in a later generation step
- **THEN** it carries the identity of the research bundle it was drafted against
- **AND** the bundle is resolvable without re-deriving it from the brief text

### Requirement: The frame decides grounding, never a keyword match

Whether a plan needs source grounding, and the questions research should answer, SHALL come from the frame
stage's result or from an explicit operator or profile setting. The system SHALL NOT decide grounding by
matching the brief against a word list, and SHALL NOT derive research questions from a fixed template
independent of the subject.

The frame SHALL NOT require an additional model call to produce the grounding decision, because it is
already a model call over the brief.

#### Scenario: Grounding decision comes from the frame

- **WHEN** the frame stage completes
- **THEN** the plan carries whether grounding is needed and the questions to research
- **AND** that decision was produced by the same frame call, not a second model call

#### Scenario: No keyword heuristic decides grounding

- **WHEN** a brief needs grounding but contains none of the words a keyword heuristic would match
- **THEN** grounding is still performed if the frame calls for it

#### Scenario: Research questions fit the subject

- **WHEN** research runs for a non-historical subject
- **THEN** the questions asked are the frame's questions for that subject
- **AND** they are not a fixed template phrased for historical topics

#### Scenario: Operator setting overrides the frame

- **WHEN** the operator or the format profile requires grounding
- **THEN** research runs regardless of what the frame decided

### Requirement: Unavailable research degrades visibly and never blocks

When grounding is called for and research cannot be performed or returns no usable sources, planning SHALL
continue and the plan SHALL be marked as ungrounded rather than failing. The system SHALL NOT present an
ungrounded plan as verified, and SHALL NOT fabricate citations.

The ungrounded state SHALL be reported where the operator decides whether to spend assets.

#### Scenario: Research provider unreachable

- **WHEN** grounding is called for and the research provider cannot be reached
- **THEN** planning continues
- **AND** the plan is marked as ungrounded with the underlying reason

#### Scenario: No usable sources found

- **WHEN** research completes and retrieves no citeable source
- **THEN** the plan is marked as ungrounded
- **AND** no citation is attached to any section

#### Scenario: Ungrounded state is not silent

- **WHEN** an ungrounded plan reaches the approval gate
- **THEN** the gate reports that grounding was requested and not achieved

### Requirement: Planning stages preserve stable storyboard identity

Skeleton SHALL assign stable section and semantic-beat ids before drafting fills authored fields. Draft retry SHALL reuse slot ids. Redraft against held skeleton SHALL preserve surviving ids and locked beat contents; only new slots receive new ids.

#### Scenario: Draft fills identified skeleton

- **WHEN** draft fills computed skeleton
- **THEN** every section and beat retains slot identity

#### Scenario: Slot retry

- **WHEN** one draft slot retries
- **THEN** retry uses same section and beat ids

#### Scenario: Redraft preserves lock

- **WHEN** redraft runs with locked beat
- **THEN** locked beat identity and authored contents remain unchanged

### Requirement: Sequence direction owns the final pre-approval visual contract

For a new canonical story plan, the sequence-direction stage SHALL be the final
authority on what each planned shot shows, which project references it uses, and
which planned references the plan declares. Frame and draft output MAY propose
recurring subjects, visual prompts, and reference keys, but those values SHALL be
inputs to direction rather than an independent generation authority. Frame planned
references SHALL be candidates only.

Style and Story Bible authoring SHALL run after sequence direction. The Bible model
call SHALL author style constants and descriptive entries whether or not direction
validated. Reference-linked Bible entries SHALL exist only while direction is valid:
they are derived deterministically from validated direction, are absent while the
plan reports `needsDirection` or stale direction, and are derived when direction
later validates, without another Bible model call. Sequence direction SHALL produce
no media assets and SHALL remain internal to `plan_story`.

#### Scenario: Draft suggestions are finalized by direction

- **WHEN** draft completes with visual prompts and proposed reference keys
- **THEN** sequence direction evaluates them against the complete ordered story and project roster
- **AND** only the resulting directed values become approval-ready visual decisions

#### Scenario: Bible follows valid direction

- **WHEN** direction validates
- **THEN** the Bible carries descriptive entries plus one reference entry per bound identity
- **AND** direction itself does not receive or wait for a Story Bible

#### Scenario: Bible on failed direction is descriptive only

- **WHEN** direction reports `needsDirection` after its retry
- **THEN** the plan carries a Bible with style constants and descriptive entries and no reference entries
- **AND** when a later re-run validates, reference entries are derived with no Bible model call

#### Scenario: No second planner or approval is introduced

- **WHEN** story visual direction completes
- **THEN** its decisions are persisted inside the existing Story Plan
- **AND** the run uses the existing Story Plan approval gate

#### Scenario: Direction receives generation constraints before spend

- **WHEN** a project has Visual or Rules material, roster entities, or template presentation constraints
- **THEN** sequence direction receives those inputs before approval
- **AND** no image, speech, music, or SFX provider is called by that stage
