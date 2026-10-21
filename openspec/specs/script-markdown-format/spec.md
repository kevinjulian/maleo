# script-markdown-format Specification

## Purpose

The script's wire format: Markdown with frontmatter, chapter headings, and labelled AUDIO/VISUAL blocks. A scene's positional label and its stable identity are separate things, and an import matches on the identity — which is what lets a script be edited somewhere else and come back without landing on the wrong scene, or deleting one.

## Requirements

### Requirement: The script serialises to Markdown with frontmatter

Export SHALL emit Markdown with YAML frontmatter carrying at least the project
title, format, project id, and the document revision at export time. Chapters
SHALL be emitted as `#` headings followed by their brief, scenes as `##`
headings carrying the scene's positional label, its stable identity and its
duration, and descriptions as `**AUDIO**` and `**VISUAL**` labelled blocks.
Export SHALL NOT emit Markdown tables.

#### Scenario: Exporting a two-scene project

- **WHEN** the operator exports a project with one chapter and two scenes
- **THEN** the file contains frontmatter with the project id and revision
- **AND** one `#` chapter heading followed by its brief, and two `##` scene
  headings
- **AND** each scene has an `**AUDIO**` block and a `**VISUAL**` block

#### Scenario: Speaker cues follow the chosen speaker

- **WHEN** a project with one scene using the default voice and one scene with a
  chosen speaker is exported
- **THEN** the first scene's `**AUDIO**` block carries no cue
- **AND** the second scene's carries that speaker's name

#### Scenario: Importing a cue

- **WHEN** an imported scene's `**AUDIO**` block names a speaker on the project's
  roster
- **THEN** that speaker is chosen for the scene

#### Scenario: Importing an unrecognised cue

- **WHEN** an imported scene's `**AUDIO**` block names a speaker that is not on
  the roster
- **THEN** no speaker is chosen for the scene
- **AND** the unrecognised name is reported

#### Scenario: No tables are emitted

- **WHEN** any project is exported
- **THEN** the emitted Markdown contains no table rows

### Requirement: A scene heading carries a positional label and a stable identity

A scene heading SHALL carry both the `chapter.scene` label derived from the
scene's position and the scene's stable identity, the identity written in
attribute syntax so that renderers which do not support it omit it. Import SHALL
match on the identity and SHALL NOT match on the label.

#### Scenario: Round trip after reordering

- **WHEN** the operator moves a scene to another chapter, exports, and re-imports
- **THEN** the scene's label differs from before the move
- **AND** the same scene is updated, not a different one

#### Scenario: Label alone is not identity

- **WHEN** an imported file contains a scene labelled `1.1` whose identity
  matches a scene currently labelled `2.3`
- **THEN** the scene currently labelled `2.3` is the one updated

### Requirement: Computed values are emitted but never parsed

Export SHALL emit each chapter's running time, word count and cumulative totals
so the file reads on its own. Import SHALL ignore those values and SHALL
recompute them.

#### Scenario: A chapter footer in an imported file

- **WHEN** a file whose chapter footers state values inconsistent with its
  scenes is imported
- **THEN** the stated values are ignored
- **AND** the footers shown after import are computed from the imported scenes

### Requirement: Import matches rows by identity and never deletes silently

Import SHALL apply a row to the scene whose identity matches its heading. A row
whose identity is unknown or absent SHALL create a new scene. A scene present in
the project but absent from the imported file SHALL NOT be removed without
operator confirmation.

#### Scenario: Round trip after an external text edit

- **WHEN** an exported file is edited externally and re-imported unchanged in
  structure
- **THEN** each row's text is applied to the scene with the matching identity
- **AND** no scene is created or removed

#### Scenario: A row with no identity

- **WHEN** an imported file contains a scene heading with no identity
- **THEN** a new scene is created for it

#### Scenario: A scene missing from the file

- **WHEN** an imported file omits a scene that exists in the project
- **THEN** the operator is asked to confirm the removal
- **AND** the scene remains until the confirmation is given

### Requirement: Import reports divergence rather than merging it

When the frontmatter revision does not match the project's current revision,
import SHALL report that the project changed since export and SHALL describe
what differs before applying anything. It SHALL NOT merge automatically.

#### Scenario: The project moved on since export

- **WHEN** a file exported at an earlier revision is imported
- **THEN** the operator is told the project has changed since export
- **AND** is shown what the import would change before it is applied

#### Scenario: The project is unchanged since export

- **WHEN** the frontmatter revision matches the project's current revision
- **THEN** the import applies without a divergence report

### Requirement: Import tolerates content it does not model

Import SHALL NOT fail on Markdown constructs it does not model. Unrecognised
content within a scene SHALL be preserved into that scene's description rather
than discarded, and unrecognised content outside any scene SHALL be ignored.

#### Scenario: A foreign document with extra formatting

- **WHEN** a Markdown file containing constructs the format does not model is
  imported
- **THEN** the import completes
- **AND** reports what it could not interpret

### Requirement: Import creates scenes and never generates

Importing a document whose scenes carry no identity and no duration SHALL create
scenes with auto durations and an empty visual description. Import SHALL NOT
invoke generation of any kind.

#### Scenario: A foreign script with no identities or durations

- **WHEN** a script carrying no identities and no durations is imported
- **THEN** a scene is created for each of its rows, with an auto duration and an
  empty visual description

#### Scenario: Import spends nothing

- **WHEN** any document is imported
- **THEN** no speech, frame, or scene generation is started
