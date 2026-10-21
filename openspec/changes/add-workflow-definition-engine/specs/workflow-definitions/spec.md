# Spec Delta

## Purpose

Runs AI video workflows from validated plain-data definitions through one engine, so the definition the explorer shows is the definition the run executes, and so definitions can later be edited, versioned and pinned without code changes.

## ADDED Requirements

### Requirement: Workflows are validated data run by one engine

A production workflow SHALL be a plain serializable definition built only from the node types `step`, `sequence`, `branch`, `suspend`, `call` and `end`. A step MAY declare that a failure continues the workflow. Every node SHALL have an identifier unique within its definition. The engine SHALL execute a definition exactly as written and SHALL NOT consult any other description of the workflow's order, branching or prompts. A definition SHALL be rejected at load, before any run starts, when it uses an unknown node type, references an unregistered operation, rule, fact, prompt, tool or workflow, repeats a node identifier, calls itself directly or indirectly, or uses the reserved `forEach` type.

#### Scenario: Definition references an unregistered operation

- **WHEN** a definition names an operation that no code registers
- **THEN** loading fails with an error naming the definition and node
- **AND** no run of that workflow starts

#### Scenario: Reserved node type is used

- **WHEN** a definition contains a `forEach` node
- **THEN** loading fails stating that the node type is not yet supported

#### Scenario: Definition is edited

- **WHEN** a developer reorders two steps in a definition
- **THEN** the next run executes the new order with no other file changed

### Requirement: Conditions are data expressions over declared inputs

Branch conditions and suspension skip conditions SHALL be data expressions using only `eq`, `in`, `exists`, `empty`, `and`, `or` and `not`, over the workflow input, the run's flow state and registered facts, or a reference to a registered named rule. Facts and rules SHALL be read-only projections registered in code. An expression SHALL NOT read the run record directly. Evaluating a condition SHALL have no side effect.

#### Scenario: Condition reads flow state

- **WHEN** a branch tests that research was needed and no research is held
- **THEN** the engine evaluates the expression against flow state and takes the matching path

#### Scenario: Condition needs logic the operators cannot express

- **WHEN** a condition needs code, such as whether an approved plan exists
- **THEN** the definition references a registered named rule by identifier
- **AND** the rule's identifier appears in the definition rather than its code

### Requirement: Operations run only with declared capabilities

An operation SHALL be registered code with an identifier, an input schema, an output schema, and a declared list of the prompts, tools and capabilities it may use. Capabilities SHALL distinguish model text calls from media generation. The engine SHALL validate an operation's input before it runs and its output before the output is written to flow state. A model request with an undeclared prompt, an undeclared tool call, or an undeclared capability made while the operation runs SHALL fail that operation before the request is sent or charged.

#### Scenario: Operation renders an undeclared prompt

- **WHEN** an operation sends a model request for a prompt it did not declare
- **THEN** the request is refused before it reaches the provider
- **AND** no charge is recorded

#### Scenario: Operation output violates its schema

- **WHEN** an operation returns a value that fails its output schema
- **THEN** the node fails and flow state is not updated with that value

### Requirement: Definitions load through one registry and runs are pinned

Definitions SHALL be obtained only through one registry interface that returns a definition and its content revision. The revision SHALL change whenever any part of the definition changes. A run SHALL record the definition snapshot and revision it started on and SHALL execute that snapshot until it ends, including after suspension and resume.

#### Scenario: Definition changes while a run is suspended

- **WHEN** a run is suspended and the registry later returns a different revision of its workflow
- **THEN** the resumed run continues on the snapshot it recorded
- **AND** a new run uses the new revision

#### Scenario: Run revision is inspected

- **WHEN** an operator reads a run's flow record
- **THEN** it names the workflow identifier and the revision the run started on

### Requirement: Completed nodes are durable and never repeated

After each node completes, the engine SHALL persist the run's cursor and flow state in the same write as the run record. When a run resumes after suspension, restart or retry, nodes recorded as completed SHALL NOT run again. A node interrupted before its checkpoint MAY run again; its model and media generations SHALL use keys derived from the run, the agent tool call and the node identifier, so a repeated generation is charged once and reuses the attempt already made.

#### Scenario: Process dies after research completes

- **WHEN** the process stops after the research node checkpointed and before drafting
- **THEN** the retried run starts at drafting
- **AND** framing and research are not called again

#### Scenario: Process dies during a model call

- **WHEN** the process stops while a node's billed model call is in flight
- **THEN** the retried node's call uses the same generation key
- **AND** the credit ledger records one charge

### Requirement: Suspension is a saved cursor tied to one pending action

A `suspend` node SHALL run its declared ask operation, which records exactly one pending action, persist the cursor at that node, and suspend the calling agent tool. An answer accepted for that pending action SHALL resume the same run at the same node, pass the answer to the node's declared answer operation, and continue with the next node. A suspend node SHALL be skipped without asking when its skip condition holds. Cancellation SHALL be checked before every node; a cancelled run SHALL execute no further node.

#### Scenario: User answers a suspended question

- **WHEN** a run suspended at a question node receives an answer matching its pending action
- **THEN** the answer operation runs and execution continues after that node
- **AND** no node before it runs again

#### Scenario: Approve-all is already granted

- **WHEN** a run reaches an approval node whose skip condition holds because the user approved all
- **THEN** no pending action is created and execution continues

#### Scenario: Run is cancelled while a node is executing

- **WHEN** a user stops a run during one node
- **THEN** no later node starts

### Requirement: Workflows compose by call and end explicitly

A `call` node SHALL run another registered workflow with an explicit input mapping, as part of the same run, cursor and pending-action identity. An `end` node SHALL finish its workflow with an explicit outcome. When a called workflow ends, its outcome SHALL be the `call` node's output.

#### Scenario: Two tools share one planning definition

- **WHEN** both the planning tool and the one-shot build tool run planning
- **THEN** both call the same planning workflow definition
- **AND** a change to that definition changes both

#### Scenario: Workflow ends early

- **WHEN** a branch reaches an `end` node
- **THEN** no later node in that workflow runs and the stated outcome is returned

### Requirement: Best-effort steps are explicit

A step declared to continue on error SHALL record its failure in the run trace and let the workflow continue with the step's output absent. A step without that declaration SHALL fail the workflow when it fails.

#### Scenario: Style generation fails

- **WHEN** the best-effort style step fails
- **THEN** the trace records the failure
- **AND** the plan is still drafted and saved without a generated style

### Requirement: Runs record a per-node trace

Every node the engine enters SHALL produce a trace entry keyed by run and node identifier, recording the definition revision, start and end time, outcome (completed, skipped, suspended, failed or continued after failure), the branch taken, and the prompts and tools the node used. Traces SHALL contain no credentials. They SHALL be readable for the run's lifetime.

#### Scenario: Branch not taken

- **WHEN** a run skips research because the frame did not ask for grounding
- **THEN** the trace records the branch outcome and no entry for the research step

#### Scenario: Suspended node

- **WHEN** a run suspends at a question node
- **THEN** the node's trace entry is marked suspended with its pending action identifier

### Requirement: Video planning is defined as data

`plan_story` SHALL be a workflow definition that runs, in order: duration resolution; a guard that asks before replacing an approved plan and ends without planning if the user rejects; routing of free-text direction when needed; the pre-research clarification checkpoint or its recorded bypass; and a call to the planning core. The planning core SHALL be a definition that preserves generated work, frames the story, retrieves research only when the frame asks for grounding and none matching is held, asks post-research questions unless the request bypassed questions, drafts, materializes sections, resolves the visual style when no style image is selected, authors the story bible, and saves the plan. Generating no media, the rendered prompts, the questions asked, and the saved plan SHALL match the behavior before the port for the same inputs and provider responses.

#### Scenario: Post-research answer

- **WHEN** planning suspends after research and the user answers
- **THEN** drafting receives the answer
- **AND** framing and research are not repeated

#### Scenario: Request bypasses questions

- **WHEN** the instruction asks to skip questions or build in one shot
- **THEN** neither pre-research nor post-research questions are asked
- **AND** the bypass is recorded in the plan's clarification provenance

#### Scenario: Plan already has generated sections

- **WHEN** planning runs while the plan has generated sections
- **THEN** it ends with the not-re-planning note and no frame or draft call is made
