# Post-Research Clarification Specification

## Purpose

Define the conditional checkpoint that runs after research and before the skeleton, when the retrieved
sources expose an editorial decision the evidence cannot settle — a source conflict, an unsupported
requested claim, materially different evidence scopes, or a case-study choice. Define what makes that
pause safe: a `plan_story` call that suspends mid-execution and resumes without re-running the frame or
the research already paid for, distinct durable step identities for its two phases, a prepared checkpoint
sufficient to finish from, retrieved text treated as untrusted evidence, and the existing abandonment and
approval behavior left unchanged.

## Requirements

### Requirement: Research produces questions only for material evidence decisions

After required research completes and before skeleton or draft begins, the system SHALL perform one evidence-decision analysis. It SHALL emit no questions or one existing story-question batch containing no more than three questions. Questions SHALL be limited to source conflicts, unsupported requested claims, materially different evidence scopes, or case-study choices that require user judgment; otherwise planning SHALL continue automatically.

Relevant options SHALL identify actual source titles or URLs from the held research bundle. The batch SHALL NOT repeat pre-research decisions.

#### Scenario: Case-study choice is material

- **WHEN** research finds multiple credible case studies whose selection materially changes the story
- **THEN** planning suspends before skeleton with a question describing that choice
- **AND** options identify relevant held sources

#### Scenario: Requested claim lacks support

- **WHEN** research finds no usable support for a requested claim
- **THEN** the system asks whether to omit, qualify, or retain it under best judgment
- **AND** it does not silently present the claim as verified

#### Scenario: No meaningful fork exists

- **WHEN** research supports one clear treatment and exposes no material editorial decision
- **THEN** no post-research batch is emitted
- **AND** planning continues automatically

#### Scenario: Pre-research decision is not repeated

- **WHEN** audience or another editorial decision was accepted before research
- **THEN** post-research analysis does not ask for that decision again

### Requirement: Tool suspension retains pending completion

When `plan_story` preparation needs post-research input, tool execution SHALL return an explicit suspended outcome understood by the agent loop. The loop SHALL keep the same cursor, retain `pendingTool` with original arguments and phase `complete`, and persist before returning suspension. It SHALL NOT mark the tool built, emit plan approval, append a completed result, or clear the pending tool.

After answer resume, the loop SHALL execute pending completion before requesting another model decision. Only successful completion SHALL clear the pending tool, advance the cursor, mark the story built, and open story-plan approval.

#### Scenario: Preparation suspends

- **WHEN** evidence analysis produces a post-research batch
- **THEN** `reactExecuteTool` returns suspension with `pendingTool.phase` set to `complete`
- **AND** agent-loop cursor remains on the current tool

#### Scenario: Resume completes before deciding again

- **WHEN** user answers the held post-research batch
- **THEN** the next execution completes the pending `plan_story`
- **AND** no decision-model call selects a different tool first

#### Scenario: Completion opens approval

- **WHEN** pending completion succeeds
- **THEN** the loop clears pending tool and advances exactly once
- **AND** the completed story plan reaches existing approval

### Requirement: Granular preparation and completion use distinct durable steps

Granular execution SHALL use stable `tool-N-plan_story-prepare` and `tool-N-plan_story-complete` step ids for the two phases. A suspended preparation SHALL NOT increment the granular cursor. After the answer's existing resume step, the driver SHALL run completion directly and increment only after it succeeds.

Retries SHALL reuse the corresponding stable step id so Inngest memoization prevents repeated preparation or completion billing. Tools without a suspended outcome SHALL retain existing step ids and cursor behavior.

#### Scenario: Granular preparation parks

- **WHEN** `tool-N-plan_story-prepare` returns suspension
- **THEN** cursor remains N while the driver waits for input
- **AND** no completion step runs before answer resume

#### Scenario: Granular completion has distinct identity

- **WHEN** input resumes the parked plan
- **THEN** the driver runs `tool-N-plan_story-complete`
- **AND** it does not re-enter memoized preparation

#### Scenario: Retry does not rebill a phase

- **WHEN** Inngest retries after either phase completed
- **THEN** that phase resolves through its memoized stable step
- **AND** its model work and usage capture are not repeated

#### Scenario: Ordinary tool behavior is unchanged

- **WHEN** a tool completes without a suspended outcome
- **THEN** it retains existing granular id and cursor advancement

### Requirement: Preparation checkpoint is durable and sufficient

Before suspension, planning SHALL persist a checkpoint containing stable checkpoint id, original `plan_story` arguments, resolved duration and shape inputs, frame, research bundle identity, and pre-research clarification provenance. Completion SHALL resolve research by stored identity and begin after research without reconstructing held state from mutable transcript prose.

If checkpoint or required-action persistence fails, planning SHALL fail visibly and SHALL NOT park the run.

#### Scenario: Restart resumes held work

- **WHEN** service restarts after preparation suspended
- **THEN** frame, research identity, original inputs, and completion phase rehydrate
- **AND** resume does not repeat frame or research

#### Scenario: Persistence fails before suspension

- **WHEN** checkpoint or required-action persistence fails
- **THEN** planning reports an error
- **AND** no unresumable awaiting-input state is exposed

### Requirement: Evidence analysis is metered text generation

The evidence-decision call SHALL use the normal text runner and generation-metering path. Provider, model, input/output usage, latency, and cost SHALL be recorded once per prepared plan. The call SHALL make no image, audio, video, or media-worker request.

Invalid structured output or provider failure SHALL record best-judgment fallback and continue without a question. It SHALL NOT enter an unmetered retry loop.

#### Scenario: Evidence call records usage

- **WHEN** evidence-decision analysis calls a text provider
- **THEN** normal text usage and cost are recorded
- **AND** no asset-provider usage is recorded

#### Scenario: Evidence call fails

- **WHEN** provider execution or structured parsing fails
- **THEN** planning records best-judgment fallback and continues
- **AND** no post-research batch is emitted from invalid output

### Requirement: Retrieved text remains untrusted evidence

Evidence analysis SHALL label source excerpts as untrusted data, bound their size, and prohibit following instructions found within them. Every source named by a question or option SHALL resolve to the held research bundle. The system SHALL NOT fabricate source disagreement.

#### Scenario: Source contains agent instructions

- **WHEN** a source excerpt tells the agent to alter its tools or workflow
- **THEN** the text is treated only as evidence
- **AND** clarification and tool policy remain unchanged

#### Scenario: Question names unknown source

- **WHEN** model output refers to a title or URL absent from the held bundle
- **THEN** that reference is rejected or omitted
- **AND** it is not shown as supporting evidence

### Requirement: Existing abandonment terminates pending completion

A post-research batch SHALL use existing awaiting-input wait, timeout, and `abandon-${segment}` behavior unchanged. Timeout SHALL abandon the run without choosing an answer or executing pending completion. The prepared checkpoint SHALL remain audit evidence but SHALL NOT resume after terminal abandonment.

#### Scenario: Post-research wait times out

- **WHEN** existing input timeout expires
- **THEN** existing abandonment marks the run terminal
- **AND** `plan_story` completion does not execute

#### Scenario: Answer arrives before timeout

- **WHEN** a valid batch answer arrives during the current wait
- **THEN** existing resume handling applies it
- **AND** pending completion proceeds

### Requirement: One planner and approval gate remain authoritative

Prepare and complete SHALL remain internal phases of the single public `plan_story` tool and SHALL produce one story-plan artifact. Accepted post-research answers SHALL constrain skeleton/draft and persist as post-research provenance. Existing story-plan approval and approved-snapshot requirements SHALL continue to gate `generate_story_assets`.

#### Scenario: Planner registry is unchanged

- **WHEN** callable video tools are listed
- **THEN** `plan_story` remains the only story planning tool
- **AND** no prepare or complete tool is exposed

#### Scenario: Answer shapes draft

- **WHEN** user selects a sourced case study after research
- **THEN** skeleton/draft receive that decision
- **AND** resulting plan retains research identity and post-research provenance

#### Scenario: Completion cannot spend assets

- **WHEN** pending planning completion finishes
- **THEN** story-plan approval still suspends before assets
- **AND** only an approved snapshot may reach `generate_story_assets`
