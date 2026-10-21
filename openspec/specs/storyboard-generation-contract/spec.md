# storyboard-generation-contract Specification

## Purpose

Define stable story section and semantic-beat identity, revision-checked draft mutation, immutable generation approval, and legacy canonicalization boundaries.

## Requirements

### Requirement: Approval captures sequence direction with stable beats

For a newly directed canonical plan, every semantic beat's editorial decision SHALL live inside the draft revision and SHALL be cloned into the immutable approved snapshot. Generation SHALL read direction only from that captured approved snapshot and SHALL NOT mix later direction edits into the pass.

Any command that changes narration, visual intent, emotion, or editorial direction SHALL create a new draft revision and make the prior approval inapplicable to those changed inputs.

#### Scenario: Direction remains immutable during generation

- **WHEN** operator edits draft direction after approving a prior revision
- **THEN** running generation continues from approved direction
- **AND** new direction waits for another approval

#### Scenario: One-shot captures direction

- **WHEN** explicit one-shot generation creates implicit approval
- **THEN** sequence direction completes before that snapshot is created
- **AND** asset generation reads same captured decisions as standard approval

### Requirement: Story plans contain stable sections and semantic beats

A canonical story plan SHALL contain stable opaque section identifiers and ordered semantic beats with stable opaque beat identifiers. Sections SHALL remain chapter units. Semantic beats SHALL remain authored units distinct from measured voice segments and visual render beats.

Editing or reordering SHALL preserve identity. Splitting a beat SHALL preserve original identity on first result and create identity for additional results. Merging SHALL preserve first identity and retire others.

#### Scenario: Beat reordered

- **WHEN** a beat moves within or between sections
- **THEN** its beat identifier remains unchanged

#### Scenario: Semantic beat creates several render beats

- **WHEN** measured duration divides one semantic beat into several visual beats
- **THEN** every visual beat records same semantic source beat

### Requirement: Draft and approved plan state are separate

Plan state SHALL contain one mutable draft revision and at most one latest immutable approved snapshot. Every accepted edit SHALL create new draft revision. Generation SHALL capture one approved snapshot and SHALL NOT mix later draft changes into that pass.

#### Scenario: Edit after approval

- **WHEN** operator edits draft after approval
- **THEN** approved snapshot remains unchanged
- **AND** existing outputs retain source approved revision

#### Scenario: Concurrent edit during generation

- **WHEN** draft changes while generation pass runs
- **THEN** all pass outputs use captured approved revision

### Requirement: Story commands are revision checked

Agent and future direct-editor mutations SHALL use same typed command service. Every command SHALL name expected revision. Stale revision SHALL return current revision and SHALL NOT mutate plan.

#### Scenario: Current command

- **WHEN** command names current revision
- **THEN** service applies command and returns new revision

#### Scenario: Stale command

- **WHEN** command names older revision
- **THEN** service rejects it without overwrite
- **AND** returns current revision

### Requirement: Approval records generation and extension authority

Every approved snapshot SHALL record approval mode and duration-extension policy. Supported policies SHALL be `review_additions` and `auto_approve_additions`. Standard approval SHALL default to review. Explicit one-shot generation SHALL create implicit approval using auto policy.

#### Scenario: Standard approval

- **WHEN** operator approves plan without requesting automatic extension
- **THEN** snapshot records explicit approval and `review_additions`

#### Scenario: One-shot request

- **WHEN** operator explicitly invokes one-shot story creation
- **THEN** flow creates implicit approved snapshot
- **AND** records `implicit_one_shot` and `auto_approve_additions`

### Requirement: Legacy reads do not fabricate provenance

Legacy plan SHALL remain readable without stable beat ids or approved revision. Read alone SHALL NOT persist invented identity, approval, hashes, or staleness. First explicit mutation or approval SHALL canonicalize before save.

#### Scenario: Legacy plan opened

- **WHEN** legacy plan is read
- **THEN** runtime adapter returns usable view
- **AND** persisted payload remains unchanged

#### Scenario: Legacy plan approved

- **WHEN** operator approves legacy plan
- **THEN** it is canonicalized and snapshot records real approval
