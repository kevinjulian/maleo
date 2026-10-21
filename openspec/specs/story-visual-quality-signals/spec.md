# story-visual-quality-signals Specification

## Purpose

Measurable, threshold-free signals over generated story visuals — beats per
planned shot and adjacent visual reuse — and the rule that a failed
generation-call invariant surfaces as a retryable section failure rather than
degrading silently. Every figure here is a count or a ratio of counts: a tunable
similarity threshold is a hardcoded constant in a lab coat, and the metric it
replaced was recorded on zero runs.

## Requirements

### Requirement: Story visual beat signals are recorded per project

The project quality report SHALL record two signals derived from generated story
sections: `beatsPerPlannedShot` (final visual beats divided by planned shots) and
`visualBeatReusePct` (the share of adjacent visual beat pairs whose structured
intents match on visual moment, shot type, camera angle, location id, and subject
ids). Where a beat carries only a legacy prose visual, the pair SHALL be compared on
normalized prose instead. Both signals SHALL be computed by counting, without a
tunable similarity threshold.

A signal that cannot be computed — because a project has no generated story
sections — SHALL be recorded as absent rather than as a passing value.

Both signals SHALL be derived from the same comparison the pre-submission coverage
invariants use, so a project's recorded reuse figure and its generation-time
duplicate gate cannot disagree.

#### Scenario: Signals recorded for a generated story project

- **WHEN** a project has story sections with generated visual beats
- **THEN** the quality report records `beatsPerPlannedShot` and `visualBeatReusePct`

#### Scenario: Reuse computed on structured fields

- **WHEN** a project's beats carry structured visual intent
- **THEN** `visualBeatReusePct` compares adjacent beats on visual moment, shot type, camera angle, location id, and subject ids
- **AND** it does not compare composed provider strings

#### Scenario: Legacy beats fall back to prose comparison

- **WHEN** a project's beats carry only legacy prose visuals
- **THEN** `visualBeatReusePct` compares their normalized prose

#### Scenario: No generated story sections

- **WHEN** a project has no story sections with generated visual beats
- **THEN** both signals are recorded as absent
- **AND** neither is reported as a passing value

### Requirement: Visual relevance is not measured by cross-language token overlap

The system SHALL NOT report visual relevance as lexical token overlap between the
outcome objective and a provider-facing image prompt. Narration and objectives are
written in the brief's language while image prompts are written in English, so the
overlap is structurally near-zero and carries no signal.

Visual relevance SHALL either be omitted or produced as a judgement recorded at
`warning` severity at most. It SHALL NOT block delivery.

#### Scenario: Objective and prompt are in different languages

- **WHEN** the outcome objective is written in the brief's language and image prompts are written in English
- **THEN** no relevance figure is derived from token overlap between them

#### Scenario: Relevance judgement never blocks

- **WHEN** a visual relevance judgement is recorded for a run
- **THEN** its finding severity is `warning` or lower
- **AND** the run is not failed on that finding alone

### Requirement: Generation-call invariants fail loudly

Where a generation call's result is checked by counting — one authored visual per
beat, every beat index present exactly once, no adjacent normalize-equal visuals —
a violation SHALL retry the call and then mark the owning section failed and
retryable with an error naming the violated invariant.

The system SHALL NOT satisfy a failed invariant by substituting previously
generated content, reusing another beat's visual, or emitting a placeholder. A
silently degraded result is a worse outcome than a visible retryable failure.

#### Scenario: Invariant violation surfaces

- **WHEN** a generation call returns a result that violates a counted invariant after retry
- **THEN** the section is marked failed and retryable
- **AND** its error names the violated invariant

#### Scenario: No silent substitution

- **WHEN** a generation call fails or returns an unusable result
- **THEN** the pipeline does not reuse another beat's visual or emit a placeholder in its place

### Requirement: Generation calls are traced like every other tool call

Every generation call the story asset pipeline makes SHALL be recorded through the
agent tool trace, carrying its arguments, result summary, latency, and cost, so it
appears in `tool_run` and `agent.tool_call` alongside the pipeline's other
generation calls.

#### Scenario: Authoring call appears in the run trace

- **WHEN** the story asset pipeline authors visuals for a section
- **THEN** a tool call event is recorded with the call's arguments, result summary, latency, and cost
- **AND** it is visible in the run trace alongside voice and image generation calls

### Requirement: Plan-shot coverage is enforced before submission, not measured offline

Whether a section has enough beats to cover its planner-approved shots SHALL be
checked as a pre-submission invariant, not only reported after the fact. A section
with more approved shots than measured beats SHALL be failed and retryable rather
than generated.

The check counts; it does not pair a shot with a beat. Planned shots are prose and
beats are structured, and pairing them would need a similarity score. So the error
names how many shots cannot be covered, not which ones.

The offline script that scanned persisted storyboards for this correlation SHALL be
removed once the invariant runs live.

#### Scenario: More approved shots than beats fails the section

- **WHEN** a section carries more approved planned shots than it has generated visual beats
- **THEN** the section is marked failed and retryable before any provider call
- **AND** the error names how many shots cannot be covered

#### Scenario: Offline scan removed

- **WHEN** plan-shot coverage runs as a pre-submission invariant
- **THEN** the offline storyboard scan script is no longer present in the repository

### Requirement: Narrative arc coverage is reported alongside visual signals

The project quality report SHALL record narrative arc coverage beside the existing story visual
beat signals, so a project's structural health is visible in the same place as its visual health.

The recorded signals SHALL be countable: which required arc functions are missing, whether
functions appear in canonical order, the midpoint's observed position as a fraction of runtime,
whether the engagement turn maps to the turn-function section, and the count of distinct emotions
across sections.

A plan carrying no arc SHALL yield no arc coverage signals rather than a failed report, so
documents planned before arcs existed still load and report.

#### Scenario: Arc coverage appears in the report

- **WHEN** a project quality report is produced for a plan carrying an arc
- **THEN** the report records missing functions, ordering, midpoint position, turn fulfilment, and distinct emotion count

#### Scenario: Plans without an arc still report

- **WHEN** a project quality report is produced for a plan carrying no arc
- **THEN** the report omits arc coverage signals
- **AND** the report is still produced

### Requirement: Narrative coverage is reported, not enforced before submission

Plan-shot coverage is enforced before provider submission because a section that would ship a
duplicate or uncast image is a correctness defect. Narrative arc coverage SHALL NOT be enforced
that way. Arc violations SHALL be reported for operator review and SHALL NOT mark a section
failed, block approval, or prevent image generation.

A story whose midpoint sits at 0.62 of runtime is a matter of pacing judgment, not a defect that
would waste a provider call, so it SHALL be surfaced rather than blocked.

#### Scenario: Arc violation does not block submission

- **WHEN** a plan carries narrative arc coverage violations
- **THEN** image generation proceeds for its sections
- **AND** no section is marked failed on account of the arc violation

#### Scenario: Visual coverage enforcement is unchanged

- **WHEN** a section violates plan-shot coverage or beat cast invariants
- **THEN** it is still rejected before provider submission exactly as before
