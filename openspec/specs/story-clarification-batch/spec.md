# Story Clarification Batch Specification

## Purpose

Define the one batch of questions a new video story build answers before framing or research begins: what it may ask and what it may not, how its answers are validated, persisted and resumed, how those decisions reach planning and appear on the resulting plan, and how a user or the system bypasses it. Clarification is a checkpoint, not a form — it collects decisions for one story and never offers alternate stories to pick from.

## Requirements

### Requirement: New story planning begins with one bounded clarification batch

For a new video story build that is not using an explicit bypass, the system SHALL suspend before story framing or research and present one batch containing one to three tailored clarification questions. Questions SHALL target unresolved decisions that materially affect the story. The batch SHALL NOT present alternate story directions or multiple story plans.

Each question SHALL have a stable id, short header, prompt, two or three mutually exclusive newly emitted options, short impact descriptions, exactly one recommended option, and a free-form Other answer. One batch-level action SHALL delegate all unanswered decisions to best judgment.

A batch SHALL declare its purpose. The question cap and the suspend-before-planning behavior above apply to the story-clarification purpose. A blocker-resolution batch SHALL reuse the same question, option, answer, and submission contract, SHALL present one question per open blocker with no fixed upper bound, SHALL NOT suspend a run, and SHALL offer no best-judgment delegation, because a blocker's leave-as-is option already carries that meaning per blocker.

#### Scenario: Sparse request receives useful questions

- **WHEN** a new story request leaves audience, viewer outcome, and example context unresolved
- **THEN** the system presents one batch before frame or research
- **AND** the batch contains no more than three questions covering material gaps

#### Scenario: New options are bounded

- **WHEN** the system emits a new story clarification question
- **THEN** it contains two or three mutually exclusive options
- **AND** exactly one option is recommended and every option explains its impact

#### Scenario: Other answer is available

- **WHEN** none of a question's options fits the user's intent
- **THEN** the user can select Other and enter a non-empty free-form answer

#### Scenario: Best judgment resolves missing answers

- **WHEN** the user selects use best judgment
- **THEN** every unanswered question is recorded as delegated
- **AND** no second pre-research batch is emitted

#### Scenario: Batch does not propose stories

- **WHEN** clarification appears
- **THEN** it asks for decisions needed to plan one story
- **AND** it does not offer alternate premises, hooks, arcs, or complete directions

#### Scenario: Blocker batch exceeds the story cap

- **WHEN** five blockers are open
- **THEN** the blocker-resolution batch carries five questions
- **AND** the three-question cap is not applied to it

#### Scenario: Purpose decides suspension

- **WHEN** a blocker-resolution batch is emitted
- **THEN** no run is suspended and no best-judgment action is offered
- **AND** a story-clarification batch emitted in the same project still suspends before planning

### Requirement: Clarification excludes known project and request values

Question generation SHALL receive resolved duration, aspect ratio, language, selected voice, style or preset, attached references, and other applicable project state. It SHALL NOT ask the user to repeat information already explicit in the request or resolved project state.

#### Scenario: Duration is explicit

- **WHEN** the request specifies a four-minute story
- **THEN** clarification does not ask for duration
- **AND** the four-minute target reaches planning

#### Scenario: Style is already selected

- **WHEN** the project already resolves a visual style or preset
- **THEN** clarification does not ask the user to select it again
- **AND** it may ask a distinct unresolved editorial question

### Requirement: Story clarification is independent of the generic ask limit

The one pre-research story batch SHALL NOT consume or be skipped by the generic `ASK_LIMIT`. Exemption SHALL require server-verified video content, new-story build intent, no existing story plan, no explicit bypass, and incomplete pre-research clarification state. Model-supplied purpose alone SHALL NOT bypass the generic limit.

All non-story clarification SHALL retain the existing generic ask counter. Story clarification state SHALL permit no more than one pre-research batch for a build.

#### Scenario: Generic allowance is already exhausted

- **WHEN** a qualifying new story build has exhausted its generic ask allowance
- **THEN** its one pre-research story batch is still presented
- **AND** the story batch does not increase the generic ask count

#### Scenario: Model cannot claim exemption

- **WHEN** an `ask_user` decision claims story purpose outside a qualifying new-story context
- **THEN** the server applies the generic ask counter
- **AND** no story-clarification state is created

#### Scenario: Story batch cannot repeat

- **WHEN** pre-research clarification is completed or bypassed
- **THEN** later decisions in the same build cannot emit another pre-research batch

### Requirement: Batch answers are structured and durable

One batch SHALL map to one structured answer submission. The server SHALL accept it only when every question has an option answer, non-empty Other answer, or — for a story-clarification batch — best-judgment delegation. A story-clarification batch SHALL additionally map to one pending required action, and before suspension the run SHALL persist batch id, questions, stage, status, and required-action identity. A blocker-resolution batch SHALL be reconstructible from current project state and SHALL NOT record a pending required action.

Reload and restart SHALL restore the same pending controls. Accepted answers SHALL apply idempotently. A stale action id or mismatched batch id SHALL leave the current pending action unchanged.

#### Scenario: Reload restores batch

- **WHEN** a run reloads while awaiting story clarification
- **THEN** the same unanswered batch is rendered
- **AND** it can resume without starting a new job

#### Scenario: Partial answer is rejected

- **WHEN** submission omits a question without best-judgment delegation
- **THEN** the server rejects it
- **AND** the required action remains pending

#### Scenario: Duplicate answer is harmless

- **WHEN** an accepted batch answer is delivered again
- **THEN** answers are not appended twice
- **AND** planning resumes no more than once

#### Scenario: Stale card is rejected

- **WHEN** submission carries a superseded action id or mismatched batch id
- **THEN** the server rejects it
- **AND** the current batch remains pending

#### Scenario: Blocker batch survives reload without a pending action

- **WHEN** the page reloads while blockers are open
- **THEN** the blocker-resolution batch is rebuilt from current state with the same blocker ids
- **AND** no pending required action was needed to restore it

### Requirement: Accepted decisions constrain one story plan

Accepted answers SHALL become a typed clarification summary supplied to story frame and research without replacing the original request. The persisted story plan SHALL carry resolved decisions and their pre-research provenance. If the resulting plan contradicts an accepted decision, the system SHALL surface that contradiction rather than claim the decision was applied.

A decision SHALL be reported as applied only where the plan records the value it decided. A question MAY name such a field, and its options' values SHALL then be that field's values. A decision naming no field SHALL be reported as supplied to planning, never as honored.

#### Scenario: Audience answer shapes frame

- **WHEN** the user selects team leaders as audience
- **THEN** frame receives that structured audience decision
- **AND** the story plan exposes it as clarification provenance

#### Scenario: Original request remains intact

- **WHEN** clarification is accepted
- **THEN** the original user request remains stored unchanged
- **AND** the typed clarification summary is stored separately

#### Scenario: Contradiction is visible

- **WHEN** a plan cannot honor an accepted clarification decision that named a field the plan records
- **THEN** review reports the contradiction
- **AND** it does not report that decision as successfully applied

#### Scenario: An editorial decision is not claimed as applied

- **WHEN** an accepted decision names no field the plan records
- **THEN** provenance reports it as supplied to planning
- **AND** it is reported neither as honored nor as contradicted

### Requirement: Bypass and approval boundaries remain explicit

An explicit skip-question request or one-shot story generation SHALL bypass pre-research clarification and record that bypass. Clarification SHALL NOT invoke image, audio, video, or other asset-generating providers. The resulting story plan SHALL still require existing approval before `generate_story_assets`, except for existing one-shot implicit-approval behavior.

A build whose question generation produces no questions SHALL proceed ungated and SHALL record that as its own bypass, distinct from a bypass the user requested. A failed generator SHALL NOT block the build, and SHALL NOT be reported as a user decision.

#### Scenario: User skips questions

- **WHEN** the user explicitly asks to skip clarification
- **THEN** bypass provenance is recorded
- **AND** frame begins without a question batch

#### Scenario: One-shot stays one shot

- **WHEN** the user explicitly invokes one-shot story generation
- **THEN** clarification adds no suspension
- **AND** existing implicit-approval provenance remains in force

#### Scenario: Question generation produces nothing

- **WHEN** clarification runs for a qualifying build and yields no questions
- **THEN** planning proceeds without a batch
- **AND** provenance records the bypass as unavailable rather than as a user request

#### Scenario: Clarification makes no asset call

- **WHEN** a story batch is generated or answered
- **THEN** no asset-generating provider call is made
- **AND** normal story-plan approval continues to gate asset generation

### Requirement: Existing abandonment applies to story batches

A run parked on a story clarification batch SHALL use the existing awaiting-input timeout and abandonment path unchanged. Timeout SHALL abandon the run without selecting defaults, beginning frame/research, or generating assets. A restart before timeout SHALL restore the pending action.

#### Scenario: Pending batch times out

- **WHEN** existing awaiting-input timeout expires before an answer arrives
- **THEN** the run is abandoned through existing abandonment behavior
- **AND** no clarification answer is invented

#### Scenario: Restart precedes timeout

- **WHEN** service restarts while the batch remains within its wait window
- **THEN** the pending batch rehydrates
- **AND** the user may still answer it

### Requirement: Batch UI is accessible and isolated from composer

The web client SHALL render questions as labelled single-choice groups with keyboard-operable options, descriptions, recommended state, associated Other inputs, one submit action, best-judgment action, missing-answer feedback, and locked accepted/stale state. Focus SHALL enter the batch when it appears and reach validation feedback when submission is incomplete.

The normal composer SHALL retain new-command behavior and SHALL NOT answer the batch. Existing free-text plan-revision prompts SHALL retain composer capture.

#### Scenario: Keyboard completion

- **WHEN** a keyboard user receives a batch
- **THEN** they can traverse, answer, and submit every question without pointer input

#### Scenario: Composer remains independent

- **WHEN** a batch is pending and the user sends normal composer text
- **THEN** existing new-command behavior applies
- **AND** the batch remains unresolved

#### Scenario: Accepted card locks

- **WHEN** server accepts a batch answer
- **THEN** selected answers remain visible
- **AND** its controls become unavailable

### Requirement: Legacy single questions remain compatible

API and web readers SHALL continue accepting persisted single-question actions with two to four options and legacy string answers. New two-or-three option bounds SHALL apply only to newly emitted batch questions. Non-story clarification SHALL retain current single-question behavior.

#### Scenario: Legacy four-option question reloads

- **WHEN** a persisted action contains one question with four options
- **THEN** it still renders and accepts its legacy string answer

#### Scenario: Non-story question remains single

- **WHEN** a non-story flow asks one generic clarification question
- **THEN** its current single-question contract remains valid
- **AND** it is not forced into story-batch behavior
