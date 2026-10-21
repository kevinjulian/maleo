# auto-captions Specification

## Purpose

Let editors create and correct single-language captions from project audio or subtitle files, with readable stable phrases and predictable synchronization through editing and export.

## Requirements

### Requirement: Caption generation names its source and language

The editor SHALL offer caption generation from an eligible selected audio/video source or all audible timeline speech. It SHALL show the selected source and range before generation and offer automatic language detection or a supported explicit language. The initial workflow SHALL produce one single-language caption set without translation or bilingual output.

#### Scenario: Caption imported footage

- **WHEN** an editor selects an admitted video containing speech and generates captions
- **THEN** captions are created from its audible placed source interval without requiring a generated voiceover

#### Scenario: Default source is visible

- **WHEN** the editor opens Captions with an eligible audio/video source selected
- **THEN** that source is the visible default and the editor can choose all audible speech instead
- **AND** with no eligible selection the default is all audible speech

#### Scenario: Caption the audible mix

- **WHEN** all audible speech is selected on a timeline with trims, gaps, retimed audio and muted sources
- **THEN** recognition uses the sound at its actual timeline timing, excluding muted or duplicate extracted source audio

### Requirement: Captions remain stable while speech advances

A caption cue SHALL retain the same displayed phrase, line breaks, position and reserved word layout throughout its active interval unless the editor changes its text or styling. Word emphasis SHALL NOT select a moving window of surrounding words. Plain captions SHALL retain constant fill and opacity; word highlight and word pop SHALL change only emphasis within the fixed phrase. Typewriter SHALL reserve unrevealed word space. Cue entry motion SHALL NOT restart when the active word changes.

#### Scenario: Highlight advances

- **WHEN** the active spoken word advances across a multiword cue
- **THEN** only word emphasis changes and no word is introduced, removed or wrapped onto another line

#### Scenario: Long sentence spans cues

- **WHEN** a sentence requires several readable phrases
- **THEN** the complete displayed phrase changes only at the precomputed or authored cue boundaries

#### Scenario: Silence and shared boundaries

- **WHEN** playback crosses a shared cue boundary or a gap between cues
- **THEN** at most one cue owns the shared boundary and no caption appears during the gap
- **AND** short internal word pauses do not make the active phrase blink

### Requirement: Editors can correct cues without changing speech

The editor SHALL present timestamped editable cues linked to timeline selection and preview seeking. It SHALL support text and line-break corrections, start/end changes, split at playhead, adjacent merge and deletion. Correcting subtitles SHALL NOT change source audio or narration script. When corrected wording invalidates word alignment, the editor SHALL preserve cue timing and identify estimated word timing rather than claim recognition accuracy.

#### Scenario: Select then edit a cue

- **WHEN** the editor selects a cue row and types a correction
- **THEN** selection seeks to that cue once, typing retains focus and native text selection, and neither typing nor playback-follow repeatedly seeks
- **AND** the audio and narration script remain unchanged

#### Scenario: Split and merge

- **WHEN** a cue is split inside its interval and then its two adjacent parts are merged
- **THEN** cue text and word coverage are retained without duplicate words, zero-duration cues or changes to unrelated cues

#### Scenario: Keyboard editing during playback

- **WHEN** playback advances while the editor types or composes text in a cue
- **THEN** playback does not replace the editing selection, steal focus, intercept native editing keys or force the list to scroll away

### Requirement: Caption styling has explicit scope

The editor SHALL offer global caption styling by default and explicitly selected-cue overrides. Text corrections, timing changes and splits SHALL NOT detach a cue from inherited styling. The editor SHALL be able to reset selected overrides to the global style. Offered styles SHALL fit within the existing editor tools and phone properties housing.

#### Scenario: Apply style after correcting text

- **WHEN** a globally inherited cue has corrected text and the global style changes
- **THEN** it receives the style without losing the correction

#### Scenario: Reset a selected override

- **WHEN** the editor resets an override on selected cues
- **THEN** only those overrides are removed and those cues inherit the current global style

### Requirement: Generation is cancellable and recoverable

Caption generation SHALL expose meaningful scoped stages, cancel and retry. It SHALL show a percentage only when measured. Engine-unavailable, unsupported source, no speech and failure SHALL be distinct outcomes. Existing captions SHALL remain usable until a complete result is accepted; failed, cancelled, partial and no-speech results SHALL NOT clear them. Closing the panel SHALL NOT lose editor-owned run state.

#### Scenario: No speech

- **WHEN** recognition finds no meaningful speech
- **THEN** the editor receives a no-speech outcome with recovery options and existing captions remain unchanged

#### Scenario: Cancel then late completion

- **WHEN** a run is cancelled and a result subsequently arrives
- **THEN** that result does not apply and the editor can start a fresh attempt

#### Scenario: Setup unavailable

- **WHEN** the executing recognition service is unavailable or not installed
- **THEN** generation explains the unavailable state and exposes Settings recovery without presenting it as an empty transcript

#### Scenario: Reopen panel

- **WHEN** the editor hides and reopens Captions while a job runs
- **THEN** its current job stage and cancel action remain available

### Requirement: Regeneration preserves authored corrections by default

Regeneration SHALL name its source/range and preserve authored text, timing, segmentation, style overrides and deletions by default. It SHALL offer an explicit scoped choice to replace edited captions. Candidates SHALL NOT duplicate protected cues or fill explicitly deleted protected ranges. A completed result SHALL apply at most once, as a complete operation, only when affected source and caption state still match the submitted state. Unrelated edits SHALL remain intact.

#### Scenario: Preserve corrections and deletions

- **WHEN** the editor regenerates a range containing a corrected cue and an explicitly deleted cue using the default option
- **THEN** the corrected cue remains and the deleted cue is not recreated
- **AND** regenerated candidates do not overlap the protected intervals

#### Scenario: Explicit replacement

- **WHEN** the editor chooses to replace edited captions within a named range
- **THEN** only that scope is replaced and edits outside it are retained

#### Scenario: Timeline changes during recognition

- **WHEN** an affected source, cue or lock changes while recognition runs
- **THEN** the conflicting result is held with a visible reason and recovery rather than overwriting current work

#### Scenario: Different scope or repeated response

- **WHEN** a completed response belongs to another project/workspace or has already been applied
- **THEN** it causes no document change or additional undo entry

### Requirement: Caption jobs use authorized bounded source material

Recognition SHALL accept only project-admitted media authorized to the current workspace/project. It SHALL use the editor's submitted timeline placements, including unsaved placements, after validation. Arbitrary filesystem paths or remote URLs SHALL NOT be accepted as caption sources. Duration, source count, concurrency and execution time SHALL have enforced limits; cancellation and timeout SHALL stop owned processing and release temporary resources.

#### Scenario: Unauthorized source

- **WHEN** a request names media outside the current project's authorized scope
- **THEN** it is refused before recognition without exposing source bytes or local paths

#### Scenario: Unsaved placement

- **WHEN** an admitted clip has been moved or trimmed locally before autosave and captions are generated
- **THEN** generation uses the validated submitted placement rather than an older persisted placement

#### Scenario: Execution limit

- **WHEN** a request exceeds an enforced limit or times out
- **THEN** it returns a recoverable bounded failure and does not apply partial captions

### Requirement: Caption source linkage is predictable

Generated captions SHALL retain source instance and source revision linkage. Unambiguous move, retained trim, split and constant-rate edits SHALL update linked cue/word timing with the source. Source deletion SHALL remove exclusively linked cues with the same reversible action. Source duplication SHALL create independent linked cue identities. Changed media, reversed speech or ambiguous mixed-source edits SHALL retain authored data and identify affected cues as needing refresh rather than silently reuse incorrect timing. Standalone cues SHALL retain their authored absolute timing.

#### Scenario: Move and retime

- **WHEN** a single-source clip moves and its constant playback rate changes
- **THEN** linked cues keep their original source speech coverage and follow the new placement and rate

#### Scenario: Trim and split

- **WHEN** a linked source is trimmed or split
- **THEN** retained recognized words follow retained source intervals without duplicate rendered words
- **AND** any boundary correction that cannot be mapped safely is identified as needing refresh

#### Scenario: Delete or duplicate source

- **WHEN** a source is deleted or duplicated
- **THEN** exclusively linked captions are removed or independently duplicated with it
- **AND** undo restores the entire prior relationship

#### Scenario: Change one contributor to mixed speech

- **WHEN** one contributing source moves or changes under a cue recognized from mixed audio and the cue cannot be mapped uniquely
- **THEN** the cue is marked as needing refresh with its authored data retained

#### Scenario: Standalone subtitles

- **WHEN** an unrelated audio/video source moves under imported standalone captions
- **THEN** those captions keep their authored absolute timing

### Requirement: Subtitle import and export preserve authored cues

The editor SHALL import SRT as independent cues without requiring voiceovers, preserving valid cue boundaries and explicit line breaks. It SHALL validate before replacing the current caption set, report malformed cue counts, and leave current captions unchanged when none are valid. SRT export SHALL serialize the authored active caption set with valid normalized timestamps rather than reconstruct phrases from word timings. Imported word timings SHALL be identified as estimated when the file supplies cue times only.

#### Scenario: Import without narration

- **WHEN** an editor imports valid SRT into a project with no voiceover
- **THEN** editable caption clips appear at the imported times and render without adding audio objects

#### Scenario: Export corrected cues

- **WHEN** corrected cues with explicit line breaks are exported and imported again
- **THEN** their text, breaks and millisecond cue boundaries are preserved

#### Scenario: Invalid file

- **WHEN** the imported file has no valid cues
- **THEN** the editor receives an actionable error and current captions are unchanged

### Requirement: Caption controls remain accessible in the existing workspace

The workflow SHALL remain reachable in the existing Captions destination at desktop and 320px widths with keyboard, pointer and coarse touch. Transcript and Style SHALL be local views with associated panels; essential generation, correction and recovery actions SHALL NOT require hover. Panel changes SHALL preserve existing workspace sizing and editor-owned run state.

#### Scenario: Narrow-screen correction

- **WHEN** an editor opens Captions on a 320px viewport
- **THEN** source selection, generation, cue editing and recovery remain reachable without overlapping controls or a new competing overlay stack

### Requirement: The caption panel shows results first

The Captions panel SHALL show the generate card as its first content when the project has no caption cues. When one or more cues exist, the Transcript view SHALL show the caption list as its first content, and the generate, regenerate, SRT import and SRT export actions SHALL be in the panel header overflow menu. Recovery states for a running, held or failed caption job SHALL show above the caption list while they apply. The panel SHALL NOT open a second overlay or panel owner for these actions.

#### Scenario: First visit with no captions

- **WHEN** an editor opens Captions in a project with no caption cues
- **THEN** the first content of the Transcript view is the generate card with source, language and a primary Generate button
- **AND** SRT import is available from the same card

#### Scenario: Return to existing captions

- **WHEN** an editor opens Captions in a project with caption cues
- **THEN** the first content of the Transcript view is the caption list
- **AND** Regenerate, Import SRT and Export SRT are available from the panel header overflow menu

#### Scenario: Narrow screen with captions

- **WHEN** an editor opens Captions with caption cues on a 320px viewport
- **THEN** at least one cue row is visible in the sheet without scrolling

#### Scenario: Job in progress

- **WHEN** a caption job is running, held or failed and cues exist
- **THEN** its status and its cancel, resume, apply or retry action show above the caption list

### Requirement: Caption sources are named for people

The caption source control SHALL label each source with its media name, or with its kind and position when the media has no name, and with its timeline start in `m:ss` form. It SHALL NOT show internal clip or visual identifiers. The source range SHALL show as secondary text in `m:ss – m:ss` form.

#### Scenario: Imported video source

- **WHEN** the timeline contains an imported video named "interview.mp4" that starts at 0 seconds
- **THEN** the source option reads with "interview.mp4" and "0:00"
- **AND** no option text contains a clip identifier such as `video:1792255103569`

#### Scenario: Range text

- **WHEN** the chosen sources span 0 to 12.01 seconds
- **THEN** the range reads "0:00 – 0:12" in secondary text, not as a heading

### Requirement: Generation availability is visible at the action

The Generate button SHALL always render as the primary action of the generate card or regenerate step. When generation is not available, the button SHALL be disabled and the reason SHALL show next to it, with a link to caption setup when setup can fix the reason. While availability is being checked, the button SHALL show the checking state.

#### Scenario: Worker not configured

- **WHEN** the caption worker reports that recognition is unavailable
- **THEN** the Generate button is visible and disabled
- **AND** the reason and a caption setup link show directly next to it

#### Scenario: No eligible source

- **WHEN** the timeline has no admitted audio or video source
- **THEN** the Generate button is disabled and the reason says to add or import media with speech

### Requirement: Regeneration asks once about edited captions

Regeneration SHALL be a step inside the Captions panel that names the source and range and offers exactly two choices: keep edited captions (default) and replace edited captions in the named range. The panel SHALL NOT show a persistent preserve switch outside this step. Cancelling the step SHALL change nothing.

#### Scenario: Default regeneration

- **WHEN** an editor opens Regenerate from the overflow menu and confirms without changing the choice
- **THEN** the job is submitted with edited captions preserved

#### Scenario: Explicit replacement

- **WHEN** the editor selects "Replace edited captions in this range" and confirms
- **THEN** the job is submitted with replacement for that range only

#### Scenario: Step cancelled

- **WHEN** the editor opens the regenerate step and leaves it without confirming
- **THEN** no job is submitted and the caption list shows again unchanged

### Requirement: Cue rows are compact until selected

Each cue row SHALL show its start time in `m:ss.s` form and its editable text. Timing fields and the split, merge, delete and unlink actions SHALL show only on the selected cue row. Selecting a row SHALL select the cue on the timeline and seek to its start. A Needs refresh cue SHALL show its state as a badge on the row in every state. In the cue text field, Enter SHALL commit pending text and then split the cue at a word boundary: at the caret when the caret is between words, and at the start of the word when the caret is inside a word. Enter at the start or end of the text SHALL do nothing. Backspace at the start of a non-first cue SHALL merge it into the previous cue, and Shift+Enter SHALL insert a line break. These keys SHALL NOT act during text composition.

#### Scenario: Unselected rows

- **WHEN** the caption list shows ten cues and one is selected
- **THEN** only the selected row shows timing fields and cue actions

#### Scenario: Split from the keyboard

- **WHEN** the caret is after "hello" in the cue text "hello world" and the editor presses Enter
- **THEN** the cue becomes two cues with the texts "hello" and "world" as one undoable step

#### Scenario: Caret inside a word

- **WHEN** the caret is after "wor" in the cue text "hello world" and the editor presses Enter
- **THEN** the cue becomes two cues with the texts "hello" and "world"

#### Scenario: Merge from the keyboard

- **WHEN** the caret is at the start of a cue that follows another cue and the editor presses Backspace
- **THEN** the two cues become one cue as one undoable step

#### Scenario: Line break

- **WHEN** the editor presses Shift+Enter in a cue text field
- **THEN** an authored line break is inserted and the cue is not split

#### Scenario: Composition in progress

- **WHEN** an input method composition is active and the editor presses Enter
- **THEN** the composition commits and the cue is not split

#### Scenario: Stale cue in a compact row

- **WHEN** a cue needs refresh and its row is not selected
- **THEN** the row shows a Needs refresh badge

### Requirement: Captions can be selected from the canvas

This requirement is optional scope (P2). Clicking or tapping visible caption text in the preview SHALL select that cue, show it as the selected row in the caption list and keep the playhead where it is. Double-clicking or double-tapping SHALL put focus in that cue's text field. Caption hit targets SHALL NOT block selection of other canvas elements outside the caption box.

#### Scenario: Select from preview

- **WHEN** the editor clicks the visible caption in the preview
- **THEN** that cue is selected on the timeline and in the caption list

#### Scenario: Edit from preview

- **WHEN** the editor double-clicks the visible caption in the preview
- **THEN** the Captions panel opens if closed and focus moves to that cue's text field

### Requirement: Style scope is a visible switch

This requirement is optional scope (P2). The Style view SHALL show the style scope as a two-option switch, "All captions" and "This caption", at the top of the view. "This caption" SHALL be disabled with a reason when no cue is selected. Presets SHALL preview their fill, highlight colour and motion name.

#### Scenario: No cue selected

- **WHEN** the editor opens Style with no cue selected
- **THEN** "All captions" is active and "This caption" is disabled with the reason "Select a caption"

#### Scenario: Preset preview

- **WHEN** the editor views the preset list
- **THEN** each preset shows its fill and highlight colours and its motion name

### Requirement: Caption text can be found and replaced

This requirement is optional scope (P2). The caption list SHALL offer find and replace across cue text. Replace all SHALL apply as one undoable step and SHALL skip cues on locked tracks with a count of skipped cues.

#### Scenario: Replace a name

- **WHEN** the editor replaces "Jon" with "John" in all cues
- **THEN** every unlocked matching cue changes in one undoable step

#### Scenario: Locked cues

- **WHEN** some matching cues are on a locked track
- **THEN** those cues are unchanged and the panel reports how many were skipped
