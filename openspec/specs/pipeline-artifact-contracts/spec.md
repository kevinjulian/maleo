# pipeline-artifact-contracts Specification

## Purpose

Defines how pipeline stages hand work to each other: every handoff is a versioned,
validated artifact with recorded provenance and lineage; each stage declares the
artifacts it requires and produces, and the runner enforces that contract, reports
structured outcomes, and persists a stage's outputs atomically with the run's cursor.

## Requirements

### Requirement: Versioned artifact envelope

Every artifact SHALL be represented by a runtime-validated envelope carrying
artifact identity, kind, schema version, status, producer, project identity,
revision, immutable input references, content hash, creation time, and a payload
validated by that kind's own schema. The producer SHALL be a pipeline stage or a
tool within a run, which carries that run's identity, or an editor edit made outside
any run. Every artifact write SHALL go through one write path that validates the
payload, advances the revision, and computes the content hash.

#### Scenario: Valid artifact crosses a stage boundary

- **WHEN** a stage produces an artifact whose envelope and kind payload satisfy their
  schemas
- **THEN** the pipeline accepts it for downstream use

#### Scenario: Invalid artifact is rejected before persistence

- **WHEN** a stage produces an artifact whose envelope or payload violates its schema
- **THEN** the artifact is rejected before it is persisted and before any downstream
  stage runs

#### Scenario: Run-bound artifact without a run

- **WHEN** an artifact produced by a stage or tool lacks its run identity
- **THEN** it is rejected

#### Scenario: Editor edit outside a run

- **WHEN** the operator edits an artifact in the editor with no run involved
- **THEN** the artifact records an editor producer, a new revision and a new
  content hash, and no run identity

#### Scenario: Input references identify exact upstream content

- **WHEN** an artifact references an upstream artifact
- **THEN** the reference carries that artifact's id, kind, schema version and content
  hash, so a later revision of the same id is distinguishable

### Requirement: One artifact model

The system SHALL have a single artifact model. Artifact kinds SHALL be defined as
separate payload schemas sharing the common envelope, and no second untyped or
unversioned artifact union SHALL remain.

#### Scenario: Adding a kind does not edit a shared union

- **WHEN** a new artifact kind is added
- **THEN** it is added as its own payload schema and registry entry, without editing a
  union that existing consumers switch on

#### Scenario: Persisted artifacts carry a version

- **WHEN** an artifact is persisted
- **THEN** it records its schema version and the run that produced it

### Requirement: Mandatory stage compatibility

Every registered stage SHALL declare the artifact kinds it requires and produces.
The system SHALL validate the topology of every profile at registration.

#### Scenario: Requirement cannot be satisfied

- **WHEN** a profile contains a stage requiring an artifact kind that no earlier stage
  produces and no initial input supplies
- **THEN** registration fails, naming the stage and the unsatisfied kind

#### Scenario: Declaration is not optional

- **WHEN** a stage is registered without declaring what it requires and produces
- **THEN** registration fails

#### Scenario: Stage output must match its declaration

- **WHEN** a stage completes and returns artifacts
- **THEN** the returned kinds match the stage's declared outputs exactly, and a
  mismatch fails the stage

### Requirement: Structured stage outcome

A stage SHALL return a typed result: completion with produced artifacts, a draft
awaiting approval, a suspension waiting on the user, or a failure carrying a stable
code, a message, and whether retry is allowed. Failure SHALL NOT be signalled by the
content of a success value. A suspended stage's writes SHALL stay in progress and the
run SHALL stay at that stage, so nothing downstream consumes them and the stage,
re-entered with the user's answer, completes them.

#### Scenario: Stage fails predictably

- **WHEN** a stage cannot complete
- **THEN** its result identifies the stage, a stable failure code, a message, and
  whether retry is allowed

#### Scenario: String-encoded failure is gone

- **WHEN** a stage reports failure
- **THEN** no consumer determines failure by inspecting a returned string's prefix

#### Scenario: Stage parks on the user

- **WHEN** a stage cannot finish without the user's answer
- **THEN** its result is a suspension with the reason, the run stays at that stage,
  and what the stage wrote stays in progress until it is re-entered and completes

### Requirement: Readiness is separate from structural validity

Each artifact kind SHALL declare a readiness predicate alongside its schema. A stage
SHALL receive only ready artifacts unless it explicitly declares that it accepts
partial output.

#### Scenario: Structurally valid but not ready

- **WHEN** an artifact satisfies its schema but its readiness predicate is false
- **THEN** a downstream stage that did not declare acceptance of partial output does
  not receive it

### Requirement: Stages exchange artifacts, not shared mutable state

A stage SHALL read its inputs as artifact references produced by earlier stages or
supplied as initial inputs. A stage SHALL NOT obtain another stage's output by
reading shared run state.

#### Scenario: Stage input is an artifact reference

- **WHEN** a stage runs
- **THEN** every input it consumes is an artifact it declared, resolved by reference

#### Scenario: Run aggregate keeps its own role

- **WHEN** a run suspends and resumes
- **THEN** run status, transcript, events, approvals and the pending action resume
  from the run aggregate, which continues to own them

### Requirement: Lineage has two tiers

Stage-level envelopes SHALL record which run, revision and input snapshots produced a
stage output. Per-asset content hashes SHALL continue to record the inputs of an
individual generated asset. Neither SHALL be removed in favour of the other where
their granularity differs.

#### Scenario: Per-asset staleness still discriminates

- **WHEN** one section's visual inputs change and another's do not
- **THEN** only the affected section's assets are stale, and the unaffected section's
  assets remain reusable

#### Scenario: Stage lineage identifies the snapshot

- **WHEN** an artifact is inspected
- **THEN** it identifies the approved revision and external context snapshots the
  producing stage ran against

### Requirement: Artifacts and cursor persist atomically

Completing a stage SHALL mark its outputs complete and advance the cursor in one
atomic operation. While a stage commits, what it writes SHALL be in progress: saved
so a re-entered stage can reuse it, and not ready, so no other stage consumes it.

#### Scenario: Crash cannot split the write

- **WHEN** a process crashes while a stage is committing
- **THEN** the run resumes either with the stage's completed outputs and the advanced
  cursor, or at the same stage with only in-progress outputs — never with a
  completed output and an unadvanced cursor, or an advanced cursor without its
  outputs

#### Scenario: Progress is reused, not consumed

- **WHEN** a stage that crashed mid-commit is re-entered
- **THEN** it can reuse what it had already written, and no later stage receives
  those writes until the stage completes

### Requirement: External context is snapshotted at stage start

A stage SHALL capture the external context it declared it consumes when it begins,
and its artifacts SHALL record which snapshot was used.

#### Scenario: Context changes during an approval wait

- **WHEN** Project Materials or the selected timeline template change while a run
  waits for approval
- **THEN** the stage that already began continues against its captured snapshot, and
  its artifacts record that snapshot

#### Scenario: Staleness is determinable after the fact

- **WHEN** a completed run is inspected after its project's context has changed
- **THEN** the recorded snapshots identify which artifacts were produced against
  superseded context
