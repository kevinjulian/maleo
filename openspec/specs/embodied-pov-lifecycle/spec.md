# embodied-pov-lifecycle Specification

## Purpose

TBD - created by archiving change improve-pov-lifecycle-planning. Update Purpose after archive.

## Requirements

### Requirement: Story plans carry embodied POV lifecycle metadata

Embodied POV SHALL be one selectable story arc, `pov_lifecycle`, rather than a mode inferred from topic words in the brief. When that arc is selected — by planner inference from a brief asking the viewer to inhabit a role, body, organism, object, creature, worker, survivor, or social position, or by an explicit caller request — the story plan SHALL carry embodied POV lifecycle metadata. The metadata SHALL describe the viewer role, world or system, social order, body constraints, sensory model, agency limits, survival goal, core fear, taboo or cost, transformation arc, and ending fate. Plans on other arcs SHALL remain valid without this metadata.

The system SHALL NOT gate embodied POV planning on matching the brief against a fixed word list. A caller SHALL be able to request the POV lifecycle arc for any brief, and the planner SHALL be able to decline it for a brief that merely mentions a POV topic word.

#### Scenario: Worker bee brief becomes embodied POV

- **WHEN** the user asks for "POV when we are born as a bee working for a queen until we die"
- **THEN** `plan_story` emits a `story_plan` on the `pov_lifecycle` arc with embodied POV lifecycle metadata for a worker bee
- **AND** the metadata includes bee-specific body constraints, colony hierarchy, queen pheromone control, survival work, short lifespan, and death or replacement

#### Scenario: Historical role brief becomes embodied POV

- **WHEN** the user asks for a second-person historical life story such as living as a Qing palace eunuch or Sengoku shinobi
- **THEN** the story plan carries embodied POV lifecycle metadata for the historical role
- **AND** the metadata describes status, system pressure, body cost, survival goal, and ending fate rather than only period style

#### Scenario: Non-POV explainer omits lifecycle

- **WHEN** the user asks for a normal explainer about bee colony organization
- **THEN** the story plan uses a non-POV arc and omits embodied POV lifecycle metadata
- **AND** the plan remains valid and renderable

#### Scenario: POV arc is requestable for any brief

- **WHEN** a caller explicitly requests the `pov_lifecycle` arc for a brief containing no POV topic words
- **THEN** the plan carries embodied POV lifecycle metadata

#### Scenario: Topic words do not force POV

- **WHEN** a brief mentions a POV topic word but asks for a different kind of video
- **THEN** the planner may select a non-POV arc
- **AND** the plan is not forced into embodied POV by the word match

### Requirement: Embodied POV sections progress through lifecycle stages

An embodied POV story plan SHALL assign each section a chapter function drawn from the `pov_lifecycle` arc's function vocabulary, explaining that chapter's job in the lived arc. That vocabulary SHALL be defined in the story arc library as one arc's functions rather than as a separate POV-only list. The sections SHALL progress through origin or birth, assigned role or training, work or first competence, danger or test, peak service or power, decay or consequence, and ending fate when duration allows. The planner MAY compress or omit stages for short beat videos, but it SHALL NOT repeat the same stage across adjacent sections without a changed status, problem, or consequence.

#### Scenario: Bee story follows full lifecycle

- **WHEN** a worker bee POV plan targets a multi-minute narrated video
- **THEN** sections progress from hatching in the comb through hive labor, first flight, foraging danger, queen/colony service, body exhaustion, and death
- **AND** adjacent sections do not have the same lifecycle stage and survival problem

#### Scenario: Short POV compresses lifecycle

- **WHEN** a POV story targets a short beat-driven video
- **THEN** the plan compresses the lifecycle into fewer sections
- **AND** each section still carries a distinct stage or irreversible consequence

#### Scenario: Stage vocabulary comes from the arc library

- **WHEN** POV lifecycle stages are resolved
- **THEN** they are read from the `pov_lifecycle` arc's function vocabulary in the story arc library
- **AND** they are not defined in a separate POV-only list

### Requirement: POV shots carry visual grammar for diversity

Each shot in an embodied POV section SHALL carry structured visual grammar with camera role, location, body action, prop or detail focus, emotional pressure, and novelty key. The camera role SHALL come from a closed vocabulary that supports human, animal, organism, object, and system POV scenes. The visual prompt SHALL remain pixel-facing prose derived from this grammar.

#### Scenario: Bee first-flight shots vary by grammar

- **WHEN** a bee POV section covers first flight or foraging
- **THEN** its shots include varied camera roles such as first-person body clues, environment establishing, object closeup, threat POV, and system view
- **AND** the shots vary location, body action, or prop/detail focus within the same section

#### Scenario: Historical palace shots vary by grammar

- **WHEN** a palace POV section covers service or intrigue inside one chapter
- **THEN** its shots do not repeat the same corridor portrait prompt
- **AND** at least some shots use different grammar such as hands/tools, overheard companion view, object evidence, reflection/shadow, or threat POV

### Requirement: Adjacent POV shots avoid same-chapter repetition

For embodied POV sections with multiple shots, adjacent shots SHALL NOT share the same camera role, normalized location, and normalized body action. Sections with at least four shots SHALL include at least three distinct camera roles or two distinct camera roles plus a distinct object/detail focus. If a draft violates these rules, the planner or repair step SHALL revise the shot plan before images are generated.

#### Scenario: Repeated bee comb shots are repaired

- **WHEN** a bee POV section produces adjacent shots that all show the same bee inside the same honeycomb doing the same action
- **THEN** the system revises the shot plan before image generation
- **AND** the revised shots change camera role, location, body action, or prop/detail focus

#### Scenario: Similar prompts are not sent to image generation

- **WHEN** embodied POV shot grammar fails the adjacent-shot repetition rule
- **THEN** image generation does not submit those repeated prompts as-is
- **AND** the user-visible plan or test output identifies that the shots were repaired or rejected

### Requirement: POV lifecycle is reviewable in the story plan

The web story plan review surface SHALL show a compact embodied POV lifecycle summary when the plan carries it. The summary SHALL include the viewer role, body constraints, system pressure, survival goal, and ending fate. Section rows or detail views SHALL expose lifecycle stage and shot diversity cues enough for users to understand why one chapter's images will differ.

#### Scenario: Bee lifecycle is visible before approval

- **WHEN** a worker bee POV plan is generated
- **THEN** the story plan card shows the viewer role as worker bee and summarizes colony pressure, body constraints, and ending fate
- **AND** users can see section lifecycle stages before approving asset generation

#### Scenario: Plans without lifecycle render normally

- **WHEN** a story plan has no embodied POV lifecycle metadata
- **THEN** the story plan card renders without lifecycle UI
- **AND** existing story plans do not crash or require migration
