# vui-timeline-surface Specification

## Purpose

TBD - created by syncing change rebuild-vui-video-editor-library. Update Purpose after archive.

## Requirements

### Requirement: A gesture is owned by the surface, not by the item it acts on

Pointer capture SHALL be taken on a stable surface root. The item a gesture concerns SHALL be resolved by hit-testing and carried as gesture payload. Gesture state SHALL live in the store keyed by gesture identity, and SHALL NOT be held in a component belonging to the item.

An item SHALL be free to re-render, change parent, or unmount while a gesture concerning it is in flight, without the gesture being cancelled.

The previous implementation attached the pointer controller to the item's own element. Writing a row change during a drag re-parented that element, which unmounted it, disposed the controller, and reported a cancel — measured as `begin`, `update`, `unmount`, then `cancel` at (0,0), with the item snapping back. Virtualization makes this the normal case rather than an edge case.

#### Scenario: The dragged item unmounts mid-gesture

- **WHEN** an item is dragged and the consumer's state change causes that item's element to unmount and remount elsewhere
- **THEN** the gesture continues, the next pointer sample is applied, and the gesture ends with the terminal phase the pointer actually produced

#### Scenario: The dragged item scrolls out of the virtualized window

- **WHEN** a drag carries an item beyond the visible range so its element is recycled
- **THEN** the gesture continues and commits correctly on release

#### Scenario: The surface is removed

- **WHEN** the surface root itself unmounts during a gesture
- **THEN** the gesture reports `rollback`, capture is released, and no listener, frame request, or capture remains

### Requirement: Every terminal path is reported

The surface SHALL report `pointercancel`, lost pointer capture, `Escape`, and surface unmount as a cancellation, and pointer release as a commit. Exactly one terminal phase SHALL be delivered per gesture.

#### Scenario: Capture is taken away by the browser

- **WHEN** the browser fires `lostpointercapture` during a drag
- **THEN** the gesture reports `rollback`, the item returns to its pre-gesture position, and a subsequent press is handled normally

#### Scenario: Escape is pressed mid-drag

- **WHEN** `Escape` is pressed while a drag is in flight
- **THEN** the gesture reports `rollback` and the pointer release that follows produces no second terminal phase

### Requirement: The timeline paints on a canvas and exposes a sparse interactive DOM

The surface SHALL paint item bodies, waveforms, filmstrips, ruler ticks, and overlays to a canvas. It SHALL maintain DOM elements only for items and affordances that are within the visible range and are focusable or interactive.

The number of mounted DOM nodes SHALL be a function of the visible range, not of the total item count.

#### Scenario: A large project is opened

- **WHEN** a timeline holding two thousand items is displayed with fifty of them visible
- **THEN** the mounted interactive node count is proportional to the visible items, and does not grow with the two thousand

#### Scenario: The visible range moves

- **WHEN** the viewport scrolls so a different set of items is visible
- **THEN** nodes outside the visible range are released and nodes for newly visible items are created, without disturbing any gesture in flight

### Requirement: Painted content remains reachable by keyboard and by assistive technology

Every item and affordance a person can act on SHALL have a real focusable element with an accessible name and role, whether or not its pixels are painted on the canvas. Painting SHALL NOT be the only representation of anything interactive.

The surface SHALL support keyboard selection, seek, move, and trim, with a configurable step, and SHALL announce a committed result through a live region that is present in the document before its text changes.

#### Scenario: The timeline is operated without a pointer

- **WHEN** a person tabs to the timeline and uses the documented keys to select an item, move it, and trim it
- **THEN** each operation applies, and the committed result is announced

#### Scenario: A live region reports a result

- **WHEN** an operation commits
- **THEN** the announcement lands in a live region that was already in the document, rather than one mounted together with its first text

### Requirement: Painted geometry is assertable without reading the DOM

The surface SHALL expose a query interface returning the computed geometry and state of items by identity, for use by tests and by consumers building their own assertions.

Painted items have no DOM box to measure. Without a query interface, the behaviour a test suite covers today by reading element boxes becomes unassertable.

#### Scenario: A test asserts an item's position

- **WHEN** a test queries an item by identity
- **THEN** it receives that item's time box, paint box, hit box, and interaction state, in the same units the kernel computed them

### Requirement: The timeline has two axes, and the cross axis belongs to the consumer

The surface SHALL resolve the time axis. It SHALL obtain the cross axis from a consumer-supplied adapter that maps a cross-axis coordinate to a row, maps a row back to a coordinate, declares row ordering, declares each row's height, and declares which rows accept which items.

Row height SHALL be permitted to differ between rows. The surface SHALL NOT assume a uniform row height, and SHALL NOT require the consumer to keep a row height in code in agreement with one expressed in styling.

A gesture SHALL report the cross-axis row it currently resolves to, and an operation SHALL be able to name a destination row.

Only the consumer knows its lane taxonomy. Making the library re-derive rows from a DOM lookup would reintroduce the private-DOM dependency the library exists to remove.

#### Scenario: An item is dragged between rows

- **WHEN** a drag crosses the boundary between two rows the adapter declares adjacent
- **THEN** the projection reports the destination row, and the committed operation names it

#### Scenario: A destination row refuses the item

- **WHEN** a drag resolves to a row whose adapter declares it does not accept that item
- **THEN** the projection reports the row as refused, and a commit at that position either declines or resolves to an accepting row, as the adapter specifies

#### Scenario: A consumer has one row

- **WHEN** a consumer supplies no cross-axis adapter
- **THEN** the surface behaves as a single-row timeline and no operation carries a row

#### Scenario: Rows differ in height

- **WHEN** an adapter declares rows of differing heights and a pointer is placed within each
- **THEN** each position resolves to the row that visually contains it, with no row height assumed or duplicated by the surface

#### Scenario: A row height changes

- **WHEN** a consumer changes a row's height
- **THEN** coordinate-to-row resolution follows it immediately, without any constant in the surface needing to be updated to match

### Requirement: The viewport is written by one path

Scroll, resize, zoom, and pan SHALL be dispatched as events to the kernel. The surface SHALL apply the published viewport to the scroller, and SHALL NOT treat a scroll event that its own application produced as new input.

#### Scenario: A zoom lands while a scroll is queued

- **WHEN** a scroll event queued before a zoom is delivered after it
- **THEN** the published viewport retains the zoom, and the focal point does not drift

#### Scenario: A zoom holds its focal point

- **WHEN** the viewport is zoomed about a point, by wheel or by two pointers
- **THEN** the time under that point after the zoom equals the time under it before, within one device pixel, and the page's own scale and scroll position are unchanged

### Requirement: The viewport follows the playhead during playback

While a timeline surface's renderer is playing, the surface SHALL keep the playhead within its visible width, on every timeline surface rather than on whichever one implemented it first. A follow the surface issues SHALL NOT be re-observed as operator input.

A surface that holds its playhead at the centre (the phone editor timeline, see `timeline-touch-interaction`) SHALL NOT use this follow: centring keeps the playhead visible by a stronger rule, and two writers of one scroller would fight.

Every editor timeline scrolls its own scroller, and one hook serves all three. A surface follows only when its content exceeds its visible width; where the content fits there is nothing to follow, and that state SHALL NOT be mistaken for an inability to follow.

Following SHALL yield to the operator: while a scroll, pan or drag gesture is in progress the surface SHALL NOT move the viewport underneath it. A view that fights the finger is worse than one that does not follow at all.

The playhead's position SHALL be measured against the scrollable width, excluding any sticky gutter, since the gutter occupies visible width the playhead can never appear in. Each surface SHALL supply its own gutter rather than a shared implementation naming one: the content editor's is `.tl2-gutter` and the studios' is `.vui-timeline-gutter`, so a hook that named either would measure zero on the others and follow short by the gutter's width.

Both studios had no follow at all, because it was only reachable through a hook
about dragging clips. Playing past the visible width left the operator watching
a timeline that no longer showed where playback was, on a surface whose whole
purpose is to show where playback is.

This requirement also carried a claim that the content editor's follow was dead
— that it wrote `scrollLeft` to a kernel-windowed element which could never
overflow. **That was wrong, and how it was got wrong is the part worth keeping.**
It came from measuring one width: at 1440x900 that scroller reports
`scrollWidth === clientWidth` and a write to `scrollLeft` reads back 0. The
fixture project is three SECONDS long, so even at maximum zoom its content fits
the lane area, and an element with nothing to scroll clamps `scrollLeft` to 0
exactly as it should. Driven at 393px the same call follows: `scrollWidth` 745
against `clientWidth` 393, `scrollLeft` running 0 → 15 → 191 → 352.

So coverage for this requirement SHALL be taken at a width where the surface's
content exceeds its view. "Nothing to scroll here" is not "cannot scroll
anywhere", and a surface whose content happens to fit proves nothing in either
direction — which is how a working follow read as a dead one for the length of a
change.

#### Scenario: Playback reaches the edge of the visible width

- **WHEN** the playhead advances beyond the visible width of a timeline during playback
- **THEN** the viewport moves to keep the playhead visible, with the playhead inside the padded region rather than against the edge

#### Scenario: The playhead is already visible

- **WHEN** the playhead advances while remaining inside the padded visible region
- **THEN** the viewport does not move

#### Scenario: The operator scrolls during playback

- **WHEN** the operator scrolls, pans or drags while the renderer is playing
- **THEN** the surface does not move the viewport under the gesture

#### Scenario: Playback is stopped

- **WHEN** the renderer is not playing
- **THEN** the viewport does not follow, and seeking moves it only by whatever rule governs seeking

#### Scenario: A surface has a sticky gutter

- **WHEN** a timeline draws a gutter that stays fixed while lanes scroll
- **THEN** the followed position accounts for that gutter's width on that surface, rather than for a width read from another surface's markup

#### Scenario: A surface's content fits its view

- **WHEN** a timeline's content is narrower than its visible width
- **THEN** the viewport does not move during playback, and this is not evidence that the surface cannot follow

### Requirement: The viewport accounts for a scroller's lead

A surface whose scroller has leading padding SHALL report that padding to the kernel as the viewport's `leadPx`. The kernel SHALL map a scroll offset to a view start by subtracting `leadPx`, SHALL write a view start back as an offset that includes `leadPx`, and SHALL let the view start up to `leadPx` before time zero. A viewport with no `leadPx` SHALL behave as a lead of zero, so that a surface with no padding does not change.

The kernel's published item geometry SHALL agree with the item's drawn box when the scroller has a lead.

#### Scenario: A led scroller is at offset zero

- **WHEN** a scroller with a lead of half its width is scrolled to offset 0
- **THEN** the kernel view starts that lead before time zero, and the kernel does not write the scroller to a different offset

#### Scenario: A drag reaches the right edge of a led scroller

- **WHEN** a clip drag rests at the right edge of the phone timeline
- **THEN** the edge autoscroll moves the view, up to the point where the project end is at the centre

#### Scenario: Geometry on a led scroller

- **WHEN** a test reads kernel geometry for a clip on the scrolled phone timeline
- **THEN** the reported left edge is within 1 px of the clip's drawn left edge, measured from the scroller's visible left edge
