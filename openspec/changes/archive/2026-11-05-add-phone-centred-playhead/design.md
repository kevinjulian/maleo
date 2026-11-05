# Design

## Context

The phone editor timeline is one scroller (`.tl2-tlscroll`). The playhead is an
element inside the lanes at `sec * pxPerSec`. `useFollowPlayhead` moved the
scroller during playback only. The VUI drag kernel (`models/timeline-view/`)
keeps its own viewport and assumed that time zero is at the scroller's left
edge.

## Decisions

### One equation, read in both directions

With leading padding equal to half the scroller width, time `t` is under the
centre exactly when `scrollLeft === t * pxPerSec`. A playhead change writes
`scrollLeft`. An operator scroll reads `scrollLeft` and seeks. No overlay
playhead is necessary: the existing playhead element is at the centre because
the scroll position puts it there.

### Padding is measured, not declared in CSS

A `50%` padding resolves against the containing block. That block includes the
label gutter when the gutter shows, so the centre would be wrong. The hook sets
the padding from `clientWidth` and keeps it current with a `ResizeObserver`.

### Only operator input seeks

The browser fires `scroll` for offsets that nobody chose: a write that the
browser clamps before the lanes have full width, and the drag kernel's viewport
syncs. When the hook read every scroll as a seek, a seek to 8.00 s landed on
7.56 s, and at startup the playhead went to the project end. Now a scroll seeks
only while a pointer is down on the scroller, or for 300 ms after a touch, a
wheel, a release or a counted scroll. Each counted scroll extends the window, so
the momentum of a fling also seeks.

Rejected: seek on every scroll that is not an echo of the hook's own write. That
also seeks on kernel writes and layout clamps.

### Seek echoes are not pinned for 250 ms

A seek lands late and snapped to a frame. If the hook pins to that value while
the operator still scrolls, it pulls the view back and stalls a slow finger or
an edge autoscroll. For 250 ms after a scroll seek, a paused playhead change does
not move the view.

### The view does not move under a held pointer

A ruler scrub seeks. If the view moves under the finger, the next sample seeks
to a different time. While a pointer is down, the hook does not pin. On release
it pins only when the press moved the playhead (a ruler tap). It does not pin
after a clip tap: the click of a tap lands after the release, and a pin at that
time moves the clip away from the finger.

### The kernel viewport learns the lead

Without the lead, the kernel clamped its view start to `duration - span/2` in
raw scroll pixels. The padding adds half a view of real scroll range, so the
kernel stopped a clip drag's edge autoscroll half a view early. Its published
geometry was also off by the lead after any scroll.

`ViewportInput.leadPx` and `ResizeEvent.leadPx` carry the scroller's leading
padding. `scrollTo` and `scrollOffsetPx` subtract and add it. `clampViewport`
lets the start go down to `-leadPx`. `use-content-timeline.ts` reads the padding
from computed style and sends it on every render and from a `ResizeObserver`,
because the padding comes from a parent effect that runs after the child effect.

Rejected: tell the kernel a longer duration. That fixes the clamp but leaves the
published geometry wrong.

Rejected: allow a negative start for every surface. A studio scroller has no
lead, so the kernel would publish starts that the browser clamps to 0.

### Zoom anchors on the centre

On a centred scroller, `use-timeline-zoom.ts` uses the centre as the focal point
and half the width as the origin. Fit-to-width does not write `scrollLeft = 0`,
because that would seek to 0.

## Risks

- Code that scrolls the timeline without operator input (`scrollIntoView`) does
  not seek. The view and the playhead agree again at the next playback or seek.
