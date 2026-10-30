# internal-agent-runtime Specification

## Purpose

How the project chat's agent runs: one Mastra agent on the selected API text
provider that chooses its tools, fixed production pipelines run as workflows,
domain preconditions that keep routing safe, the guardrails and durability a run
keeps across interruptions and human input, how generated media stays on the
durable media transport, and the MCP surface in both directions — the product's
tools served to MCP clients, and allowlisted external MCP servers consumed by the
agent. Introduced by `adopt-mastra-internal-agent`; see ADR 0006.

## Requirements

### Requirement: Mastra owns internal agent decisions and tool calls

The internal project-chat agent SHALL use one Mastra agent to choose and call tools. The application SHALL NOT retain an app-authored decide/execute cursor, a separate intent-classification call, or a pipeline cursor as a second active routing mechanism after cutover. Project chat SHALL remain one continuous conversation per project, with the existing run status and result contract.

#### Scenario: Agent selects a tool

- **WHEN** a project-chat command needs a callable tool
- **THEN** the Mastra agent selects and invokes a tool from the content type's visible registry
- **AND** the API records progress and result in the existing project chat/run contract

#### Scenario: Reload active chat

- **WHEN** the project reloads during or after an agent run
- **THEN** its transcript, active run, pending action, and settled result are restored under the same project chat

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

### Requirement: Domain preconditions enforce routing invariants

Invariants previously enforced by deterministic routing SHALL be enforced by the tool or workflow that performs the effect. A tool called in the wrong state SHALL return a typed refusal to the agent and SHALL NOT mutate project state or incur a charge.

#### Scenario: Approval after plan review

- **WHEN** the user approves after reviewing a story plan
- **THEN** assets are generated from that approved plan
- **AND** the plan is not re-planned or overwritten

#### Scenario: Generation without an approved plan

- **WHEN** the agent calls story asset generation and no approved plan exists
- **THEN** the call is refused with a reason the agent can act on

#### Scenario: Re-planning over approved work

- **WHEN** the agent calls `plan_story` while an approved plan exists and no edit approval was granted
- **THEN** the call suspends for the existing-edit approval instead of overwriting the plan

### Requirement: Loop guardrails are preserved

The agent SHALL preserve the current loop guardrails: a maximum step count after which the run is finalized by the existing exhausted-run finalization, including outcome evaluation; an outcome gate that rejects finishing a build request while blocker findings remain and returns those findings to the agent; an ask budget beyond which a question is skipped with a note to proceed, with the story-brief checkpoint exempt; and a final response recorded as the existing final event.

#### Scenario: Step limit reached

- **WHEN** a run reaches the maximum step count
- **THEN** it makes no further tool calls and is finalized with the outcome evaluation, so a build with blocker findings does not report success

#### Scenario: Finish with blocker findings

- **WHEN** the agent tries to finish a build request while the outcome evaluation reports blocker findings
- **THEN** the finish is rejected and the findings are returned to the agent as the next instruction

#### Scenario: Ask budget exhausted

- **WHEN** the agent asks the user a question after the ask budget is spent
- **THEN** the question is skipped with a note to proceed, and the run does not suspend

### Requirement: Tool calls preserve domain safety

Every Mastra tool call SHALL pass the existing tool input validation, project scope, approval, effect replay, and artifact application boundaries. Tool visibility SHALL preserve content-type restrictions and `plan_story` as the only public video planner. Mastra execution state SHALL NOT authorize a tool effect by itself.

#### Scenario: Invalid or out-of-scope call

- **WHEN** a model requests invalid arguments or a resource outside the active project
- **THEN** the call is rejected before a domain mutation or charge

#### Scenario: Edit requires approval

- **WHEN** a tool would change existing approved work
- **THEN** the current project approval gate suspends the run before that effect
- **AND** denial leaves the work unchanged

#### Scenario: Tool execution is retried

- **WHEN** durable execution retries a completed side-effect call after a crash
- **THEN** the recorded effect or generation job is reused
- **AND** the edit or charge is not duplicated

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

### Requirement: Selected provider remains authoritative

The agent SHALL honor the API-backed provider, model, and thinking level captured for its run. A new run SHALL capture an explicit submission selection, otherwise the conversation selection, otherwise the existing application default, and validate it before model execution or tool effects. Agent turns and nested text-generation calls SHALL use the captured selection across durable steps, retries, answers, and interruption recovery. An unavailable or incompatible selection SHALL fail visibly rather than silently fall back to another provider or billing mode. Usage and metering SHALL reflect the model actually used. Every environment SHALL run the same runtime; environments SHALL differ only in the selected model, and tests SHALL use a scripted model through that runtime.

Captured selection SHALL contain no credentials. Changes to conversation or application defaults SHALL NOT retarget an existing run. A run started before selection capture existed SHALL retain legacy resolution until it ends, with actual model usage recorded; the system SHALL NOT invent a historical model snapshot.

#### Scenario: Development uses the production runtime

- **WHEN** an agent run starts in development with a cheaper model selected
- **THEN** it executes the same agent, workflows, tools, guardrails, and suspension as production
- **AND** only the model differs

#### Scenario: Tests script the model

- **WHEN** a test drives an agent run with the scripted model
- **THEN** the run's tool calls, suspensions, and approvals happen deterministically with no network and no cost

#### Scenario: Selected provider unavailable

- **WHEN** the selected provider cannot perform the required agent operation
- **THEN** the run reports a provider error before a tool effect
- **AND** the selected provider is not silently changed

#### Scenario: Model incurs usage

- **WHEN** a model turn completes
- **THEN** the run records the actual model and token usage or its documented estimate for metering

#### Scenario: Agent invokes a nested planning workflow

- **WHEN** a run captured model A and its planning workflow issues a text-generation call
- **THEN** the agent and that call both use model A
- **AND** their usage records name the model that actually ran

#### Scenario: Parked run resumes after configuration changes

- **WHEN** a run captured model A, parked on a question, and a user selected model B before restart and resume
- **THEN** the resumed run uses model A if its configured provider remains compatible
- **AND** an unavailable or changed endpoint produces an explicit error instead of substitution

#### Scenario: Concurrent projects select different models

- **WHEN** project A starts with model A and project B starts with model B concurrently
- **THEN** each run and its nested text calls retain their own selection
- **AND** neither run changes process-wide selection state

#### Scenario: Legacy run resumes after upgrade

- **WHEN** an existing run without a captured selection resumes
- **THEN** it uses the prior resolution behavior and records actual usage
- **AND** newly started runs always capture a validated selection

#### Scenario: Existing active run is returned for a second submission

- **WHEN** a second submission is associated with an already active project run
- **THEN** the existing run retains its original captured selection
- **AND** the second submission cannot overwrite that selection

### Requirement: Generated media stays on durable media transport

Image and voice tools SHALL submit and poll through the existing `@maleo/media` worker transport. Media generation SHALL remain independently durable, attributed, and idempotent; Mastra SHALL not execute image or voice generation inline.

#### Scenario: Agent requests image or voice

- **WHEN** the agent calls a generated-media tool
- **THEN** the tool submits or reuses a media-worker job and observes its result
- **AND** the existing ledger and public/proxy URL behavior is preserved

#### Scenario: Agent retries during generation

- **WHEN** the agent run retries while a media job is queued or running
- **THEN** it reattaches to that job instead of submitting a duplicate generation

#### Scenario: Media generation fails

- **WHEN** the media worker reports a failed job
- **THEN** the agent tool reports failure, not a successful empty artifact

### Requirement: Project tools are served over MCP

The API SHALL serve an authenticated MCP endpoint exposing exactly these tools:

- Project resolution: `list_projects`, `get_project`.
- Read-only project state, offered only for projects of the matching content type: `view_timeline` (video), `view_carousel` (image), `view_thread` (text), and `read_skill`.
- Research, which changes no project state: `search_web`, `read_web_page`, `research_topic`.
- Direct edits: the registry tools of kind mutate or generate for the project's content type, each taking the project id with the tool's own input, and each executed as a single-tool run in the project chat.
- Agent delegation: `run_agent` (start an internal agent run in the project chat with an instruction and return its run id), `get_run` (status, progress events, pending action, result), `answer_action` (approve, deny, or answer a pending action by run and action id), and `cancel_run`.

A direct edit SHALL NOT run outside a run: it SHALL start a run in the project chat that executes only that tool call, under the same one-active-run rule, approval gates, per-entity fencing, metering, tracing, and editor apply path as any run. MCP tools SHALL be derived from the same tool table the internal agent uses and SHALL pass the same validation and project scope. `ask_user` and `finish` SHALL NOT be exposed, and workflows SHALL be reachable only through `run_agent`.

#### Scenario: Authorized client reads a project

- **WHEN** an authenticated MCP client lists projects and reads one
- **THEN** it sees only projects in its scope and only the read and edit tools for that project's content type
- **AND** each call is scoped and traced like an internal call

#### Scenario: Unauthenticated or cross-project call

- **WHEN** an MCP request lacks valid credentials or targets a project outside its scope
- **THEN** it is rejected before any read, mutation, or charge

#### Scenario: A direct edit runs as a single-tool run

- **WHEN** an MCP client calls a mutate tool on its project with valid arguments
- **THEN** a run that executes only that tool call appears in the project chat
- **AND** the change reaches the editor through the same apply path as an agent run, and the call returns the run id and the tool's result

#### Scenario: A direct edit of existing work waits for approval

- **WHEN** an MCP client calls a tool that changes existing work
- **THEN** the run parks on the existing-edit approval before anything changes, and the call returns the run id and the pending action
- **AND** the change is applied only after the matching `answer_action` approves it

#### Scenario: A direct edit while a run is active

- **WHEN** an MCP client calls a direct edit on a project that has an active run
- **THEN** the call is refused naming the active run, and nothing changes

#### Scenario: Client changes a project through the agent

- **WHEN** an MCP client calls `run_agent` with an instruction
- **THEN** an internal agent run starts in that project's chat and its run id is returned
- **AND** the run applies the same approvals, per-entity fencing, metering, and editor apply path as a run started in the product

#### Scenario: Client answers a pending action

- **WHEN** a run started through MCP awaits approval and the client calls `answer_action` with the matching run and action id
- **THEN** the action resolves once and the run continues
- **AND** a stale or mismatched action id changes nothing

#### Scenario: A coding-agent CLI drives the chat from a terminal

- **WHEN** Codex CLI or Claude Code, configured with a workspace MCP credential, calls `run_agent`, `get_run`, and `answer_action`
- **THEN** the run executes in the internal runtime with the selected API model
- **AND** appears live in the project chat in the web UI

#### Scenario: Direct mutating tool is not offered

- **WHEN** an MCP client lists tools
- **THEN** no mutate or generate tool is offered to run outside a run: each listed edit tool runs as a single-tool run in the project chat
- **AND** neither `ask_user` nor `finish`, nor any workflow, appears in the list

### Requirement: Agent consumes allowlisted external MCP servers

The internal agent SHALL be able to use tools from operator-configured MCP servers. Server configuration SHALL be stored per workspace with secrets encrypted at rest. Only tools on a server's allowlist SHALL be exposed to the model. External tool calls SHALL be traced and SHALL NOT mutate project state except through maleo's own tools. The BrowserOS research client SHALL use this path with its existing allowlist and research-only reach.

#### Scenario: Allowlisted external tool

- **WHEN** a configured server offers a tool on its allowlist
- **THEN** the agent can call it and the call is recorded in the run trace

#### Scenario: Unlisted external tool

- **WHEN** a configured server offers a tool not on its allowlist
- **THEN** the tool is not exposed to the model and cannot be called

#### Scenario: External server unavailable

- **WHEN** a configured MCP server cannot be reached
- **THEN** its tools are unavailable for that run and the run continues or reports the missing capability without failing unrelated work

### Requirement: Editing tools change the timeline through editor commands

The agent's video tools that edit an existing timeline — `update_scene`,
`remove_scene`, `set_clip_layout`, `set_keyframes`, and the placement of a text,
audio or overlay clip by `add_text`, `add_audio` and `add_overlay` — SHALL express
each change as editor commands of the vocabulary direct manipulation uses, executed
by the shared command executor against the run's document. Generating media for a
placement (`add_overlay` with a prompt) SHALL remain a generation step; only the
placement is a command. The agent SHALL NOT expose an `add_infographic` tool.

A tool SHALL address an entity by the same numbering `view_timeline` presents, and the
command it emits SHALL be the one the editor commits for the same change by hand,
including the scene's marker and `vis:` clips. Scenes keep the positions the editor
gave them: a duration change or removal moves no other scene, as it does not by hand. Tools that produce a plan from
nothing (story outline, frames, voiceover, sections, `add_scene`) SHALL keep writing
the run's job.

A settled run SHALL carry, in execution order, the commands its editing tools executed
when every document change it made came from those tools, and SHALL carry none
otherwise.

#### Scenario: An edit tool emits a command

- **WHEN** the agent calls `set_clip_layout` on text overlay 2
- **THEN** one clip update command for that overlay's clip is executed against the run's
  document and recorded on the run
- **AND** the next tool in the same run reads the overlay with its new layout

#### Scenario: A tool targets something that does not exist

- **WHEN** the agent calls `remove_scene` with an index outside the timeline
- **THEN** the tool returns an error naming the index
- **AND** no command is executed or recorded

#### Scenario: The executor refuses a command

- **WHEN** a command an editing tool built is refused by the executor
- **THEN** the run's document is unchanged, nothing is recorded, and the tool returns
  the refusal

#### Scenario: A retried tool call does not repeat its command

- **WHEN** durable execution retries an editing tool call that already completed
- **THEN** the recorded commands are reused
- **AND** the run carries that call's commands once

#### Scenario: A direct MCP edit settles as its command

- **WHEN** an MCP client calls `update_scene` as a direct edit and the run settles
- **THEN** the run carries exactly the commands that call executed
- **AND** the editor applies them as one undo step

#### Scenario: A generation stage keeps the job model

- **WHEN** a run calls `plan_story` or `generate_frame`
- **THEN** the run carries no commands and its result is applied as generation output

#### Scenario: The infographic tool is gone

- **WHEN** the agent's tool list is built for a video project
- **THEN** it contains no `add_infographic` tool
