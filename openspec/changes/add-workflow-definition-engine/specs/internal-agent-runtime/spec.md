# Spec Delta

## MODIFIED Requirements

### Requirement: Fixed production pipelines run as workflows

Video planning and story asset generation SHALL run as workflows exposed to the agent as tools; they are the only fixed production pipelines, and the agent SHALL be offered them only for video projects. Video planning SHALL run as a workflow definition on the workflow engine inside the agent's tool call; story asset generation SHALL run as a Mastra workflow until it is ported to a definition. The agent SHALL decide whether a pipeline runs; the workflow SHALL decide its stage order. A pause inside a pipeline SHALL suspend the agent tool call at the node or step that needs input, and resume SHALL continue at that node or step without re-running completed work or re-routing the request.

#### Scenario: Agent starts a pipeline

- **WHEN** the agent calls a pipeline tool
- **THEN** the workflow runs its stages in their defined order
- **AND** stage progress is reported through the existing project chat progress

#### Scenario: Pipeline pauses for clarification

- **WHEN** video planning needs clarification after research
- **THEN** the planning workflow suspends at its question node with a pending action tied to the run
- **AND** an answer resumes that node without repeating the frame or research nodes

#### Scenario: Pipeline pauses for plan approval

- **WHEN** story asset generation reaches plan approval
- **THEN** the workflow suspends until the user approves, partially approves, or denies
- **AND** denial generates no assets and incurs no media charge

#### Scenario: No pipeline for retired content types

- **WHEN** the runtime lists the workflows a run may start
- **THEN** no carousel or thread build workflow is registered or offered
- **AND** a run for an image or text project is never started

### Requirement: Agent runs survive interruptions and human input

An active run SHALL survive API restart or redeploy without losing its durable progress or replaying settled tool effects, including when suspended inside a workflow called as an agent tool. A pending question/approval SHALL remain tied to its run and action id. Runs SHALL preserve existing cancellation, input timeout, retry, and one-active-run-per-project behavior. Runs suspended under a workflow runtime or checkpoint format that a deploy removed are not supported: an answer to such a run SHALL end it in an error state or leave it to the input timeout, and SHALL NOT be translated into the new runtime.

#### Scenario: Backend restarts mid-run

- **WHEN** the API process restarts after a tool completes but before the run ends
- **THEN** the same run resumes from durable state
- **AND** the completed tool effect is not repeated

#### Scenario: Backend restarts during a nested suspension

- **WHEN** the API process restarts while a workflow called by the agent is suspended
- **THEN** an answer resumes that same workflow node or step in the same run
- **AND** work completed before the suspension is not repeated

#### Scenario: Second run for the same project

- **WHEN** a run is started while another run for the same project is active
- **THEN** the second run does not execute concurrently with the first

#### Scenario: User answers pending action

- **WHEN** a run awaits a question or approval and receives an answer matching its run and action id
- **THEN** that action resolves once and the same run continues

#### Scenario: Stale answer arrives

- **WHEN** an answer names an old or different action id
- **THEN** it does not resume or mutate the current run

#### Scenario: Run is cancelled or times out

- **WHEN** a run is cancelled or its pending-input window expires
- **THEN** it reaches the corresponding terminal state and later input cannot revive it

#### Scenario: Run suspended under a removed runtime

- **WHEN** a run that suspended before a deploy removed its workflow runtime receives an answer
- **THEN** the run ends in an error state or times out
- **AND** no planning or generation work is executed for it
