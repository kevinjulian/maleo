# keyframe-animation Specification

## Purpose

One keyframe model for every animatable element: clip-local seconds keys, a single property registry, hold interpolation, one command per property track, and keyframes edited on the selected clip and beside each inspector value.

## Requirements

### Requirement: One animation model for every animatable element

Every animatable element (scene visual, ordinary visual clip, video overlay, text overlay, infographic overlay, audio clip) SHALL carry its animation as one value: a set of per-property tracks, each an ordered list of keys with a time, a value and an optional interpolation. Numeric and colour properties SHALL live in the same value. No clip or overlay SHALL store its own box or style keyframes in any other shape. Scene camera motion and the animation inside reusable composition clips are outside this model.

#### Scenario: Scale and position keys coexist

- **WHEN** an editor keys a scene visual's scale and its canvas position
- **THEN** both are tracks of the same animation value on that visual, and both appear as key lanes on the main timeline

#### Scenario: Text overlay uses the same model

- **WHEN** an editor keys a text overlay's opacity
- **THEN** the key is stored and edited exactly like an image clip's opacity key

### Requirement: Keys are timed in clip-local seconds

Key times SHALL be seconds from the element's own start, within `[0, duration]`. Keys SHALL be strictly increasing in time per track. Resizing or trimming an element SHALL retain each remaining key at its project time and evaluate retained boundaries to their previous values. Animation SHALL NOT stretch with duration. A constant playback-rate retime SHALL scale key times by the rate.

#### Scenario: Extend an animated text overlay

- **WHEN** a text overlay with scale keyed from 0 s to 3 s is extended from 4 s to 6 s
- **THEN** the scale change still completes at 3 s and holds its final value to 6 s

#### Scenario: Trim the head of an animated clip

- **WHEN** the first second of a clip with position keys at 0 s and 2 s is trimmed off
- **THEN** the clip starts at the position previously sampled at 1 s and reaches the 2 s value at its new local 1 s

### Requirement: Properties are declared in one registry

Each animatable property SHALL be declared once with its unit, valid range, neutral default, value type (number or colour), and the element kinds that may animate it. Edits that name an undeclared property, a property not allowed for the element's kind, or an out-of-range value SHALL be rejected without changing the document. Unsupported tracks found in a stored document SHALL block production export and name the affected clip.

#### Scenario: Volume on an image

- **WHEN** a key edit requests a volume track on an image clip
- **THEN** the edit is rejected with a message and the document is unchanged

#### Scenario: Out-of-range scale

- **WHEN** a key edit sets scale to a value outside its declared range
- **THEN** the edit is rejected and the document is unchanged

### Requirement: Interpolation includes hold

Each key SHALL carry the interpolation of the segment that enters it: linear, ease-in, ease-out, ease-in-out, or hold. Hold SHALL keep the previous key's value until the hold key's time and then step to the hold key's value. Before the first key and after the last key, a track SHALL hold its endpoint value. Preview and production export SHALL sample the same value at the same project time for every interpolation.

#### Scenario: Hold steps

- **WHEN** opacity has a key of 1 at 0 s and a hold key of 0 at 2 s
- **THEN** opacity samples 1 at 1.99 s and 0 at 2 s in both preview and export

### Requirement: Canvas edits key properties that are already animated

When an editor moves, resizes, rotates, or changes the opacity of an element on the canvas with the playhead inside that element, each changed property that already has at least one key SHALL receive a key at the playhead's clip-local time. A key already at that time SHALL be replaced with its interpolation kept. Each changed property without keys SHALL update the static value. Proportional corner resize on an element whose scale is keyed SHALL key scale rather than writing a static size. The canvas SHALL display the sampled animated value at the playhead for every element kind. A canvas gesture SHALL commit as one undoable step. Locked tracks SHALL refuse the gesture.

#### Scenario: Drag a keyed position

- **WHEN** an image has position keys and the editor drags it at 3 s, where no key exists
- **THEN** position keys are added at 3 s, other keys are unchanged, and one undo removes them

#### Scenario: Drag an unkeyed property on an animated clip

- **WHEN** a clip has only opacity keys and the editor drags it
- **THEN** the static position changes and no position track is created

#### Scenario: Resize a scale-keyed text overlay

- **WHEN** a text overlay's scale is keyed and the editor drags a locked-aspect corner at 2 s
- **THEN** a scale key is written at 2 s and the overlay's static size is unchanged

### Requirement: One command replaces a property track

The editor command vocabulary SHALL include a command that replaces one property track of one clip with a given list of keys, where an empty list removes the track. Its inverse SHALL restore the clip's prior state exactly, including any defaults the edit had to materialize. Every key edit from the inspector, timeline key lanes, canvas auto-key, and the agent SHALL be expressible as this command or a batch of it. The command SHALL apply the registry and timing validation above and SHALL be a no-op returning the input scope when the track would not change.

#### Scenario: Agent and canvas produce the same command kind

- **WHEN** the agent sets scale keys on a clip and an editor later drags that clip's keyed scale on the canvas
- **THEN** both edits are recorded as the same command kind, and undo reverses each independently

#### Scenario: Clear a track

- **WHEN** the command is issued with an empty key list for a keyed property
- **THEN** that property returns to its static value and undo restores the keys

### Requirement: Motion Studio edits text animation through the model

Where Motion Studio edits a text overlay's animation, opening it SHALL present the overlay's tracks in Motion Studio's existing normalized form, and saving SHALL write them back as clip-local seconds. Motion Studio's interface, its saved presets, and the normalized animation stored inside reusable composition clips SHALL be unchanged.

#### Scenario: Round trip through Motion Studio

- **WHEN** a text overlay with opacity keys at 0 s and 2 s on a 4-second clip is opened in Motion Studio and saved without edits
- **THEN** the overlay's opacity keys are still at 0 s and 2 s with the same values and interpolation

### Requirement: Keys are shown and edited on the selected clip

The selected clip SHALL show one ◆ marker on its own timeline bar for each moment that holds keys, where a moment merges key times across all of its properties that lie within one frame of each other. Unselected clips SHALL show no markers. Activating a marker SHALL seek to it and select that moment; Shift-activating SHALL add or remove it from the selection, and a box-drag across its expanded keyframe lanes SHALL select the moments inside the sweep (a drag on the clip bar itself still moves the clip). Dragging a selected marker SHALL retime every selected moment by the same offset as one undoable step; arrow keys SHALL nudge the selection by one frame; Delete SHALL remove every key at the selected moments. A timeline Easing control SHALL set the interpolation (linear, ease-in, ease-out, ease-in-out, hold) of every key at the selected moments as one undoable step and SHALL be unavailable when no moment is selected. A clip's context menu SHALL offer Expand keyframes, which shows its per-property lanes directly beneath its own track row until collapsed.

#### Scenario: One marker per moment

- **WHEN** a clip has position and scale keys at 2 s and an opacity key at 3 s, and the clip is selected
- **THEN** its bar shows exactly two markers, at 2 s and 3 s, and no other clip shows markers

#### Scenario: Retime a multi-selection

- **WHEN** the editor selects the 2 s marker, Shift-selects the 3 s marker, and drags the 2 s marker to 2.5 s
- **THEN** the position and scale keys move to 2.5 s, the opacity key moves to 3.5 s, and one undo restores all three

#### Scenario: Ease the selection

- **WHEN** two moments are selected and the editor chooses Hold in the Easing control
- **THEN** every key at both moments uses hold, and one undo restores their previous easings

#### Scenario: Delete a moment

- **WHEN** the editor selects the 2 s marker and presses Delete
- **THEN** every key at 2 s is removed and one undo restores them

#### Scenario: Expand from the clip menu

- **WHEN** the editor chooses Expand keyframes from a selected clip's context menu on the second track
- **THEN** its per-property lanes render directly below the second track row and above the next track, and Collapse keyframes hides them

### Requirement: The inspector arms keyframes before the property label

Each inspector row holding animatable properties SHALL show one keyframe toggle before the row label, covering every animatable property in that row (for example, the Position row covers X and Y). The toggle SHALL be on when any property of the row has a key at the playhead. Turning it on SHALL add a key holding the current value to each property of the row that has no key at the playhead; turning it off SHALL remove the keys at the playhead from every property of the row. The toggle SHALL be unavailable while the playhead is outside the clip. Editing a value in a row where any property already has keys SHALL key every animatable property of that row at the playhead, the unedited ones holding their sampled values; editing a value in a row without keys SHALL change static values. The inspector SHALL NOT offer a separate keyframe-editing section.

#### Scenario: Arm, then key by editing

- **WHEN** the editor turns on the Opacity row toggle at 0 s, moves the playhead to 2 s and sets Opacity to 40 %
- **THEN** opacity has keys at 0 s (the previous value) and 2 s (0.4)

#### Scenario: One toggle keys the whole row

- **WHEN** the editor turns on the Position row toggle at 1 s on a clip without position keys
- **THEN** both X and Y have a key at 1 s holding their current values

#### Scenario: Editing one field keys its row partner

- **WHEN** the Position row has keys and the editor changes only X at 3 s
- **THEN** X and Y both have a key at 3 s, and Y's key holds its value sampled at 3 s

#### Scenario: Toggle outside the clip

- **WHEN** the playhead is outside the selected clip
- **THEN** every keyframe toggle is unavailable and value edits change static values

### Requirement: An edit near an existing key updates it

A keyed edit made within 0.1 s of an existing key of that property SHALL update that key's value, keep its time and interpolation, and SHALL NOT add a second key.

#### Scenario: Slightly off the key

- **WHEN** opacity has keys at 0 s and 2 s and the editor sets opacity at 2.05 s
- **THEN** the 2 s key holds the new value and opacity still has exactly two keys
