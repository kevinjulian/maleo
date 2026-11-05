## ADDED Requirements

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

## MODIFIED Requirements

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
