# basic-clip-controls Specification

## Purpose

Let users finish common manual video edits with source-aware transforms, audio controls, animation, and compositing that survive persistence and match production output.

## Requirements

### Requirement: Mobile remains a first-class editing surface

The refreshed editor SHALL retain existing Maleo mobile behavior and provide usable mobile access to every new capability. OpenCut desktop references SHALL NOT force desktop columns or desktop-only interactions onto phones. Preview and timeline SHALL remain co-resident; contextual settings SHALL use compact sheets and existing Chat workspace behavior SHALL remain intact. Touch controls, file-picker and explicit placement alternatives, safe-area containment, dynamic viewport changes, on-screen keyboard access, and focus restoration SHALL remain functional. Actions SHALL NOT require hover, right-click, OS drag/drop, or desktop shortcuts.

#### Scenario: Phone edits imported media

- **WHEN** an operator imports media through the phone file picker and uses an explicit placement action
- **THEN** the asset can be placed and edited with touch while preview and timeline remain usable together

#### Scenario: Landscape phone and keyboard

- **WHEN** a coarse-pointer phone rotates to landscape or its on-screen keyboard reduces the visible viewport
- **THEN** required settings, transport, sheet dismissal, and completion actions remain reachable within safe areas without clipping or unintended page scrolling

#### Scenario: Mobile feature parity

- **WHEN** a new capability is delivered in any implementation stage
- **THEN** its mobile entry point, edit or recovery action, and resulting persisted behavior are exercised through actual controls before that stage is accepted

### Requirement: Layout refresh preserves existing Maleo features

The layout refresh SHALL preserve all existing Maleo capabilities, authored project data, and authorized access paths. The approved mockup SHALL define visual direction rather than limit the feature inventory. Existing generation, agent/chat, script/storyboard, materials/presets/templates, references/library/stock, captions/narration, scene/camera, transitions/audio, Motion Studio, Template Studio, and save/export/undo workflows SHALL remain reachable and functional at supported desktop and compact sizes. A control omitted from the mockup SHALL NOT be removed on that basis.

#### Scenario: Existing feature changes position

- **WHEN** the refreshed layout relocates an existing Maleo control
- **THEN** its labeled replacement entry point remains reachable and completes the same authorized workflow with existing authored data intact

#### Scenario: Chat remains a workspace

- **WHEN** an operator opens Chat from the refreshed editor and returns to editing
- **THEN** existing chat/run behavior remains available and document, selection, playhead, and draft state are retained

#### Scenario: Studios and generation remain accessible

- **WHEN** an operator uses generation, storyboard, materials, or either studio after the refresh
- **THEN** its existing workflow remains functional without requiring a return to a retired layout

### Requirement: Editor panes provide a clear spacious workspace

At desktop sizes the project editor SHALL present distinct media, preview, and contextual-inspector panes above a timeline spanning their combined width. Pane boundaries, headers, and controls SHALL follow the user-approved OpenCut Classic visual direction with readable contrast and visible focus. Timeline height SHALL be resizable, with a spacious initial desktop allocation that leaves the preview usable. At compact sizes preview and timeline SHALL remain visible together and secondary panels SHALL use existing sheet behavior.

#### Scenario: Inspector does not narrow the timeline

- **WHEN** an editor opens the inspector on desktop
- **THEN** timeline remains full-width below the upper panes and preview remains visible and operable

#### Scenario: Resize timeline

- **WHEN** an editor increases timeline height using its splitter
- **THEN** more timeline lanes become visible while preview retains a nonzero usable area

#### Scenario: Compact workspace

- **WHEN** editor is opened at 320px width or on a coarse-pointer landscape device
- **THEN** preview and timeline coexist and secondary panels remain reachable and dismissible without page overflow

### Requirement: Preview transforms have direct and numeric controls

Selected editable visual clips SHALL expose direct move, resize, and rotation handles, aspect-lock behavior, and snapping feedback. Pointer editing SHALL remain accurate under preview fit scaling, letterboxing, zoom, and rotation. A completed gesture SHALL produce one undo step; cancellation SHALL restore prior values and locked clips SHALL reject manipulation. Equivalent labeled numeric controls SHALL be accessible through keyboard and touch.

#### Scenario: Rotate a fitted clip

- **WHEN** editor rotates a selected clip in a fitted letterboxed preview
- **THEN** clip follows its rotation handle without coordinate drift and one undo restores its prior rotation

#### Scenario: Cancel or reject manipulation

- **WHEN** editor cancels a transform gesture or attempts to transform a locked clip
- **THEN** no authored transform change remains

### Requirement: Basic settings reflect selection and preview

Inspector SHALL group labeled basic settings by selected media kind, expose current values and units, and provide canvas settings when no clip is selected. Available settings SHALL change preview and persist through reload; unavailable features SHALL NOT appear as functioning controls. Advanced settings SHALL remain distinct from frequently used basics.

#### Scenario: Select audio after text

- **WHEN** editor changes selection from text to an audio clip
- **THEN** inspector exposes that audio clip's gain, mute, and fade settings rather than unrelated typography controls

#### Scenario: Edit and reload

- **WHEN** editor changes a basic setting and reloads after saving
- **THEN** inspector and preview reflect the saved value

### Requirement: Visual crop and orientation affect rendered pixels

Image and video clips SHALL offer editable source crop, horizontal/vertical flip, and existing position/size/rotation/opacity controls. Video clips SHALL offer reverse over their selected source range. Crop SHALL select source pixels rather than merely resize the destination box; invalid crop geometry SHALL be rejected. Original sources SHALL remain immutable and every control SHALL support undo and reset.

#### Scenario: Crop then rotate

- **WHEN** an editor crops a known region and rotates the clip
- **THEN** preview and production output show that cropped region rotated within the authored destination box

#### Scenario: Reverse trimmed video

- **WHEN** a video clip with a nonzero source in-point is reversed
- **THEN** its selected source interval plays backwards, with source audio reversed when enabled, without altering neighboring clips or duration

### Requirement: Constant retiming uses consistent source time

Video and audio clips SHALL support constant rates from 0.25 to 4 times normal speed, including pitch-preservation selection for audible content. Changing rate SHALL preserve the selected source interval and adjust timeline duration; later clips SHALL stay in place. Split, trim, duplication, extraction, and replacement validation SHALL use the same rate/direction mapping. Playback or looping beyond the source range SHALL NOT silently conceal invalid edits.

#### Scenario: Slow down a selected source range

- **WHEN** a four-second source interval is retimed to 0.5 times normal speed
- **THEN** it occupies eight timeline seconds, its start stays fixed, and later clips retain their positions

#### Scenario: Split a fast clip

- **WHEN** a clip at twice normal speed is split two timeline seconds after its start
- **THEN** the halves jointly play the original selected source interval without repeating or skipping content at the cut

#### Scenario: Preserve speech pitch

- **WHEN** a speech source is retimed with pitch preservation enabled
- **THEN** preview and production export change its duration while preserving pitch within the declared processing tolerance

### Requirement: Source audio can be extracted and recovered

Editors SHALL extract a video's source audio into an independently editable audio clip aligned with its visible source range, rate, and direction. Extraction SHALL suppress that video's embedded audio to prevent double playback. Recover SHALL restore its prior source-audio settings and remove only the unmodified audio created by that extraction; if the extracted clip has been independently edited, the editor SHALL require an explicit choice before discarding it. Sources without audio SHALL expose an unavailable extraction action.

#### Scenario: Extract trimmed source audio

- **WHEN** the editor extracts audio from a trimmed and retimed video
- **THEN** one admitted audio source and one aligned audio clip are created, the video is muted, and no duplicate soundtrack plays

#### Scenario: Recover unchanged extraction

- **WHEN** the editor recovers source audio whose extracted clip is unmodified
- **THEN** the original video's audio settings return and the generated audio clip is removed as one reversible action

#### Scenario: Preserve independently edited extraction

- **WHEN** the editor requests recovery after trimming or moving the extracted audio
- **THEN** the editor is warned about the independent edit and the clip remains until a discard or keep choice is made

### Requirement: Ordinary clips have editable transform and volume keyframes

Editors SHALL add, move, edit, copy/paste, and remove per-property keyframes for image/video position, scale, rotation, and opacity, text overlay transform and style properties, and audio/video source volume. All of them SHALL use the single animation model defined by `keyframe-animation`, and scene camera motion and Motion Studio SHALL retain their existing behavior. Keyframes SHALL support linear, ease-in, ease-out, ease-in-out, and hold interpolation and SHALL be visible in the main timeline. At a given project time preview and production output SHALL sample the same value.

#### Scenario: Animate b-roll position

- **WHEN** an editor places two position keys on a video overlay
- **THEN** its position interpolates between them in preview and production output and keys survive reload

#### Scenario: Ride dialogue volume

- **WHEN** an editor adds volume keys around a loud phrase
- **THEN** only that interval changes gain, combined predictably with clip fades, mute, and ducking

#### Scenario: Trim or split animated clips

- **WHEN** an animated clip is trimmed or split
- **THEN** retained portions evaluate to their previous property values at each retained project time, including new boundary values

#### Scenario: Key a text overlay in the main timeline

- **WHEN** an editor adds opacity keys to a text overlay from the inspector
- **THEN** the keys appear as a lane under that overlay and can be dragged, retimed, and removed like any other key

### Requirement: Simple masks and blend modes are editable per clip

Image/video clips SHALL support one rectangle or ellipse mask with editable placement, size, rotation, feather, and inversion, and normal, multiply, or screen blending. Effects SHALL remain scoped to the clip and compose consistently with crop, transform, opacity, and animation. Unsupported values SHALL be rejected rather than silently rendering as normal.

#### Scenario: Feathered picture in picture

- **WHEN** an editor applies an ellipse mask with feather to a video overlay
- **THEN** only the masked video region is visible with the same soft edge in preview and production export

#### Scenario: Blend over another track

- **WHEN** an editor applies screen blending to an overlay
- **THEN** it blends against the underlying composition and does not affect sibling or later clips

### Requirement: Basic color adjustment is resettable

Image/video clips SHALL expose brightness, contrast, and saturation with bounded values, neutral defaults, and reset. Adjustments SHALL affect clip pixels and SHALL NOT alter source bytes, text colors, or other clips.

#### Scenario: Reset color correction

- **WHEN** an editor changes all three adjustments and resets them
- **THEN** the clip returns to its neutral appearance and undo restores the prior adjustment values

### Requirement: New authored fields survive project lifecycle

All authored controls SHALL survive save/reload, autosave, and unrelated agent updates. Older projects without these fields SHALL load with neutral defaults and unchanged output. New actions SHALL respect track locks and remain accessible through keyboard and touch with meaningful busy, disabled, and recovery states.

#### Scenario: Agent updates narration

- **WHEN** an agent updates narration after the user authors a mask and volume keys
- **THEN** the unrelated mask and volume keys remain intact

#### Scenario: Legacy project remains neutral

- **WHEN** an older project without new control metadata is opened and exported
- **THEN** its rendered result remains unchanged
