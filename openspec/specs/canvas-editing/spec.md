# canvas-editing Specification

## Purpose

The engine owns editing on the preview canvas. Every platform sends the same abstract input and
gets the same boxes, guides and commands back, so an edit on the canvas does the same thing on
the web, desktop and mobile clients.

## Requirements

### Requirement: The engine maps screen points to canvas points

The engine SHALL convert a point on the screen to a point on the canvas from the canvas
rectangle on the screen, the fit and letterbox of the preview, the zoom, the pan and the pixel
density the platform reports. A point outside the canvas SHALL map to a canvas point outside
`[0, 100]` percent, not be clamped.

#### Scenario: A letterboxed preview

- **WHEN** a 16:9 canvas is fitted into a square preview area and the platform sends the screen point at the center of that area
- **THEN** the canvas point is 50 percent, 50 percent

#### Scenario: A point in the letterbox

- **WHEN** the platform sends a point in the letterbox band above the canvas
- **THEN** the canvas point has a vertical value below 0 percent

### Requirement: Element boxes follow the playhead

The engine SHALL give the box of each element visible at a time as a rotated rectangle in
canvas percent. An element with animated position, size, scale, rotation or opacity SHALL have
its box at the values sampled at that time. The box of the selected element, its handles and
the snap guides SHALL come from the engine; a platform SHALL NOT compute them.

#### Scenario: An animated element moves under the playhead

- **WHEN** an element has position keys at 0 s (x 10 percent) and 2 s (x 50 percent) with linear easing and the playhead is at 1 s
- **THEN** its box has x 30 percent

### Requirement: Hit testing picks the topmost element under a point

The engine SHALL return the topmost pickable element under a canvas point, in the order the
preview stacks elements, using the rotated box at the playhead. A handle of the selected element
SHALL win over any element under it. An element on a hidden or locked track SHALL NOT be picked.
The base scene SHALL be picked only when no other element is under the point.

#### Scenario: A rotated element

- **WHEN** an element is rotated 45 degrees and the point is inside its axis-aligned bounds but outside the rotated box
- **THEN** the element is not picked

#### Scenario: Overlapping elements

- **WHEN** a text element is stacked above an image element and the point is inside both
- **THEN** the text element is picked

#### Scenario: A locked track

- **WHEN** the only element under the point is on a locked track
- **THEN** the base scene is picked, or nothing when the base scene track is locked

### Requirement: Gestures move, resize and rotate with snapping

The engine SHALL run move, corner resize and rotate gestures from the input events. A resize
SHALL keep the aspect ratio when the element is aspect-locked or the shift modifier is held. The
position SHALL stay within -50 to 150 percent, the size within 2 to 200 percent and the rotation
within -180 to 180 degrees. Without the alt modifier, a box edge or center within 2 percent of a
canvas edge or the canvas center SHALL snap to it and the engine SHALL report that guide;
otherwise the position SHALL snap to a 5 percent grid, and a rotation SHALL snap to 15 degree
steps. With the alt modifier, nothing SHALL snap.

#### Scenario: A drag snaps to the center

- **WHEN** an editor drags an element so that its center is 1.5 percent left of the canvas center
- **THEN** the element's center is at the canvas center and a vertical guide shows at 50 percent

#### Scenario: Alt turns snapping off

- **WHEN** the editor makes the same drag with the alt modifier held
- **THEN** the element's center stays 1.5 percent left of the canvas center and no guide shows

#### Scenario: An aspect-locked resize

- **WHEN** an editor drags a corner of an aspect-locked element
- **THEN** its width and height change by the same factor

### Requirement: A gesture previews a transient change and commits one command

While a gesture runs, the preview SHALL show the changed element, and the document and the undo
history SHALL NOT change. On release, the engine SHALL make one editor command for the gesture
under the rules of the keyframe-animation capability: a property that already has keys gets a key
at the playhead, and the rest changes its static value. A gesture that is cancelled, released
without a change, or started on a locked element SHALL make no command.

#### Scenario: A drag commits one undo step

- **WHEN** an editor drags an element through 40 pointer moves and releases it
- **THEN** the document changes once, and one undo restores the element's prior position

#### Scenario: Escape cancels a drag

- **WHEN** an editor presses Escape during a drag
- **THEN** the element shows its prior position and the document is unchanged

#### Scenario: A keyed position

- **WHEN** an editor drags an element whose position has keys while the playhead is inside it
- **THEN** the command sets a position key at the playhead and does not change the static position

### Requirement: The keyboard nudges the selection

With a handle focused, an arrow key SHALL move, resize or rotate the selected element by 1
percent or 1 degree, and by 10 with the shift modifier, under the same limits as a gesture. Each
key press SHALL make one editor command.

#### Scenario: Nudge right

- **WHEN** an editor presses the right arrow key on the move handle of an element at x 20 percent
- **THEN** the element is at x 21 percent and one undo returns it to 20 percent

### Requirement: A multi-selection transforms as a group

A shift-click on the canvas SHALL add the element under the point to the selection, or remove it
when it is selected, through the shared selection rules. With two or more elements selected, the
engine SHALL show one group box around their rotated boxes. Moving the group box SHALL move every
selected element by the same amount. Resizing it SHALL scale every element's position and size
by one factor about the opposite corner, so a rotated element keeps its shape. Rotating it SHALL turn every element's center about the group center
and add the angle to each element's rotation. Snapping SHALL use the group box. The gesture SHALL
commit as one undo step, with each element's change following the keyframe rule. When any
selected element is on a locked track, the group gesture SHALL make no change.

#### Scenario: Move two elements

- **WHEN** an editor selects two elements with shift-click and drags the group box 10 percent to the right
- **THEN** both elements move 10 percent to the right and one undo restores both

#### Scenario: Rotate a group

- **WHEN** an editor rotates a group of two unrotated elements by 90 degrees
- **THEN** each element's center turns 90 degrees about the group center and each element's rotation is 90 degrees

#### Scenario: A locked member

- **WHEN** one of the selected elements is on a locked track and the editor drags the group box
- **THEN** no element changes

### Requirement: Pinch and twist scale and rotate the selection

A two-finger pinch on the canvas SHALL scale the selection about its center, and a twist SHALL
rotate it, under the same limits, snapping and commit rules as a corner resize and a rotate.

#### Scenario: Pinch out

- **WHEN** an editor pinches out on a selected element until the finger distance is doubled
- **THEN** the element's width and height are doubled about its center, within the size limit, and one undo restores them

### Requirement: The mask box edits the mask

In mask editing, the engine SHALL show the box of the selected element's mask region, and the
move, resize and rotate gestures on that box SHALL change only the mask, with the same snapping
and commit rules.

#### Scenario: Drag the mask

- **WHEN** an editor drags the mask box of an element in mask editing
- **THEN** the mask region moves, the element's position is unchanged, and one undo restores the mask
