# Creative Direction

## Purpose

Free-text creative direction split into three routed channels (story, visual, voice) so a directive for one dimension reaches only its stage — planning/research, image generation, or voiceover.

## Requirements

### Requirement: Creative direction has three routed channels

The system SHALL model creative direction internally as routed story, visual, and voice channels plus the operator's original free text when needed for generation. User-facing UI SHALL expose this routing through Project Materials rather than a separate top-level Style or Creative Direction library surface.

Story material SHALL route to planning/research/narration. Visual material SHALL route to image generation and visual style summary. Voice material SHALL route to voiceover synthesis. Rules material SHALL route to every applicable stage as constraints.

#### Scenario: Channels are isolated per stage

- **WHEN** a video is planned and generated from Project Materials
- **THEN** the research/planning topic is derived from Story materials and the content subject only, and never contains visual-only or voice-only material text

#### Scenario: Visual and voice reach their stages

- **WHEN** an operator sets Visual and Voice materials
- **THEN** generated image prompts incorporate the Visual materials and voiceover synthesis incorporates the Voice materials

#### Scenario: Rules route as constraints

- **WHEN** Rules materials contain hard constraints
- **THEN** each applicable generation stage receives those constraints

### Requirement: Free-text direction is routed into channels

The system SHALL let an operator author material guidance as free text in the Project Materials drawer. The system SHALL route that guidance into Story, Visual, Voice, and Rules groups, preserving the original text when useful for traceability.

#### Scenario: Operator types mixed material guidance

- **WHEN** an operator types "calm hopeful tone, stickman on white background no humans, warm slow female narrator"
- **THEN** the router assigns tone/theme to Story, stickman/background text to Visual, narrator description to Voice, and "no humans" to Rules

#### Scenario: Operator corrects a mis-route

- **WHEN** the router assigns a phrase to the wrong material group and the operator edits the group
- **THEN** the edited group values are used for generation instead of the router's split

### Requirement: Research topic excludes visual and voice direction

The planning/research stage SHALL derive its topic from the content subject and the story channel only, so visual or voice directives cannot redirect research off the subject.

#### Scenario: Visual directive does not redirect research

- **WHEN** the visual channel contains image-generation directives (e.g. "stickman image, white background")
- **THEN** the research performed for the plan targets the content subject, not the image-generation directive

### Requirement: Direction travels as a structured field

The client SHALL send creative direction to the agent as a structured field, not merged into the content brief. The content brief SHALL NOT contain the visual or voice channel text.

#### Scenario: Brief stays content-only

- **WHEN** the client starts an agent run with creative direction set
- **THEN** the agent brief contains the content subject/story and the direction is delivered as a separate structured field

### Requirement: Presets carry creative direction

A Project Preset SHALL carry creative direction only as part of its Project Materials or material-derived summary. Applying a Project Preset SHALL seed those Materials into the project like the preset's other material groups.

#### Scenario: Preset seeds direction through materials

- **WHEN** a new project is created from a preset that defines visual, story, or voice direction
- **THEN** the new project receives that direction as Project Materials

### Requirement: Legacy reference prompt migrates to the visual channel

On load, an existing project's `projectReferences.prompt` SHALL be presented as Visual material when no richer Project Materials are present, so prior projects keep their visual guidance without polluting research.

#### Scenario: Legacy project opens

- **WHEN** a project saved with a `projectReferences.prompt` and no Project Materials is opened
- **THEN** that prompt becomes Visual material and the Story, Voice, and Rules groups start empty unless other persisted data supplies them
