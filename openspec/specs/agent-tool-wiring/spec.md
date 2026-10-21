# agent-tool-wiring Specification

## Purpose

TBD - created by archiving change consolidate-agent-path-seams. Update Purpose after archive.

## Requirements

### Requirement: A tool definition names the service it calls

A tool definition SHALL reach its implementation by importing it. The dependency SHALL be
readable at the tool definition without consulting another file. No capability object,
flow bag, or injected lookup table SHALL stand between a tool handler and the service it
invokes.

#### Scenario: Reading a tool tells you what it runs

- **WHEN** a reader opens a tool definition file
- **THEN** the service the handler calls is named in that file's imports
- **AND** finding it does not require a lookup in a separate registry of capabilities

#### Scenario: No capability bag is satisfied anywhere

- **WHEN** the agent tool layer is inspected
- **THEN** no interface enumerating the tool layer's callable services exists
- **AND** no module constructs an object forwarding its arguments unchanged to symbols it
  already imports

### Requirement: The tool layer and the service layer do not import each other

Shared values that both tools and services need — constants, id helpers, argument schemas,
media helpers — SHALL live outside the tool layer. A service SHALL NOT import from the tool
layer, so that a tool importing a service forms no cycle.

The capability indirection existed because a services-to-tools edge made the reverse edge a
cycle. Removing the edge, rather than routing around it, is what makes the indirection
unnecessary.

#### Scenario: Shared helpers are not tools

- **WHEN** a service needs a constant, an id helper or an argument schema that a tool also uses
- **THEN** it imports it from a shared module that is not part of the tool layer

#### Scenario: The dependency runs one way

- **WHEN** the agent module's import graph is inspected
- **THEN** tools import services and services do not import tools

### Requirement: The tool context carries the run, not the system's capabilities

The context passed to a tool handler SHALL carry the job being run, the tool call identity,
and value-coercion helpers. It SHALL NOT carry the system's generation, style or orchestration
capabilities.

#### Scenario: A handler receives only what identifies the call

- **WHEN** a tool handler is invoked
- **THEN** its context provides the job and the tool call id
- **AND** it provides no callable generation, style or flow capability

### Requirement: Video plan kinds do not add public planning tools

The agent tool layer SHALL keep `plan_story` as the only public video planning tool. Video plan kinds SHALL be represented as data accepted by and emitted from that tool, not as separate callable planning tools.

#### Scenario: Planner sees one video planner

- **WHEN** the video agent builds the callable tool list
- **THEN** the list includes `plan_story`
- **AND** it contains no `plan_explainer`, `plan_product_video`, `plan_tutorial`, `plan_documentary`, `plan_listicle`, or `plan_comparison` tool

#### Scenario: Explicit plan kind uses same tool

- **WHEN** the user asks for a Sprouts-style explainer, product demo, tutorial, documentary, listicle, comparison, or narrative story
- **THEN** the agent still uses `plan_story`
- **AND** the requested kind is passed or inferred as plan-kind data

### Requirement: Plan-kind tool schema accepts explicit kind

The `plan_story` input schema SHALL allow callers to request a supported plan kind explicitly while keeping `auto` or omission as the default inference path. The schema SHALL accept an arc argument on the same terms: a supported arc name requests that arc explicitly, and `auto` or omission defers to planner inference.

Arc and plan kind SHALL resolve independently. Requesting one SHALL NOT constrain the other beyond the plan kind's default arc applying only when arc inference yields nothing usable.

#### Scenario: Omitted kind is inferred

- **WHEN** `plan_story` is called without a plan-kind argument
- **THEN** the planner infers the kind from the brief
- **AND** the emitted story plan records the inferred kind

#### Scenario: Invalid kind is rejected before execution

- **WHEN** `plan_story` receives a plan-kind value outside the supported set
- **THEN** argument validation rejects the call
- **AND** no story plan is persisted from that invalid call

#### Scenario: Omitted arc is inferred

- **WHEN** `plan_story` is called without an arc argument
- **THEN** the planner infers the arc
- **AND** the emitted story plan records the inferred arc

#### Scenario: Explicit arc is recorded

- **WHEN** `plan_story` receives a supported arc name
- **THEN** the emitted story plan records exactly that arc

#### Scenario: Invalid arc is rejected before execution

- **WHEN** `plan_story` receives an arc value outside the supported set
- **THEN** argument validation rejects the call
- **AND** no story plan is persisted from that invalid call

#### Scenario: Arc and kind resolve independently

- **WHEN** `plan_story` receives an explicit arc and an explicit plan kind
- **THEN** the plan records both as requested
- **AND** neither overrides the other

### Requirement: Story planning is one tool over one flow

The agent tool layer SHALL expose exactly one story planning tool for video content. That tool SHALL plan directly rather than delegate to another planning flow, so that one exposed tool corresponds to one planning implementation and one plan artifact.

#### Scenario: Agent sees one story planner

- **WHEN** the video agent builds the callable tool list for a planning run
- **THEN** the list includes `plan_story`
- **AND** the list contains no other tool that produces a video plan

#### Scenario: The planning tool does not delegate to a second flow

- **WHEN** `plan_story`'s handler runs
- **THEN** it produces the story plan itself
- **AND** it does not call a separate short-form or longform planning flow to do so

#### Scenario: Structure is data on one artifact

- **WHEN** a short beat-structure story and a multi-minute narrated story are both planned
- **THEN** both produce the same plan artifact type
- **AND** they differ by recorded structure, section count, word budget, and shots per section
- **AND** both are generated by the same asset generation tool

### Requirement: Superseded planning tools are deleted

The superseded planning tools and their artifact type SHALL be removed from the codebase rather than hidden from the agent. Retaining an unreachable tool that the registry filters out leaves two implementations of one concept.

#### Scenario: Superseded tools no longer exist

- **WHEN** the agent tool registry is inspected
- **THEN** no tool named `plan_video`, `plan_longform`, `update_blueprint_beat`, or `generate_video_assets` is defined
- **AND** no `video_blueprint` artifact kind is produced

#### Scenario: No hidden-tool filter remains

- **WHEN** the tool list for the video content type is built
- **THEN** it is not produced by excluding named legacy tools from a larger list

### Requirement: Persisted plans from before the rename still load

Chat artifacts persisted under the pre-rename artifact kind SHALL be normalized when a job's artifacts are read, so that runs recorded before this change keep rendering their plan.

#### Scenario: A legacy persisted plan renders

- **WHEN** a persisted job carries an artifact recorded as `kind: "longform_plan"`
- **THEN** loading that job yields a story plan artifact
- **AND** the client renders it as a story plan rather than an empty message

#### Scenario: Nothing writes the legacy kind

- **WHEN** a new planning run persists its plan
- **THEN** the recorded artifact kind is the story plan kind
- **AND** the legacy kind is only ever read, never written

### Requirement: The decision prompt names only callable tools

The routing guidelines composed into the agent decision prompt SHALL name only tools present in the decision enum for that content type. The decision schema is built as a strict enum over the registry's visible tool names, so prose naming an absent tool causes the model's obedient response to fail parsing.

#### Scenario: Guidelines and registry agree

- **WHEN** the video routing guidelines are composed into the decision prompt
- **THEN** every tool name they mention is in the callable tool list for video content
- **AND** the guidelines direct new video planning to the single story planning tool

#### Scenario: Drift is caught by a test

- **WHEN** a tool is renamed or removed from the registry but left named in the routing guidelines
- **THEN** a test fails identifying the tool name that no longer resolves

### Requirement: The agent writes keyframes as editor commands

The agent tool layer SHALL expose a keyframe tool that takes a clip reference, a property, and a list of keys in clip-local seconds with interpolation. It SHALL emit the property-track replacement command defined by `keyframe-animation`. The tool SHALL be available to the editing agent and over MCP like the other edit tools. Invalid input SHALL return a tool error naming the problem and SHALL NOT change the document. A semantic request such as a timed zoom SHALL be realised as ordinary keys visible on the timeline.

#### Scenario: Chat zoom becomes timeline keys

- **WHEN** a user asks the agent to slowly scale up the image in scene 3 from 2 s to 5 s
- **THEN** that visual's scale track has keys at 2 s and 5 s with an ease, visible as a key lane and undoable as one step

#### Scenario: Agent key outside the clip

- **WHEN** the agent requests a key at 9 s on a 6-second clip
- **THEN** the tool returns an error naming the clip's duration and the document is unchanged
