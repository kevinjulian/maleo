# chat-blocker-resolution Specification

## Purpose

Define what blocks a project as current state rather than transcript: how open blockers are derived and identified, how every one of them is presented at once in one pinned decision batch, what remedies each may offer, how a submission is applied and what remains is re-reported, and why the batch never parks the run.

## Requirements

### Requirement: Open blockers are current project state

The system SHALL derive the set of open blockers from current project state — unresolved delivery-check findings and unresolved story-direction errors — rather than from the transcript. Each blocker SHALL carry a stable id derived from what it reports, so the same unresolved condition keeps its identity across runs. The set SHALL be recomputed on read: a blocker whose condition no longer holds SHALL disappear without any run being started, and a blocker whose condition still holds SHALL remain regardless of how many runs have happened since it was first reported.

#### Scenario: Blocker outlives the run that reported it

- **WHEN** a run reports two blockers and a later run finishes without clearing them
- **THEN** both blockers are still open
- **AND** each keeps the id it was first reported with

#### Scenario: Condition cleared elsewhere

- **WHEN** an open blocker's condition is resolved by an edit made in the editor rather than through the blocker itself
- **THEN** the next read reports that blocker as no longer open
- **AND** no run is started to discover that

#### Scenario: No blockers

- **WHEN** no delivery-check finding and no direction error is unresolved
- **THEN** the open blocker set is empty

### Requirement: Every open blocker is presented at once in one pinned batch

Open blockers SHALL be presented as a single decision batch in the pinned region above the composer, with one single-choice question per open blocker and one submit for the whole batch. The batch SHALL present every open blocker, not only the newest. The batch SHALL NOT be rendered as transcript history and SHALL NOT be superseded by a newer run or a newer instruction while any of its blockers remain open.

#### Scenario: Several blockers open together

- **WHEN** three blockers are open
- **THEN** the pinned batch shows three questions and one submit
- **AND** each question names its blocker and its remedy options

#### Scenario: Newer run does not orphan blockers

- **WHEN** a new run starts while blockers are open
- **THEN** the pinned batch still presents every blocker that is still open
- **AND** resolving one blocker does not remove the controls of the others

#### Scenario: Failed run still offers remedies

- **WHEN** the run that reported the blockers failed
- **THEN** the pinned batch is still presented with its remedy controls
- **AND** the run's own failure actions remain on the run

### Requirement: Blockers carry remedy options, not a bare instruction

Each blocker question SHALL offer mutually exclusive remedy options with exactly one recommended option, each naming its effect. A blocker with an applicable automatic remedy SHALL offer it as the recommended option. Every blocker SHALL offer a leave-as-is option and a free-form Other answer. A blocker that only the operator can clear — a required reference with no roster entity — SHALL offer navigation to the surface that clears it instead of an automatic remedy, and SHALL NOT present a remedy the system cannot perform.

#### Scenario: Finding with an automatic fix

- **WHEN** a delivery-check finding carries a fix
- **THEN** its question recommends applying that fix
- **AND** also offers leaving it as is and a free-form answer

#### Scenario: Stale direction

- **WHEN** a plan's direction inputs changed since direction last ran
- **THEN** its question recommends re-running direction

#### Scenario: Operator-only blocker

- **WHEN** a blocker reports a required reference with no roster entity
- **THEN** its question offers navigation to the reference surface
- **AND** offers no automatic remedy for it

### Requirement: Submission applies chosen remedies and re-reports what remains

Submitting the batch SHALL require an answer for every question and SHALL apply the chosen remedies in the order presented. After applying, the system SHALL recompute the open blocker set and present a batch containing only the blockers that remain open. A blocker answered leave-as-is SHALL be recorded as acknowledged and SHALL NOT be re-presented until its condition changes. A remedy that fails SHALL leave its blocker open with the failure named, and SHALL NOT prevent the other chosen remedies from being applied.

#### Scenario: Partial answer is rejected

- **WHEN** submission omits an answer for an open blocker
- **THEN** the server rejects the submission
- **AND** the batch stays pending with the unanswered blocker marked

#### Scenario: Some blockers resolved

- **WHEN** two of three chosen remedies clear their blockers
- **THEN** the next batch presents only the blocker that remains open

#### Scenario: Remedy fails

- **WHEN** a chosen remedy fails to apply
- **THEN** its blocker remains open with the failure named
- **AND** the remedies chosen for the other blockers are still applied

#### Scenario: Acknowledged blocker stays quiet

- **WHEN** a blocker is answered leave-as-is
- **THEN** it is not presented again while its condition is unchanged
- **AND** it is presented again if its condition changes

### Requirement: The blocker batch does not hold chat hostage

An open blocker batch SHALL NOT park the run or block the composer. The user SHALL be able to send an instruction, start a run, and approve work while blockers are open, except where a blocker's own condition already refuses that work. Blockers SHALL be presented as state that is worth clearing, never as a required action that must be answered before the conversation may continue.

#### Scenario: Composer stays usable

- **WHEN** a blocker batch is open
- **THEN** the composer accepts an instruction and starts a run

#### Scenario: Blocker batch is not a required action

- **WHEN** a blocker batch is open and the user sends an unrelated instruction
- **THEN** no pending required action is recorded for the batch
- **AND** the batch remains pinned with its blockers still open

#### Scenario: Refusal still comes from the condition

- **WHEN** an open blocker's condition refuses asset generation
- **THEN** generation is still refused by that condition
- **AND** the refusal is not attributed to the batch being unanswered
