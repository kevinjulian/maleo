# Plan Revision Loop Specification

## Purpose

Keep pre-production a free loop. Rejecting a story plan parks the run holding the frame, skeleton and
research it already paid for, and the revision redrafts against them rather than starting over — so the
only path from a reviewable plan to a provider bill is still an explicit approval, and the operator learns
what the plan is grounded in at the moment they make that call.

## Requirements

### Requirement: Rejecting a plan parks the run instead of ending it

Rejecting a story plan at the approval gate SHALL leave the run alive and awaiting input, holding the plan
it drafted. It SHALL NOT terminate the run, and it SHALL NOT require the operator to start a new run in
order to revise the plan.

Pre-production SHALL remain free: a rejection and the redraft that follows SHALL NOT generate assets and
SHALL NOT require approval.

#### Scenario: Reject keeps the run alive

- **WHEN** the operator rejects a story plan
- **THEN** the run remains awaiting input
- **AND** the drafted plan is still present

#### Scenario: Revision needs no new run

- **WHEN** the operator sends a revision after rejecting
- **THEN** the revision is applied within the same run

#### Scenario: Revising costs nothing

- **WHEN** a plan is rejected and redrafted
- **THEN** no asset-generating provider call is made
- **AND** no approval is requested for the redraft itself

### Requirement: A revision redrafts against the held frame, skeleton, and research

A revision SHALL redraft all sections against the frame, skeleton, and research bundle the run already
holds. It SHALL NOT re-run the frame, SHALL NOT re-derive the skeleton, and SHALL NOT discard the retrieved
research, so the plan's structure and evidence survive iteration.

The redraft SHALL resolve its research bundle by the plan's persisted research identity, not by matching
the brief text, because a revision changes the brief by definition.

The system SHALL request approval again after each redraft, so the only path from pre-production to asset
generation remains an explicit approval.

#### Scenario: Structure survives a revision

- **WHEN** a rejected plan is redrafted
- **THEN** the arc, section count, chapter functions, and obligations are the ones the skeleton produced
- **AND** neither the frame nor the skeleton was recomputed

#### Scenario: Research survives a revision

- **WHEN** a grounded plan is rejected and redrafted with a changed brief
- **THEN** the redraft uses the research bundle the plan was drafted against
- **AND** the sources are not dropped because the brief text changed

#### Scenario: All sections are redrafted

- **WHEN** the operator sends a revision
- **THEN** every section is redrafted against its existing slot

#### Scenario: Redraft re-gates before assets

- **WHEN** a redraft completes
- **THEN** the run suspends for approval again
- **AND** no assets were generated in between

### Requirement: The revision loop is bounded and reports its bound

The number of revision iterations SHALL be bounded, and the bound SHALL be sized for repeated free
iteration rather than for a single correction. When the bound is reached, the run SHALL report that it was
reached rather than failing silently or appearing to accept another revision.

#### Scenario: Bound is reported when reached

- **WHEN** the revision bound is reached
- **THEN** the run reports that the revision limit was reached
- **AND** the plan is still present rather than discarded

### Requirement: Research can be re-run from the revision loop

The operator SHALL be able to request research again from the parked gate without discarding the plan.
Re-running research SHALL merge newly retrieved sources into the run's existing bundle rather than
replacing it, so evidence accumulates across iterations.

#### Scenario: Additional research merges

- **WHEN** the operator requests research again on a parked plan
- **THEN** newly retrieved sources are added to the existing bundle
- **AND** previously retrieved sources are retained

#### Scenario: Re-running research does not discard the plan

- **WHEN** research is re-run from the parked gate
- **THEN** the held frame, skeleton, and drafted sections remain available

### Requirement: The approval gate reports what the plan is grounded in

The approval question that precedes asset generation SHALL report the plan's verification state: how many
sources were retrieved, how many sections carry no citation, and whether grounding was requested but not
achieved. These counts SHALL be reported at the gate itself, not only in a separate artifact.

The gate SHALL report these counts without blocking. An ungrounded or partially cited plan SHALL remain
approvable, consistent with the rule that grounding warnings inform rather than gate.

#### Scenario: Counts appear at the gate

- **WHEN** a grounded plan reaches the approval gate
- **THEN** the approval question reports the retrieved source count and the count of sections citing none

#### Scenario: Requested-but-missing grounding is called out

- **WHEN** grounding was requested and no sources were retrieved
- **THEN** the approval question says so explicitly

#### Scenario: Warnings do not block approval

- **WHEN** a plan with citation warnings is approved
- **THEN** asset generation proceeds

### Requirement: Story Plan review exposes visual and reference decisions

The existing Storyboard review — the surface that shows the plan's beats and
carries its approve control — SHALL show, for each planned shot, its directed
visual intent, selected reference labels and roles, and selection rationale. It
SHALL distinguish an existing project-roster entity from a planned reference that
will be materialized after approval.

The chat approval gate summarises the same plan without repeating every shot. It
SHALL report that direction needs review, and name any blocking reference
requirement such as a missing product, so an operator approving from chat is never
told a plan is ready when it is not.

This information SHALL appear in the existing approval artifacts and SHALL NOT
create a second Creative Director approval or top-level Director surface.

#### Scenario: Existing reference is reviewable before spend

- **WHEN** direction selects an existing character entity for a planned shot
- **THEN** Storyboard review shows the character label, role, and selection rationale
- **AND** approval freezes that entity id with the plan revision

#### Scenario: Planned reference is reviewable before materialization

- **WHEN** direction declares a new recurring location reference
- **THEN** Storyboard review marks it as planned and shows its label, role, description, and rationale
- **AND** no reference image is generated before approval

#### Scenario: Blocking product requirement is visible

- **WHEN** direction reports a required product with no roster entity
- **THEN** the chat approval gate and Storyboard both report the blocker as operator action
- **AND** approval is refused until it is resolved

### Requirement: Relevant revisions invalidate story visual direction

A revision that changes narration, planned shots, project roster membership, routed
Visual or Rules material, or applicable timeline-template presentation constraints
SHALL invalidate prior story visual direction. The system SHALL re-run direction
before presenting the revised plan for approval. The Story Bible is downstream of
direction; its subject links SHALL be reconciled from the new direction output.

The system SHALL record a fingerprint of the direction inputs with the direction.
Approval SHALL compare that fingerprint with current inputs, including the current
project roster, and SHALL re-run direction instead of approving when they differ.
A change that does not alter any direction input SHALL preserve the existing valid
direction.

Approval snapshots and visual input hashes SHALL include the resulting visual
direction and reference bindings.

#### Scenario: Narration revision re-directs visuals

- **WHEN** the operator revises narration or planned shots on a parked plan
- **THEN** prior shot direction becomes stale and direction runs again
- **AND** the revised plan returns to the same approval gate before asset generation

#### Scenario: Roster change on a parked plan re-directs

- **WHEN** a selected entity is detached from, or a product entity attached to, the project roster while the plan is parked
- **THEN** approval detects the changed direction-input fingerprint and re-runs direction
- **AND** the re-run either chooses valid bindings or reports a blocking reference requirement before approval

#### Scenario: Unrelated revision preserves direction

- **WHEN** a parked plan change does not alter any visual-direction input
- **THEN** the existing validated direction remains attached to the plan
- **AND** no redundant direction model call is required

### Requirement: Storyboard mutations cannot bypass story visual direction

Every mutation of a directed story plan's draft — the agent's `update_section` path
and every storyboard command — SHALL follow one contract. Only story visual
direction SHALL write planned-shot direction, reference bindings, or the
planned-reference set. A mutation payload that carries planned-shot direction or
reference bindings SHALL be refused.

For a directed plan, storyboard commands SHALL behave as follows:

- `update_section` (title only), `lock_beat`, `unlock_beat`: direction unchanged.
- `update_beat` changing narration, visual prompt, motion graphic, or editorial;
  `add_section`, `remove_section`, `reorder_section`, `add_beat`, `remove_beat`,
  `reorder_beat`, `split_beat`, `merge_beats`: direction becomes stale.
- `attach_reference`: accepted only when the id is attached to the project roster
  (`entity`) or is a key in the plan's final planned-reference set (`planned`). It
  records an operator-required reference on the beat and makes direction stale.
  Re-run direction SHALL bind every operator-required reference in at least one
  planned shot of that beat, or report why it cannot.

Legacy plans without direction SHALL keep their existing command behavior.

#### Scenario: Agent section edit cannot inject a reference

- **WHEN** an agent section edit supplies an entity id or planned key for a planned shot
- **THEN** the edit is refused with a note to revise the plan or attach a reference instead
- **AND** the binding set is unchanged

#### Scenario: Narration edit re-directs before approval

- **WHEN** a section's narration is edited through `update_section` or `update_beat`
- **THEN** the plan reports stale direction naming that beat
- **AND** direction re-runs against the edited draft before the plan can be approved

#### Scenario: Structural storyboard edit stales direction

- **WHEN** the operator splits, merges, adds, removes, or reorders a beat on a directed plan
- **THEN** direction becomes stale
- **AND** the plan cannot be approved until direction re-runs and validates

#### Scenario: Operator-attached reference is honored by direction

- **WHEN** the operator attaches a roster entity to a beat on a directed plan
- **THEN** direction re-runs with that entity as a required binding for the beat
- **AND** the re-run either binds it in a planned shot or reports a named validation error

#### Scenario: Off-roster attach is refused

- **WHEN** the operator attaches an entity id not on the project roster, or a key outside the final planned-reference set
- **THEN** the command is refused as invalid
- **AND** the draft revision is unchanged

### Requirement: One approval validator guards every approval path

Chat approval and storyboard API approval SHALL call one shared approval validator
before creating an approved snapshot. For a directed plan the validator SHALL refuse
approval when direction is stale or `needsDirection`, when a blocking reference
requirement is open, or when the stored direction-input fingerprint differs from one
recomputed against the current draft and project roster. On a fingerprint mismatch
the chat path SHALL re-run direction; the storyboard API SHALL return a refusal
naming stale direction rather than snapshotting, and direction is re-run through the
chat revision loop. Legacy plans SHALL pass the
validator under existing rules.

#### Scenario: Storyboard approval cannot skip direction

- **WHEN** the storyboard API approves a directed plan whose direction is stale
- **THEN** approval is refused naming stale direction
- **AND** no approved snapshot is created

#### Scenario: Both paths agree

- **WHEN** the same parked plan is approved through chat and through the storyboard API
- **THEN** both paths accept or refuse it for the same reason
