# content-type-availability Specification

## Purpose

Defines which project types can be created and which carry AI assistance, how legacy image and text projects behave once their AI is retired, and the one-time removal of their stored agent history.

## Requirements

### Requirement: Only video projects can be created

The create flow SHALL offer video as the only project type. The API SHALL refuse to create a project, or change an existing project's type, to `image` or `text`. The one-shot generation endpoint, which no client calls once image and text are retired, SHALL NOT exist. Refusals SHALL be explicit validation errors and SHALL NOT create rows, runs, media or charges.

#### Scenario: Create flow offers video only

- **WHEN** a user opens the create flow
- **THEN** video is the only project type offered
- **AND** no image or text option, preset picker or copy for those types is shown

#### Scenario: API refuses an image project

- **WHEN** a client requests a new project of type `image` or `text`
- **THEN** the API returns a validation error naming the allowed type
- **AND** no project is stored

#### Scenario: API refuses retyping

- **WHEN** a client patches an existing project's type to `image` or `text`
- **THEN** the API returns a validation error and the project is unchanged

#### Scenario: One-shot generation is gone

- **WHEN** a client calls `POST /generate` on the operations API
- **THEN** the API answers not found and incurs no generation or charge

### Requirement: Legacy image and text projects are manual editors

Existing image and text projects SHALL remain listed, openable and editable by hand: slides, captions, posts, references and layout keep working and saving. They SHALL offer no AI: no chat panel, quick commands, agent context, or per-slide or per-post image generation. The project chat endpoint SHALL refuse runs for these projects without starting an agent, workflow or charge.

#### Scenario: Open a legacy carousel

- **WHEN** a user opens an existing image project
- **THEN** its slides and captions load and remain editable and saveable
- **AND** no chat panel, chat toggle or generate-image action is present

#### Scenario: Open a legacy thread

- **WHEN** a user opens an existing text project
- **THEN** its posts load and remain editable and saveable
- **AND** no chat panel, chat toggle or generate-image action is present

#### Scenario: Chat request for a legacy project

- **WHEN** a client posts a chat instruction to an image or text project
- **THEN** the API refuses with an explicit unsupported-type error
- **AND** no run, pending action, durable workflow or charge is created

#### Scenario: MCP refuses a legacy project

- **WHEN** an MCP client calls `run_agent`, a research tool, a read or an edit for an image or text project
- **THEN** the call returns a tool error and starts no run
- **AND** `get_project` lists no reads or edits for that project

#### Scenario: Previously generated media survives

- **WHEN** a legacy project shows a slide or post image an earlier agent run generated
- **THEN** the image still loads from its stored media

### Requirement: Legacy agent history is removed once

A one-way, versioned migration SHALL delete stored agent history for every image and text project: chat transcripts held in editor state, and agent runs with their steps, tool calls and pending actions. Durable execution state belonging to those runs SHALL NOT be resumable afterwards and SHALL be removed by the existing scheduled execution-state expiry within its normal retention window. It SHALL keep projects, their slides and posts, generated media and its records, and credit and usage records. It SHALL run once, be recorded like every other schema migration, and touch no video project.

#### Scenario: Migration clears legacy chat and runs

- **WHEN** the migration runs on a database with image and text projects that have chat and runs
- **THEN** those projects have no chat transcript, agent runs, steps, tool calls or pending actions afterwards
- **AND** none of their former runs can be resumed
- **AND** their slides, posts and referenced media are unchanged

#### Scenario: Video projects untouched

- **WHEN** the migration runs
- **THEN** every video project's chat, runs and durable execution state are unchanged

#### Scenario: Billing history retained

- **WHEN** the migration runs
- **THEN** credit transactions and usage records from legacy runs remain
