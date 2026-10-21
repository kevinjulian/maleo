# agent-document-merge Specification

## Purpose

Applies an agent run's generation output — content the run created or regenerated through its job — onto the editor document deterministically, without losing what the editor already holds. Edits to an existing timeline arrive as editor commands instead (`timeline-edit-commands`).

## Requirements

### Requirement: The agent merge is a callable, deterministic function

The system SHALL apply an agent run's output onto the editor document through an
exported function whose inputs are all parameters. It SHALL NOT read the clock to
generate ids; identifiers SHALL derive from a seed the caller supplies, so the
same input produces the same output.

#### Scenario: The merge runs in a test without the editor

- **WHEN** a test applies an agent job to a prior editor state
- **THEN** it calls the merge directly, without mounting the editor or its player

#### Scenario: The same input yields the same document

- **WHEN** the merge is applied twice to identical inputs with the same seed
- **THEN** both results are identical, including generated ids

### Requirement: Streaming and settled applications are distinguishable

The system SHALL treat a still-running agent job differently from a settled one:
a running job updates only the scenes, while a settled job also merges overlays,
infographics, audio and characters.

#### Scenario: A running job leaves overlays alone

- **WHEN** the merge is applied while the job is still running
- **THEN** scenes are updated and the other families are left as they were

### Requirement: Scene identity survives a merge

The system SHALL preserve a scene's local identity and the fields the agent did
not supply when merging its output, so an edit made in the editor is not lost to
a re-run.

#### Scenario: Fields the agent omits are kept

- **WHEN** an agent scene omits a field the editor's scene already carries
- **THEN** the existing value survives the merge

#### Scenario: A generated image is not duplicated

- **WHEN** an agent run returns scenes for a project that already has generated frames
- **THEN** each frame appears once

### Requirement: The merge is for generation output only

The agent merge SHALL apply only a run's generation output: content a run created or
regenerated through its job (story outline, frames, voiceover, and the other stages
that produce a plan rather than edit one). A run whose document changes were all made
by editing tools SHALL NOT be merged; it is applied from the commands it executed
(`timeline-edit-commands`). A run that did both SHALL be merged as a whole, and its
merged document SHALL already contain the effect of its editing commands, so they are
not applied a second time.

While a run has made only command edits, its live preview SHALL leave the editor
document unchanged; the document changes once, when the settled commands apply.

#### Scenario: An editing run bypasses the merge

- **WHEN** a run that only called editing tools settles
- **THEN** the merge is not invoked for it
- **AND** the editor applies the run's commands instead

#### Scenario: A mixed run merges once

- **WHEN** a run edits scene 2 through a command and then regenerates frames
- **THEN** the settled result is merged as generation output
- **AND** scene 2's edit appears once, and one undo reverses the whole application

#### Scenario: An editing run does not preview by rewriting the document

- **WHEN** a run that has so far only called editing tools reports progress
- **THEN** the editor document is unchanged until the run settles
