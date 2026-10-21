# Video Plan Kinds Specification

## Purpose

Define the supported video story plan kinds and the reviewable fields that guide planning, rendering, and media generation without multiplying public planning tools.

## Requirements

### Requirement: Story plans carry a video plan kind

The video story plan SHALL carry a `planKind` selected from `story`, `explainer`, `product`, `tutorial`, `documentary`, `listicle`, and `comparison`. The planner SHALL infer the kind from the brief unless the user or caller explicitly requests one. The plan kind SHALL be produced by the planning frame stage, alongside the arc, narration language, and engagement spine, before any narration is drafted.

Each plan kind SHALL name a default story arc, used when arc inference yields nothing usable. A plan kind's default arc SHALL NOT override an explicitly requested arc.

#### Scenario: Planner infers explainer kind

- **WHEN** a user asks for a video explaining a social-science, psychology, learning, or concept topic in the style of a clear educational lesson
- **THEN** `plan_story` emits a `story_plan` with `planKind: "explainer"`
- **AND** it remains the same artifact type used for narrative stories

#### Scenario: Explicit kind wins

- **WHEN** the user explicitly asks for a tutorial, product demo, documentary, listicle, comparison, explainer, or story
- **THEN** the story plan records the matching `planKind`
- **AND** duration or structure selection does not overwrite that explicit plan kind

#### Scenario: Existing plans default safely

- **WHEN** a persisted story plan has no `planKind`
- **THEN** loading the plan treats it as `story`
- **AND** no existing project fails to render because the field is absent

#### Scenario: Plan kind is decided before narration

- **WHEN** the planning frame stage completes
- **THEN** the plan kind is already resolved
- **AND** no narration has been drafted

#### Scenario: Plan kind supplies a default arc

- **WHEN** arc inference yields nothing usable for a given plan kind
- **THEN** the plan carries that plan kind's default arc

#### Scenario: Default arc does not override an explicit arc

- **WHEN** a caller requests an arc explicitly
- **THEN** the plan kind's default arc is not applied

### Requirement: Explainer plans carry a learning contract

For `planKind: "explainer"`, the story plan SHALL carry an explainer contract with learning objective, core question, misconception, concept ladder, evidence moment, transfer takeaway, and visual grammar. These fields SHALL be derived from the brief and SHALL describe the lesson being taught, not generic placeholder text.

#### Scenario: Sprouts-style brief becomes explainer contract

- **WHEN** the user asks for a Sprouts-style video explaining attachment theory, the Pygmalion effect, or study science
- **THEN** the story plan includes an explainer contract tailored to that topic
- **AND** the contract includes a concrete learning objective, a curiosity question, and an evidence or example moment

#### Scenario: Explainer fields vary by topic

- **WHEN** two unrelated explainer briefs are planned
- **THEN** their learning objective, core question, misconception, concept ladder, evidence moment, transfer takeaway, and visual grammar differ
- **AND** each set refers to its own topic

#### Scenario: Non-explainer plans do not require explainer fields

- **WHEN** a product, tutorial, documentary, listicle, comparison, or narrative story plan is generated
- **THEN** the plan may omit the explainer contract
- **AND** absence of the explainer contract does not make the plan invalid

### Requirement: Explainer sections carry teaching moves

Sections in an explainer story plan SHALL carry a teaching move that identifies the section's pedagogical job, such as defining, comparing, demonstrating, applying, recapping, or transitioning. The teaching move SHALL guide narration and visual planning while preserving the section's existing narrative and visual fields.

#### Scenario: Concept ladder maps to sections

- **WHEN** an explainer plan uses a concept ladder
- **THEN** its sections progress through teaching moves that match the ladder
- **AND** each section has a narrative or learning job traceable to the brief

#### Scenario: Teaching move does not replace visual prompt

- **WHEN** an explainer section carries a teaching move
- **THEN** the section still carries pixel-facing visual prompt text
- **AND** asset generation can create visuals without reading the teaching move as provider prompt text

### Requirement: Plan kind is renderable without becoming a setup blocker

The client SHALL be able to render `planKind` and explainer contract fields in the story plan card. The first implementation pass SHALL NOT require a setup-screen picker before planning can run.

#### Scenario: Plan card shows automatic kind

- **WHEN** planning completes with any supported `planKind`
- **THEN** the story plan card renders the kind as part of the reviewable plan
- **AND** no separate setup selection is required to reach that state

#### Scenario: Explainer summary is visible

- **WHEN** an explainer story plan is rendered
- **THEN** the card shows the learning objective, core question, and concept ladder summary
- **AND** approval still refers to the same story plan artifact

### Requirement: Embodied POV mode does not add a public plan kind

Embodied POV lifecycle planning SHALL be represented as optional story-plan metadata, not as a new public video plan kind and not as a separate public planning tool. The supported `planKind` values SHALL remain `story`, `explainer`, `product`, `tutorial`, `documentary`, `listicle`, and `comparison`.

#### Scenario: Bee POV uses existing plan kind

- **WHEN** the user asks for a worker bee lifecycle POV video
- **THEN** `plan_story` emits a normal `story_plan` with an existing `planKind`
- **AND** embodied POV lifecycle metadata is present as optional plan context

#### Scenario: Historical POV can be documentary or story

- **WHEN** the user asks for a historical POV life simulation
- **THEN** the plan may use `planKind: "story"` or `planKind: "documentary"` based on the brief
- **AND** it does not emit `planKind: "pov"` or require a `plan_pov` tool

#### Scenario: Invalid POV kind is rejected

- **WHEN** `plan_story` receives `planKind: "pov"`
- **THEN** argument validation rejects the call
- **AND** no story plan is persisted from that invalid call
