# clip-native-timeline Specification

## Purpose

TBD - created by archiving change complete-clip-first-read-migration. Update Purpose after archive.

## Requirements

### Requirement: Readers consume the canonical clip document directly

The video editor's read paths — timeline panels, persistence bundle, render build, and `CreateContent` local derivations — SHALL read from the canonical `TimelineDoc` (`clips[]` + `markers[]`) and MUST NOT read a derived legacy per-type array bundle. The `useDerivedArrays` selector and the `fromTimelineDoc` doc-to-arrays projection SHALL be removed once no reader remains.

#### Scenario: Panels render from clips without the derived bundle

- **WHEN** the timeline editor renders a loaded video project
- **THEN** every timeline panel derives its view from `store.getDoc().clips` (and `markers`)
- **AND** no code path calls `fromTimelineDoc` or `useDerivedArrays`

#### Scenario: Persistence reads the document

- **WHEN** a debounced save fires
- **THEN** the `storyboard_json` payload is built from the store's `clips[] + markers[]` (and captions), not from a derived array bundle
- **AND** the persisted payload is byte-identical to the pre-migration payload for the same document

### Requirement: Clip retains its typed payloads as the clip's data

`Clip` SHALL keep its typed nested payloads (`scene`/`video`/`text`/`audio`/`effect`/`transition`) as the discriminated data carried on the clip. Readers SHALL migrate by reading those payloads (and clip-native timing) directly off `doc.clips`; field graduation and payload thinning SHALL NOT be performed. There SHALL be no `infographic` clip type and no `infographic` payload. The editor engine SHALL refuse a clip of type `infographic`.

#### Scenario: Reader reads payload off the clip

- **WHEN** a consumer needs a type-specific field (e.g. an audio clip's `kind`)
- **THEN** it reads `clip.audio.kind` from `doc.clips`
- **AND** no derived legacy-array bundle is consulted

#### Scenario: The engine refuses an infographic clip

- **WHEN** a command adds a clip of type `infographic`
- **THEN** the engine refuses the command as invalid input
- **AND** the document is unchanged

### Requirement: The renderer consumes clips directly

The Remotion render path (`packages/video`) SHALL consume `clips[]` directly, and the `clips -> scenes` boundary adapter SHALL be removed. Rendered output MUST be unchanged for any given document.

#### Scenario: Render output is preserved through the video migration

- **WHEN** a document is rendered before and after the video package migrates onto clips
- **THEN** the produced render storyboard is deep-equal for the same input
- **AND** the projection-to-render parity test passes on clip-native input

### Requirement: Load-time array projection is the only remaining array boundary

`toTimelineDoc` SHALL survive only as a load-time adapter that projects legacy-persisted or agent-supplied arrays into `clips[]`; it MUST NOT be used on the render or save hot paths. `parse-loaded-project.ts` reconstruction SHALL shrink as arrays stop being the load target.

#### Scenario: Arrays enter only at load

- **WHEN** a persisted v2 project or an agent array payload is loaded
- **THEN** `toTimelineDoc` projects it into the document once
- **AND** no subsequent read, save, or render step reconstructs the legacy arrays

### Requirement: No user-visible behavior change

This migration SHALL preserve panel behavior, undo/redo, save payloads, and render output. It MUST NOT introduce a user-facing feature, UX change, or persisted-format change.

#### Scenario: Editing parity across the migration

- **WHEN** a user loads a project, edits via direct manipulation and the agent, undoes/redoes, saves, and reloads
- **THEN** the observable result is identical to the pre-migration editor
- **AND** the `storyboard_json` / `editor_state_json` split and wire shape are unchanged
