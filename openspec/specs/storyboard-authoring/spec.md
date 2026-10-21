# storyboard-authoring Specification

## Purpose

Define direct storyboard creation and editing, revision conflict behavior, generated-media mapping, selected-beat assistance, and responsive access.

## Requirements

### Requirement: Storyboard exposes sequence direction on existing beat rows

Each directed beat row SHALL show editorial purpose, primary presentation, visual concept, novelty key, native on-screen text, infographic intent, SFX intent or silence, and containing-section emotion. These fields SHALL remain visibly associated with narration, references, and generated outputs.

Operators SHALL edit direction through the existing revision-checked storyboard command boundary and controller. The system SHALL NOT add a separate Director screen, local plan copy, or persistence route.

#### Scenario: Operator reviews direction before approval

- **WHEN** Storyboard loads a newly directed plan
- **THEN** each beat shows its editorial and audio decisions before asset approval
- **AND** silence is displayed as an intentional value rather than missing data

#### Scenario: Direction edit uses current revision

- **WHEN** operator edits a beat's presentation or SFX intent
- **THEN** existing controller submits `update_beat` with current revision
- **AND** server-confirmed draft becomes canonical

#### Scenario: Legacy beat stays usable

- **WHEN** Storyboard loads a beat without sequence direction
- **THEN** existing narration, visual intent, and media controls remain usable
- **AND** UI does not invent direction on read

### Requirement: Storyboard authoring has a revision-checked HTTP boundary

API SHALL expose project-scoped storyboard read, command, and approval operations over the latest typed storyboard document. Commands SHALL use the shared foundation reducer and expected draft revision. Successful mutations and approvals SHALL create a new storyboard version while preserving unrelated document fields. Conflict and invalid responses SHALL NOT write.

Read SHALL expose legacy plan content without persisting invented identity. First mutation or approval MAY canonicalize legacy identity according to the foundation contract.

Approval SHALL repair before it refuses: when the plan's direction is stale or in a needs-direction state that re-direction can clear, the approve operation SHALL re-run direction and then evaluate approval against the repaired plan. It SHALL refuse only what repair cannot clear. A refusal SHALL name the blocking condition in the form the blocker batch presents, so the operator is offered a remedy rather than a dead end.

#### Scenario: Read current storyboard draft

- **WHEN** Storyboard view loads or refreshes
- **THEN** API returns current draft and approval state from latest project storyboard
- **AND** returns generated plan sections grouped by semantic beat id separately from authored draft beats
- **AND** read alone creates no storyboard version

#### Scenario: Submit current-revision command

- **WHEN** client submits a typed command with current revision
- **THEN** API applies shared reducer and returns server-confirmed state
- **AND** latest typed document fields unrelated to story plan remain unchanged

#### Scenario: Submit stale command

- **WHEN** client submits a command with stale revision
- **THEN** API returns conflict with current server state
- **AND** creates no storyboard version

#### Scenario: Approve current draft

- **WHEN** client approves current draft with explicit extension policy
- **THEN** API records explicit approval snapshot for current revision
- **AND** returns approved server state

#### Scenario: Approve repairs stale direction

- **WHEN** client approves a draft whose direction inputs drifted since direction last ran
- **THEN** API re-runs direction and approves the repaired plan
- **AND** the operator is not asked to run anything first

#### Scenario: Approve refuses what repair cannot clear

- **WHEN** approval is blocked by a required reference with no roster entity
- **THEN** API refuses with that condition named as an open blocker
- **AND** the refusal carries the remedy the blocker batch presents

### Requirement: Operators can author storyboards directly

Storyboard view SHALL allow creation from empty project and direct add, edit, remove, reorder, split, merge, lock, unlock, and reference attachment for sections and semantic beats. It SHALL expose narration, visual intent, voice direction, pacing, and emotion without requiring chat.

#### Scenario: Empty project

- **WHEN** operator opens Storyboard with no plan
- **THEN** first section and beat can be created without chat

#### Scenario: Structural editing

- **WHEN** operator reorders, splits, or merges beat
- **THEN** view submits foundation command using stable ids and current revision

#### Scenario: Locked beat

- **WHEN** beat is locked
- **THEN** automatic assistance cannot rewrite it
- **AND** view offers explicit unlock

### Requirement: One controller owns storyboard client state

Editor SHALL have one storyboard controller owning server-confirmed plan/revision, selection, serialized command queue, pending state, error, conflict, and refresh. Components SHALL NOT persist independent plan copies.

Committed edits SHALL use shared reducer for optimistic preview and SHALL be replaced by server response. Only one structural command SHALL be in flight.

#### Scenario: Successful optimistic edit

- **WHEN** current-revision command is submitted
- **THEN** shared reducer previews result
- **AND** server result becomes canonical state

#### Scenario: Commands submitted quickly

- **WHEN** operator performs several structural actions
- **THEN** controller serializes them against confirmed revisions

### Requirement: Revision conflicts are explicit and non-merging

On conflict, controller SHALL stop unsubmitted structural commands, replace canonical plan with server-returned current revision, and show review/retry state. It SHALL NOT silently merge or replay structural edits. Local uncommitted field text MAY remain visible but SHALL NOT overwrite server state without retry.

#### Scenario: Structural conflict

- **WHEN** server rejects outdated reorder command
- **THEN** current server plan replaces optimistic structure
- **AND** queued structural commands stop

#### Scenario: Text conflict

- **WHEN** narration commit conflicts
- **THEN** server value remains canonical
- **AND** local typed value remains available for explicit retry

#### Scenario: Command attempted before conflict review

- **WHEN** operator submits another command while conflict state remains
- **THEN** controller refuses and settles command without network submission
- **AND** later refresh does not replay it

### Requirement: Beat rows map story intent to generated media

Each beat SHALL show narration, visual intent, voice direction, references, approval state, generated images, generated speech playback and duration, and stale state. When one semantic beat has several measured outputs, view SHALL group them under source beat without presenting them as separate authored beats.

#### Scenario: Generated current beat

- **WHEN** beat has current image and speech outputs
- **THEN** row reads both from generated plan sections grouped under semantic beat id
- **AND** shows both mapped to approved revision

#### Scenario: Stale outputs

- **WHEN** foundation reports beat outputs stale
- **THEN** row labels affected image/voice outputs stale
- **AND** existing previews remain available

#### Scenario: Several measured visuals

- **WHEN** semantic beat produces several measured visual outputs
- **THEN** row displays them as generated children of same beat

### Requirement: Chat assists selected stable beat

Storyboard SHALL pass selected beat id to chat rewrite, improve, and regenerate actions. Assistance SHALL target that id unless operator asks for broader revision. Direct authoring SHALL remain available when chat is unavailable.

#### Scenario: Improve selected beat

- **WHEN** operator selects beat and asks chat to improve it
- **THEN** request names stable beat id
- **AND** unrelated beats remain unchanged

#### Scenario: Chat unavailable

- **WHEN** chat cannot run
- **THEN** direct editing remains usable

### Requirement: Storyboard is responsive and accessible

All authoring actions SHALL have accessible names, keyboard operation, visible focus, and focus restoration after structural changes. Narrow layouts SHALL use one-column content and existing mobile control/sheet patterns without hiding approval, conflict, or stale state.

#### Scenario: Keyboard reorder

- **WHEN** keyboard operator moves beat
- **THEN** action completes and focus returns to moved beat

#### Scenario: Narrow viewport

- **WHEN** Storyboard opens at supported narrow viewport
- **THEN** story, image, and voice mapping remain readable
- **AND** primary actions remain reachable

### Requirement: Storyboard reuses design-system and UI-kit inventory

Storyboard SHALL use existing primitives and tokens. Missing reusable primitive SHALL enter existing UI-kit candidate inventory and Penpot publication workflow rather than being duplicated locally.

#### Scenario: Existing primitive fits

- **WHEN** Storyboard needs control already present in UI kit
- **THEN** it reuses that control

#### Scenario: Reusable primitive missing

- **WHEN** required pattern is reusable beyond Storyboard but absent
- **THEN** candidate is added to existing inventory and visualized for Penpot review

### Requirement: Storyboard edits reach a waiting approval

When a chat run is waiting on story-plan approval, answering that approval SHALL continue from the story plan the project holds, including edits made in the Storyboard view after the run began waiting. Persisting the run SHALL NOT replace the saved plan with the copy the run captured earlier.

#### Scenario: Plan edited while the run waits

- **WHEN** the user edits the plan in the Storyboard view and then answers the run's approval
- **THEN** the run continues from the edited plan
- **AND** the edit is not overwritten when the run saves

#### Scenario: Nothing saved

- **WHEN** no story plan is saved for the project
- **THEN** the run continues from the plan it holds
