# inspector-field-layout Specification

## Purpose

How editor property surfaces present values: scrubbable number fields instead of sliders, related values grouped into shared rows, the width-driven size lock, and rows that fit phone width.

## Requirements

### Requirement: Property values use scrubbable number fields, not sliders

Every numeric property in the clip inspector, the text style editor, the data callout panel and the captions panel SHALL be edited through one number field per value. The field SHALL show a short label inside it (for example X, Y, W, H, a degree mark or a percent mark), SHALL change the value when that label is dragged horizontally, SHALL accept a typed value, SHALL show the value's unit after it, and SHALL step with the arrow keys. A row whose values differ from their defaults SHALL offer one reset that returns every value of the row to its default. These surfaces SHALL NOT render a slider for a property value. Each field SHALL keep an accessible name naming the property (for example "X offset", "Opacity").

#### Scenario: Scrub a value

- **WHEN** an operator drags the label of the Opacity field to the left
- **THEN** opacity decreases while dragging, and releasing commits one undo step

#### Scenario: Type a value

- **WHEN** an operator types 45 in the Rotation field and presses Enter
- **THEN** the clip's rotation is 45 degrees

#### Scenario: No sliders

- **WHEN** an operator opens any group of the clip inspector, the captions panel or the data callout panel
- **THEN** no property value is shown as a slider

#### Scenario: Reset a changed row

- **WHEN** a clip's brightness is not at its default and the operator chooses the Adjust row's reset
- **THEN** brightness, contrast and saturation return to their defaults in one undo step

### Requirement: Related values share a row

Property surfaces SHALL group values that are edited together into one row of two or three fields under one row label. At least these rows SHALL exist where the property is offered:

- Transform: Position (X, Y); Size (width, size lock, height); Rotation (angle, flip horizontal, flip vertical); Fit as a segmented choice; Crop (X, Y) and (width, height) in a section that starts collapsed.
- Blending: opacity and blend mode in one row.
- Masks: shape and invert; position (X, Y); size (width, lock, height); rotation and feather.
- Adjust: brightness, contrast and saturation in one row.
- Audio: volume and under-voice level; fades (in, out).
- Timing: start and duration; trim (in, out); playback (rate, reverse).
- Text: size and weight; fill and alignment; line height and letter spacing.
- Data callout: background colour and opacity; border colour and opacity; radius and blur.
- Reveal, effect and transition settings: delay and duration; reveal time and intensity; duration and colour phase, where offered.
- Captions: chunking (words, characters, pause); layout (vertical position, maximum width); shadow (blur, distance, opacity).

A group with a single value SHALL keep it on its own row.

#### Scenario: Transform reads as grouped rows

- **WHEN** an operator opens Transform on an image overlay
- **THEN** X and Y share the Position row, width and height share the Size row with the lock between them, and rotation shares its row with the flip toggles

#### Scenario: Adjust in one row

- **WHEN** an operator opens Adjust on a video overlay
- **THEN** brightness, contrast and saturation appear side by side in one row

### Requirement: The size lock keeps the ratio from width

The Size row SHALL place a lock toggle between width and height. While the lock is on, editing width SHALL change height to keep the aspect ratio, and the height field SHALL be unavailable. While the lock is off, width and height SHALL change independently. The inspector SHALL NOT offer a separate Scale field. The visual clip lock SHALL be the clip's stored aspect lock. The mask size lock SHALL follow the same rule, and SHALL be editor state only, not saved with the document.

#### Scenario: Locked size follows width

- **WHEN** the size lock is on and an operator sets width from 50 % to 60 % on a clip 50 % wide and 25 % tall
- **THEN** height becomes 30 % and the height field cannot be edited

#### Scenario: Unlocked size edits alone

- **WHEN** the size lock is off and an operator sets width to 20 %
- **THEN** height keeps its value

#### Scenario: Mask lock is not saved

- **WHEN** an operator turns on the mask size lock and reloads the project
- **THEN** the mask's width and height are unchanged and the mask lock is off

### Requirement: Rows fit phone width

At phone width a row of three fields SHALL wrap to two fields and one, and a row of two fields SHALL stay on one line. No field SHALL be narrower than its value and unit, and no row SHALL cause horizontal scrolling of the inspector.

#### Scenario: Adjust wraps on a phone

- **WHEN** Adjust is open in the inspector sheet at 320 px width
- **THEN** brightness and contrast share the first line, saturation sits on the second, and the sheet does not scroll horizontally
