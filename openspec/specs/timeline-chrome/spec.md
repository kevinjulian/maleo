# timeline-chrome Specification

## Purpose

The main editor timeline's viewport furniture: the playhead, the ruler, the
gutter-and-lanes scroll layout, selected-row marking, and the toolbar's
snapping and ripple editing modes.

## Requirements

### Requirement: Time indicators span the timeline viewport

The playhead, the snap guide and the hover cursor SHALL each extend from the top of the ruler to the bottom of the visible lane area. This SHALL hold whether the lanes fill the viewport or not. None of them SHALL extend under the horizontal scrollbar.

#### Scenario: A project with few lanes

- **WHEN** a project whose lanes are shorter than the timeline panel is open
- **THEN** the playhead line reaches the bottom of the panel's lane area, not the bottom of the last lane

#### Scenario: Empty space below the lanes

- **WHEN** the operator presses the empty area below the last lane with a fine pointer
- **THEN** the playhead seeks to that time and the selection clears exactly as it would on empty lane space

#### Scenario: A snap guide during a drag

- **WHEN** a dragged clip snaps to a candidate in a project with few lanes
- **THEN** the snap guide spans the same height as the playhead

### Requirement: The gutter stays outside the horizontal scroll

When the track gutter is visible, it SHALL be a fixed column beside the lanes. The horizontal scroll range SHALL begin at the lanes' time origin, and no lane content SHALL scroll underneath the gutter. Vertical scrolling SHALL keep gutter rows aligned with their lanes, whether it starts from the lanes, from the gutter, from a wheel or from touch.

#### Scenario: Scrolled to the start

- **WHEN** the timeline's horizontal scroll position is at its minimum
- **THEN** time zero sits immediately right of the gutter and the horizontal scrollbar starts at the lanes' left edge

#### Scenario: Vertical scroll from the gutter

- **WHEN** the operator scrolls vertically over the gutter by wheel or by touch
- **THEN** the lanes scroll by the same amount and each gutter row stays beside its lane

#### Scenario: Gutter hidden

- **WHEN** the gutter is hidden
- **THEN** the lanes occupy the full width and the behaviour is otherwise unchanged

### Requirement: The ruler adapts its marks to zoom and frame rate

The ruler SHALL label times at intervals that keep labels apart by a readable minimum. It SHALL draw minor ticks at a denser interval that divides the label interval evenly. At high zoom both intervals SHALL descend to whole frames of the project frame rate.

- A label on a whole second SHALL read `M:SS`.
- A label between whole seconds SHALL read as a frame count, such as `15f`.
- Minor ticks SHALL be short marks at the ruler's top edge.
- A labelled time SHALL be shown by its text alone, with no full-height line.

The ruler SHALL create marks only for the visible time range plus a buffer. It SHALL NOT create marks for the whole project duration.

#### Scenario: Zoomed in past one second per label

- **WHEN** zoom is high enough that a whole-second interval would leave more space between labels than needed
- **THEN** labels appear at frame intervals, such as every 5 or 10 frames, and read as frame counts between whole seconds

#### Scenario: Labels land on ticks

- **WHEN** the ruler is drawn at any zoom
- **THEN** every label's time is also a tick time

#### Scenario: A long project at high zoom

- **WHEN** a ten-minute project is viewed at maximum zoom
- **THEN** the number of ruler marks in the document is bounded by the viewport width, not by the project duration

### Requirement: The playhead is a keyboard-operable slider

The playhead SHALL be focusable and SHALL expose itself to assistive technology as a slider. It SHALL report its minimum, its maximum (the project duration) and its current time.

- While the playhead is focused, the left and right arrow keys SHALL move it back or forward by one frame, clamped to the project.
- While the playhead is focused, those keys SHALL NOT nudge a selected clip.
- The reported current time SHALL stay current during playback without re-rendering the timeline.

#### Scenario: Frame step by keyboard

- **WHEN** the playhead is focused and the operator presses the right arrow key
- **THEN** the playhead advances by exactly one frame and the preview seeks there

#### Scenario: Clip selected while playhead focused

- **WHEN** a clip is selected and the focused playhead receives the left arrow key
- **THEN** the playhead moves and the clip does not

#### Scenario: Announced value during playback

- **WHEN** playback runs and stops
- **THEN** the playhead's reported current time equals the stopped time

### Requirement: A lane holding the selection is marked

A lane that contains at least one selected clip SHALL be tinted, and so SHALL its gutter row. Selecting or deselecting a clip SHALL re-render only the lanes whose marked state changes.

#### Scenario: A clip is selected

- **WHEN** the operator selects a clip on an audio lane
- **THEN** that lane and its gutter row are tinted and no other lane is

#### Scenario: Selection moves between clips on one lane

- **WHEN** selection moves from one clip to another clip on the same lane
- **THEN** the lane stays tinted and the other lanes do not re-render for the tint

### Requirement: Snapping can be turned off

The timeline toolbar SHALL offer a snapping toggle, on by default.

- While snapping is off, moving or trimming a clip SHALL NOT snap to any candidate and SHALL show no snap guide.
- The setting SHALL persist across sessions in the same browser.

#### Scenario: Snapping off

- **WHEN** snapping is off and a clip is dragged to within the snap threshold of the playhead
- **THEN** the clip lands at the pointer's time, not at the playhead, and no snap guide appears

#### Scenario: Preference persists

- **WHEN** the operator turns snapping off and reloads the editor
- **THEN** snapping is still off

### Requirement: Ripple editing is a mode

The timeline toolbar SHALL offer a ripple editing toggle, off by default.

While ripple editing is on:

- Trimming a clip's edge SHALL shift the later clips on the same lane by the same amount, so no gap opens and no overlap forms.
- Delete, Backspace and the toolbar's delete control SHALL remove the selection and close the gap it leaves.

While ripple editing is off:

- Trims and deletes SHALL behave as they do today.
- Holding Shift with Delete or Backspace SHALL perform a ripple delete.

While ripple editing is on, holding Shift with Delete or Backspace SHALL perform a plain delete.

The setting SHALL persist across sessions in the same browser.

#### Scenario: Ripple trim

- **WHEN** ripple editing is on and the operator drags a clip's end edge 2 seconds earlier
- **THEN** every later clip on that lane moves 2 seconds earlier as one undoable step

#### Scenario: Ripple delete from the toolbar

- **WHEN** ripple editing is on and the operator presses the toolbar delete control with a clip selected
- **THEN** the clip is removed and the later clips on its lane close the gap as one undoable step

#### Scenario: Shift inverts the mode

- **WHEN** ripple editing is off and the operator presses Shift+Delete with a clip selected
- **THEN** the clip is ripple deleted

### Requirement: The toolbar groups edit actions apart from view controls

The desktop timeline toolbar SHALL place controls in three regions:

- **Leading**: edit actions — history, split, trim, duplicate, delete, bookmarks and hook takes.
- **Centre**: the transport.
- **Trailing**: in order, the snapping and ripple editing toggles, then the view toggles, then zoom.

Duplicate and delete SHALL be disabled when nothing is selected. Every icon-only control SHALL carry an accessible name and a tooltip. A toggle's active state SHALL be visible without hovering.

#### Scenario: Nothing selected

- **WHEN** no clip is selected
- **THEN** the duplicate and delete controls are disabled and announce as disabled

#### Scenario: Toggle state visible

- **WHEN** snapping is on and ripple editing is off
- **THEN** the snapping control renders in its active style and the ripple control in its inactive style

### Requirement: Space controls active editor playback

While the editor transport owns the active surface, Space SHALL toggle play/pause once per physical press and SHALL NOT activate a focused button, link, checkbox, radio or option control. Repeated keydown events and key release SHALL NOT toggle again or invoke the control's default action. Editable text inputs, textareas, contenteditable regions and IME composition SHALL retain text-entry ownership. Other control keys SHALL retain their established behavior. Independent modal and studio scopes SHALL prevent background editor transport shortcuts.

#### Scenario: Focus remains on an editor action

- **WHEN** an operator focuses Split or Delete and presses and releases Space
- **THEN** playback toggles once and that action is not invoked

#### Scenario: Space in editable text

- **WHEN** an operator presses Space inside a text input, textarea or nested contenteditable region
- **THEN** a space is entered and playback does not change

#### Scenario: Held Space

- **WHEN** an operator holds Space and the browser emits repeated keydown events
- **THEN** playback toggles once until a new physical press

#### Scenario: Editor option list is focused

- **WHEN** an operator presses Space in an editor-owned option picker
- **THEN** playback toggles once and no option is selected
- **AND** Enter and arrow navigation remain available for selection

#### Scenario: Modal has focus

- **WHEN** an independent modal or studio owns keyboard focus
- **THEN** Space does not toggle background editor playback

#### Scenario: Editor checkbox remains keyboard accessible

- **WHEN** an operator focuses an enabled editor checkbox and presses and releases Enter
- **THEN** its checked state toggles once without changing playback
- **AND** held Enter does not toggle repeatedly, and disabled or independently modal controls retain their scope
