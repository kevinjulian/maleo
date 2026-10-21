# timeline-document-store Specification

## Purpose

TBD - created by archiving change flip-timeline-clip-source-of-truth. Update Purpose after archive.

## Requirements

### Requirement: Canonical timeline document as source of truth

The video editor SHALL hold its editable state as a single canonical `TimelineDoc` (`schemaVersion: 2`, `clips[]`, `markers[]`, `captions`, `trackFlags`, optional `projectReferences`) in one store. `captions` (formerly a separate `CaptionConfig`) is folded into the document. `trackFlags` is document state, not side-state: it persists with the storyboard and decides what a render contains, and each entry carries the lane's declared `group`. Chrome/session fields (`chatMessages`, `mediaAssets`, `settings`, `hookVariants`) MUST be held as separate store side-state, not in the document. The 11 legacy per-type arrays (`scenes`, `videoOverlays`, `textOverlays`, `audioOverlays`, `infographicOverlays`, `effects`, `transitions`) MUST NOT be independent stateful sources; where still consumed, they MUST be derived from the document via `fromTimelineDoc`.

The original requirement listed `trackFlags` among the session fields. That was wrong at the time and the code has since corrected it: a muted or hidden lane changes the rendered output, so its flags belong to the document that describes the render, not to the chrome around it. Declared lane groups make the point unarguable — a lane's group survives the session that created it, and a document that does not carry it cannot describe its own layout.

#### Scenario: Edits mutate the document, not parallel arrays

- **WHEN** a timeline edit (add, move, resize, delete, retime a clip) is applied
- **THEN** the change is written to the canonical `TimelineDoc` in the store
- **AND** any array a panel reads reflects the change through a derived selector, with no separately-mutated array copy

#### Scenario: Legacy arrays are derived, not stored

- **WHEN** a panel that has not yet migrated reads `scenes`/`videoOverlays`/etc.
- **THEN** it receives a value derived from the current `TimelineDoc`
- **AND** the derived value equals the lossless `fromTimelineDoc` projection of that document

#### Scenario: Lane flags round-trip with the document

- **WHEN** a project with per-lane visibility, mute, lock and group settings is saved and reopened
- **THEN** every lane's flags and group are restored from the document

#### Scenario: A lane flag changes the render

- **WHEN** a lane is muted or hidden
- **THEN** the change is written to the document, because it changes what a render contains

### Requirement: Lossless flip preserves existing behavior

Flipping the source of truth to the document SHALL NOT change rendered output, saved payloads, or panel behavior for content that round-trips through the existing bridge. The `toTimelineDoc`/`fromTimelineDoc` round-trip MUST remain lossless for all clip types.

#### Scenario: Round-trip parity after flip

- **WHEN** a project is loaded, edited through document mutations, and projected back to arrays
- **THEN** the resulting arrays are byte-equivalent to what the pre-flip array-based editor would have produced for the same edits

#### Scenario: Render boundary stays scene-based

- **WHEN** a video project is exported to the Remotion renderer
- **THEN** the document is projected to `scenes[]` via a boundary adapter
- **AND** `prepare-storyboard.ts` receives the same scene-shaped input it received before the flip

### Requirement: Markers are first-class persisted state

Scene markers (`SceneMarker[]`) SHALL be loaded from persisted storyboards, held in the document, editable, and written back on save. Markers MUST NOT be discarded on load.

#### Scenario: Markers survive a load/save round-trip

- **WHEN** a persisted storyboard containing `markers[]` is loaded
- **THEN** the document's `markers[]` is populated from the persisted markers (not reset to empty)
- **AND** on save the markers are written back to `storyboard_json`

#### Scenario: Marker is annotation, not a render primitive

- **WHEN** a marker's grouped clips are moved or resized
- **THEN** the marker's derived `startSec`/`endSec` range updates to span its clips
- **AND** moving the marker does not itself resize or retime the clips it groups

### Requirement: Image and text content types stay array-backed

The `image` (slides) and `text` (posts) content types SHALL remain array-backed and are explicitly out of scope for the `clips[]` document. The flip applies to the `video` content type only.

#### Scenario: Slides and posts unaffected by the flip

- **WHEN** an `image` or `text` project is edited
- **THEN** it continues to use its existing `slides[]`/`posts[]` arrays
- **AND** no `clips[]` document is required for those content types

### Requirement: One write interface into the document

The system SHALL expose a single write interface for the canonical timeline
document — the per-type setters, the projection rebuild, and the raw document-to-
document seam — and every editor surface SHALL write through it. A surface SHALL
NOT define its own setters over the store or open a second commit path.

#### Scenario: Container and editor write the same way

- **WHEN** the container and the timeline editor each change a scene
- **THEN** both go through the same write interface, and each edit becomes a typed, undo-precise command

#### Scenario: The write path is testable without the editor

- **WHEN** the write interface is exercised in a test
- **THEN** it can be driven with a plain commit function, without mounting the player or the editor

### Requirement: Editor chrome is separate from the document

The system SHALL keep the editor's chrome — rail navigation, panel hosting, stage
sizing, aspect and playback controls — in modules that read no document state, so
each can be understood and changed without the timeline document in view.

#### Scenario: Chrome renders without a document

- **WHEN** the rail and panel host are exercised
- **THEN** they need no document, no store and no player

### Requirement: Selection is a model, not scattered state

The system SHALL hold the editor's selection — which scene, clip, overlay,
transition or effect is selected — in one model with one set of transitions,
rather than as independent state in the editing component.

#### Scenario: Selecting one kind of clip clears the others

- **WHEN** a clip of one kind is selected while another kind is already selected
- **THEN** the model clears the previous selection, and that rule has one implementation

#### Scenario: Selection is testable without rendering

- **WHEN** selection behaviour is exercised in a test
- **THEN** it runs against the model directly

### Requirement: Unreachable UI is deleted

The system SHALL NOT retain rendered branches behind permanently false flags. A
superseded surface is removed rather than disabled.

#### Scenario: A superseded panel leaves no dead branch

- **WHEN** a UI surface is replaced
- **THEN** its markup and its component hosts are deleted, not gated off

### Requirement: Reveal edits mutate the canonical timeline document

Adding, changing, disabling, or clearing reveal metadata SHALL be a mutation of
the canonical timeline document. Reveal state SHALL NOT live only in inspector
chrome, component state, or a separate unsaved editor store.

#### Scenario: Enable reveal writes document state

- **WHEN** the operator enables reveal on a selected visual clip
- **THEN** the selected clip in the canonical timeline document carries the
  reveal metadata
- **AND** derived arrays and render payloads reflect that document state

#### Scenario: Inspector reopen reads persisted reveal

- **WHEN** the operator saves, reloads, and selects a clip with reveal metadata
- **THEN** the inspector controls show the reveal type and timing from the
  document

### Requirement: Clip edits preserve reveal metadata

Timeline edits that move, resize, duplicate, or retime a visual clip SHALL keep
that clip's reveal metadata unless the edit explicitly changes reveal.

#### Scenario: Moving a revealed clip keeps reveal

- **WHEN** a visual clip with reveal metadata is moved to another time or track
- **THEN** the reveal metadata remains on the moved clip

#### Scenario: Duplicating a revealed clip copies reveal

- **WHEN** a visual clip with reveal metadata is duplicated
- **THEN** the duplicate carries the same reveal metadata as the source clip

### Requirement: Caption cues belong to the canonical timeline document

Caption cues SHALL be independently identified caption clips in the canonical timeline document. Their text, line breaks, cue-local words, timing origin, source bindings, edit/deletion protection and style overrides SHALL persist with storyboard versions. Global caption style SHALL remain document state. Panel and timeline cue lists SHALL be derived from the same clips and SHALL NOT own separate editable copies.

#### Scenario: Caption version round trip

- **WHEN** corrected captions are saved, reloaded or restored from a storyboard version
- **THEN** their identity, wording, boundaries, words, links, protection and styles are restored together

#### Scenario: Another writer saves the document

- **WHEN** an agent or another document writer updates unrelated scenes
- **THEN** authored caption state and explicitly empty caption sets remain unchanged

### Requirement: Caption initialization is explicit

Caption output SHALL read canonical caption clips only. The system SHALL NOT migrate, backfill or render historical voiceover words as caption cues. Generation or SRT import SHALL explicitly initialize a caption set. Missing sets and intentionally empty sets SHALL remain empty across reload, save, version restore and unrelated agent updates.

#### Scenario: Voiceover words do not initialize captions

- **WHEN** a project contains voiceover word timings but no canonical caption set
- **THEN** no caption cues are derived from those words
- **AND** the editor can explicitly generate captions or import SRT

#### Scenario: Intentional empty track stays empty

- **WHEN** the editor deletes every initialized caption and reloads or receives an agent update
- **THEN** no cue is recreated from narration or stored voiceover words
