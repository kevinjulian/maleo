# timeline-lane-types Specification

## Purpose

What a timeline lane accepts, and what follows from saying so. A lane
declares the clip group it holds rather than having one inferred from
whatever landed in it, so a drop can be routed instead of rejected and two
kinds that render identically can share one row.

## Requirements

### Requirement: A lane declares its group

Every free lane SHALL carry a declared group, persisted with the document. The group SHALL be one of `visual`, `audio`, `text`, `caption`, `data`, `effect`. A lane's group SHALL NOT be inferred from the clips it currently holds.

An empty declared lane SHALL remain available, except for redundant empty caption lanes removed under the caption cleanup rule.

#### Scenario: A lane is emptied

- **WHEN** the last clip is removed from a lane
- **THEN** the lane remains, keeps its group, and continues to identify itself unless it is a redundant empty caption lane

#### Scenario: A project is reopened

- **WHEN** a project is saved and reopened
- **THEN** every retained lane has the group it had, in the order it had

#### Scenario: A lane's group is read

- **WHEN** any surface needs to know what a lane is for
- **THEN** it reads the declared group rather than deriving one from the lane's contents

### Requirement: Six groups, and why each boundary falls where it does

The lane groups SHALL be exactly `visual` (scenes, images, video), `audio` (voiceover, music, SFX, ambient, accent), `text` (text overlays and motion templates), `caption` (timed caption cues) and `effect` (effects). There SHALL be no `data` group.

Images and video are one group because a transition requires two visual clips adjacent on the same track; separating them would make an image-to-video transition impossible to express. Text and motion are one group because a motion clip is a text overlay identified by its preset, so separating them would move a clip to a different lane when its preset changed. Captions are separate from text because a caption cue is owned by the caption set, follows its linked source and is styled by the caption style rather than by its own text properties; mixing them would let a text overlay take part in caption regeneration, SRT export and source synchronization. The remaining groups have distinct renderers and no adjacency relationship with anything else.

#### Scenario: A transition is placed between an image and a video

- **WHEN** an image clip and a video clip are adjacent and touching on a visual lane
- **THEN** a transition can be placed between them

#### Scenario: A text clip is given a motion preset

- **WHEN** a text overlay's preset changes to a motion template
- **THEN** the clip stays on its lane

#### Scenario: A group is chosen for a clip

- **WHEN** any clip is classified
- **THEN** it resolves to exactly one of the five groups

#### Scenario: A caption cue is classified

- **WHEN** a caption cue is placed on the timeline
- **THEN** it resolves to the `caption` group and never shares a lane with a text overlay

#### Scenario: A stored document declares a data lane

- **WHEN** a stored document carries a lane flag entry whose group is `data`
- **THEN** the reader drops that entry
- **AND** no lane of group `data` is shown

### Requirement: All audio kinds may share one lane

An `audio` lane SHALL accept voiceover, music, SFX, ambient and accent clips together. Rendered output SHALL NOT depend on which lane an audio clip occupies.

Every audio behavior in the renderer keys off the clip's own kind and never off its track: the ducking envelope is computed from the ranges of clips whose kind is voiceover, music loops because it is music, ambient sits back because it is ambient. Mixing kinds on a lane is therefore render-identical, and forcing three audio lanes on a project with one voiceover would spend height on lanes that exist only to express a distinction the renderer does not make.

The cost is that mute, hide and lock are per-lane, so clips sharing a lane share those flags. That is the operator's choice to make: a group names what a lane accepts, not how many lanes of that group exist.

#### Scenario: Voiceover and music are placed on one lane

- **WHEN** a voiceover clip and a music clip occupy the same audio lane
- **THEN** the rendered output is identical to the same clips on separate lanes

#### Scenario: An operator wants music muted independently

- **WHEN** an operator adds a second audio lane and moves the music clip to it
- **THEN** the two lanes mute independently and the render is unchanged

#### Scenario: Overlapping audio is organized

- **WHEN** the organize action runs over audio clips that overlap in time
- **THEN** they are distributed across separate audio lanes, because a lane cannot show two clips at one instant

#### Scenario: A project has one voiceover and nothing else

- **WHEN** a project contains a single voiceover clip
- **THEN** it occupies one audio lane, not three

### Requirement: Lane height follows lane group

Lane height SHALL be determined by the lane's group:

- The scene row SHALL be the tallest row, because it carries the render's filmstrip.
- A `visual` lane SHALL be tall enough for a thumbnail strip.
- An `audio` lane SHALL be shorter than a `visual` lane, at approximately two thirds of its height, so its waveform stays legible.
- A `caption` lane SHALL be tall enough for one legible line of caption text and SHALL NOT be taller than an `audio` lane.
- `text`, `data` and `effect` lanes SHALL be shorter still.
- A lane with no declared group SHALL take the `visual` height, because it may hold any free clip.

No free lane SHALL fall below the touch hit minimum the timeline applies on a coarse pointer.

Hit-testing a drag against lanes SHALL use the height each lane is actually drawn at, measured per lane, not an assumed height per tier.

Every lane being the same height wastes the pixels a filmstrip needs on rows that hold a waveform or a caption, and on a phone with roughly 429px of timeline that caps the project at a handful of lanes regardless of contents. Height is also the cheapest identity signal available: a mid-height waveform row is audio without anything having to say so, which is what makes removing the labels survivable. An earlier version halved audio, which left a waveform too thin to read, so this version takes two thirds. A caption clip's text is its content, so its lane keeps one line of text readable where a text overlay's lane does not need to.

#### Scenario: A phone shows a mixed project

- **WHEN** a project with one visual lane, two audio lanes and one text lane is opened at phone width
- **THEN** all four lanes and the base track are visible without scrolling

#### Scenario: A lane's height is read by the gutter

- **WHEN** lanes render at different heights
- **THEN** each gutter row matches the height of the lane beside it, and no row drifts out of alignment with its lane

#### Scenario: Density is changed

- **WHEN** the operator changes timeline density
- **THEN** every group's height scales with it, and the ordering scene > visual > audio ≥ caption > text/data/effect is preserved

#### Scenario: A clip is dragged across lanes of different heights

- **WHEN** a clip is dragged from a short text lane, over an audio lane, onto a visual lane
- **THEN** the projected destination row at every pointer position is the lane drawn under the pointer

### Requirement: An audio clip's waveform is its body

An `audio` clip SHALL draw its waveform across its full width, mirrored about a horizontal centerline. It SHALL NOT reserve width for a kind label.

The lane declares the kind, so a per-clip tag repeats it and takes the width the waveform needs — which matters more at 26px than it did at 42px. Mirroring is what makes the mark read as audio rather than as a bar chart; drawing from the baseline up is the shape of a histogram, and the timeline already has a density histogram that would then look like a waveform.

#### Scenario: An audio clip is drawn on a short lane

- **WHEN** an audio clip renders on an audio lane
- **THEN** the waveform spans the clip's full width and is symmetric about the clip's vertical center

#### Scenario: Audio has not decoded

- **WHEN** an audio clip's waveform has not decoded, or failed to decode
- **THEN** the clip falls back to its label, as it does today

#### Scenario: A clip is too narrow for a waveform

- **WHEN** an audio clip renders narrower than its minimum readable waveform width
- **THEN** it remains visible and selectable at the minimum hit size the timeline already guarantees

### Requirement: A lane is identified without its label

A lane SHALL be identifiable when the gutter is not visible. An empty lane SHALL display its group name within the lane itself.

The gutter is hidden by default on a coarse pointer and carries icons rather than text when shown, so a lane with clips is identified by its height, its clip colour and its clip icons. A lane with no clips has none of those, and typed empty lanes persist by design — so without an in-lane label the feature that keeps "the audio lane" in place produces a blank stripe that means nothing.

#### Scenario: An empty lane is shown with the gutter hidden

- **WHEN** a lane containing no clips renders while the gutter is hidden
- **THEN** the lane displays its group name within itself

#### Scenario: A lane receives its first clip

- **WHEN** a clip is placed on an empty lane
- **THEN** the ghost label gives way to the clip

#### Scenario: A lane is identified with the gutter visible

- **WHEN** the gutter is visible
- **THEN** each lane's group is shown by an icon, tinted with the same hue its clips use

### Requirement: The gutter is icon-only and optional

The gutter SHALL present each lane as a group icon plus visibility, mute and lock controls, without a text label. It SHALL be hidden by default on a coarse pointer, with a toggle in the timeline's existing tools sheet, and its visibility SHALL persist.

The gutter is a fixed 176px on a 390px phone — 45% of the screen spent on labels, leaving about five seconds of timeline visible. Each row spends that width on a drag grip, a two-line label and three toggles, none of which reach the 44px minimum the timeline enforces for clips. Hiding it by default returns the full width to the thing being edited; keeping it available preserves per-lane flags for the moments they are needed.

Keyed on pointer type rather than viewport width, matching the existing density rule: a touch laptop needs the space and the larger targets, a narrow desktop window does not.

#### Scenario: The editor is opened on a phone

- **WHEN** the editor is opened on a coarse-pointer device for the first time
- **THEN** the gutter is hidden and the lanes occupy the full width

#### Scenario: The gutter is toggled on

- **WHEN** the operator enables the gutter from the tools sheet
- **THEN** the gutter appears, lanes keep their vertical positions, and the setting persists across sessions

#### Scenario: The editor is opened on a desktop

- **WHEN** the editor is opened with a fine pointer
- **THEN** the gutter is visible by default

#### Scenario: A gutter control is used on touch

- **WHEN** the gutter is shown on a coarse pointer
- **THEN** each of its controls meets the touch target minimum the timeline applies to clips

### Requirement: Lanes are reordered by selection, not by a drag API that touch does not have

A lane SHALL be reordered by selecting its header and then dragging it. An unselected lane header's drag SHALL scroll the timeline; a selected lane header's drag SHALL move the lane. Reordering SHALL NOT require a press-and-hold.

The gutter uses the HTML5 drag-and-drop API, which does not fire on touch at all — track reorder is silently desktop-only today. Selection-arms-manipulation is the rule clips already use for exactly this conflict, and it resolves the pan collision deterministically: an unselected row keeps its pan behavior, a selected row releases it. A hold would reintroduce a timing threshold racing the same gesture, which this editor has twice declined to tune and which cannot be verified without hardware.

#### Scenario: A lane is reordered on touch

- **WHEN** the operator taps a lane header and then drags it to another position
- **THEN** the lane moves, and its clips and its visibility, mute and lock flags move with it

#### Scenario: An unselected lane header is dragged

- **WHEN** the operator drags a lane header that is not selected
- **THEN** the timeline scrolls and no lane moves

#### Scenario: A lane header is tapped and released

- **WHEN** the operator taps a lane header without moving
- **THEN** the lane is selected and nothing moves

#### Scenario: A lane is reordered with a mouse

- **WHEN** a lane is dragged with a fine pointer
- **THEN** it reorders directly, without requiring a prior selection

### Requirement: A clip lands on a lane that accepts it

Placing a clip on a lane whose group does not accept it SHALL route the clip to the nearest lane of the matching group, creating one if none exists. The placement SHALL NOT be rejected, and the clip's time position SHALL be preserved.

A drop on the wrong lane states a time and a kind, both of which are unambiguous; only the row is wrong, and the row is derivable. Rejecting the drop discards two correct pieces of information to punish the third.

#### Scenario: Audio is dropped on a text lane

- **WHEN** an audio asset is dropped on a lane whose group is `text`
- **THEN** it lands on the nearest audio lane at the time it was dropped

#### Scenario: A kind is dropped with no lane to receive it

- **WHEN** a clip is dropped and no lane of its group exists
- **THEN** a lane of that group is created in its canonical position and the clip lands on it

#### Scenario: A clip is dragged between lanes of its own group

- **WHEN** a clip is dragged from one lane to another of the same group
- **THEN** it lands where it was dropped

#### Scenario: A clip is dragged onto a lane of another group

- **WHEN** an existing clip is dragged onto a lane that does not accept it
- **THEN** it routes to the nearest accepting lane rather than snapping back

### Requirement: Lane bookkeeping respects groups

Collision resolution SHALL relocate a dropped clip to another lane of its own group, inserting one adjacent when none is free. Lane compaction SHALL retain empty declared lanes except redundant empty caption lanes. Lane reordering SHALL preserve the canonical group ordering.

Caption cleanup SHALL keep every occupied caption lane and every empty caption lane with active mute, hide or lock settings. When no caption lane contains cues, cleanup SHALL retain the first declared caption lane. Other empty caption lanes SHALL be removed. Compaction SHALL preserve clip times, content and source bindings, and SHALL carry retained lane flags with their clips. Cleanup SHALL preserve existing undo and redo guards.

#### Scenario: A clip is dropped onto an occupied span

- **WHEN** a clip is dropped where it overlaps an existing clip on the same lane
- **THEN** it relocates to another lane of the same group, one being inserted adjacent if none is free

#### Scenario: A lane is emptied by a move

- **WHEN** a move leaves a lane with no clips
- **THEN** the lane remains unless it is a redundant empty caption lane

#### Scenario: Lanes are reordered

- **WHEN** lanes are reordered
- **THEN** the resulting order is consistent with the canonical group ordering

#### Scenario: A layout is organized

- **WHEN** the organize action runs
- **THEN** it lays clips out against the declared lanes rather than inferring a layout from the clips

#### Scenario: Caption retries accumulated empty rows

- **WHEN** a timeline contains several unflagged empty caption lanes above a lane with caption cues
- **THEN** cleanup removes the empty caption lanes and retains the occupied lane
- **AND** saving and reopening preserves the compact layout and cue timing

#### Scenario: All caption cues were deleted

- **WHEN** no caption lane contains cues
- **THEN** cleanup keeps the first declared caption lane and any additional lane with active mute, hide or lock settings

#### Scenario: Caption lanes contain authored state

- **WHEN** caption lanes contain cues or active mute, hide or lock settings
- **THEN** cleanup preserves those lanes and their settings

### Requirement: Existing projects are migrated

A project saved without declared lane groups SHALL have a group inferred for each lane from its clips. A lane holding clips of more than one group SHALL be split into one lane per group, preserving every clip's time position and relative order.

Every existing project has untyped rows, and rows holding several kinds are common because nothing prevented it. Inference reuses the classification that already exists; splitting a mixed row is what the organize command already does within a range.

#### Scenario: A project with single-kind rows is opened

- **WHEN** a project whose rows each hold one kind is opened
- **THEN** each lane takes the group of its clips and no clip moves in time

#### Scenario: A project with a mixed row is opened

- **WHEN** a project has a row holding two groups
- **THEN** it becomes two lanes, and no clip changes its time position

#### Scenario: An empty untyped row is opened

- **WHEN** a project has an empty row with no clips to infer from
- **THEN** the row is either assigned a group or removed, and the result is stable across reopening

#### Scenario: A migrated project is reopened

- **WHEN** a migrated project is saved and reopened
- **THEN** its lanes are unchanged, with no further migration applied

### Requirement: A caption clip shows one line of its text

A caption clip SHALL show its cue text on one line, truncated with an ellipsis when the clip is narrower than the text. The text SHALL NOT wrap, overflow the clip or overflow the lane. Caption clips and the caption lane icon SHALL use a hue and an icon that differ from the `text` group.

#### Scenario: Long cue on a short clip

- **WHEN** a caption clip with the text "candidates for this office" is narrower than its text
- **THEN** the clip shows the start of the text on one line with an ellipsis, inside the clip bounds

#### Scenario: Caption lane beside a text lane

- **WHEN** a caption lane and a text lane are shown with the gutter visible
- **THEN** their gutter icons differ and their clip fills differ

### Requirement: Caption creation reuses its lane

Caption recognition, SRT import and fresh narration SHALL reuse a current caption lane. When no caption clips remain, creation SHALL reuse a declared caption lane. A new lane SHALL be allocated only when neither exists, beyond every occupied or declared free row. Existing lane locks SHALL remain enforced.

#### Scenario: Generate after deletion

- **WHEN** captions are generated after their last cue was deleted
- **THEN** the existing declared caption lane receives the new cues without another lane being appended

#### Scenario: Import into an empty caption lane

- **WHEN** SRT captions are imported into a project with an empty caption lane
- **THEN** that lane receives the cues
- **AND** a locked target lane refuses the import

#### Scenario: Fresh narration with reserved lanes

- **WHEN** fresh narration creates captions while other groups have empty declared lanes
- **THEN** those lanes keep their groups and captions use their existing lane or a new row beyond all declared lanes
