## ADDED Requirements

### Requirement: The phone editor timeline holds the playhead at the centre

At phone width the editor timeline SHALL keep the playhead at the horizontal centre of its scroller and SHALL move the lanes under it. The scroller SHALL have leading and trailing padding equal to half its own width, measured from the scroller and not from its containing block, so that time zero and the project end can reach the centre.

During playback the lanes SHALL scroll so that the playhead stays at the centre. A scroll of the lanes by the operator SHALL seek to the time at the centre. Operator input is a pointer held on the scroller, a touch, a wheel, and the momentum and edge autoscroll that follow them. A scroll that no operator input caused, such as a clamp by the browser or a kernel viewport sync, SHALL NOT seek. A press on the timeline during playback SHALL pause playback.

While a pointer is held on the scroller the lanes SHALL NOT move to follow the playhead. On release, if the press moved the playhead without a scroll, the lanes SHALL move to put the playhead at the centre. A press that did not move the playhead SHALL NOT move the lanes, so that the click of a tap lands on the element that the finger aimed at.

Zoom SHALL keep the playhead time at the centre.

#### Scenario: Playback on a phone

- **WHEN** the operator plays a project that is longer than the phone timeline view
- **THEN** the lanes scroll and the playhead stays within 4 px of the scroller centre

#### Scenario: The operator scrolls the lanes

- **WHEN** the operator scrolls the paused phone timeline to its start
- **THEN** the playhead is at time zero and at the scroller centre

#### Scenario: The browser clamps a scroll offset

- **WHEN** the browser changes the scroll offset with no operator input
- **THEN** the playhead does not move

#### Scenario: The operator taps the ruler

- **WHEN** the operator taps the ruler at a time away from the centre and lifts the finger
- **THEN** the playhead moves to that time, and after the release the lanes move to put it at the centre

#### Scenario: The operator taps a clip

- **WHEN** the operator taps a clip and the tap does not move the playhead
- **THEN** the lanes do not move, and the tap selects the clip

## MODIFIED Requirements

### Requirement: Timeline arbitrates native scrolling, manipulation, and zoom

VUI timeline SHALL declare touch behavior per surface and gesture actually implemented. Ruler drag SHALL scrub, lane-background drag SHALL pan (on the phone editor timeline the pan also seeks, see "The phone editor timeline holds the playhead at the centre"), selected editable item drag SHALL manipulate after selection and threshold rules, vertical browser scrolling SHALL remain available where workspace layout permits it, and two-pointer pinch SHALL zoom without scaling page.

#### Scenario: Finger pans lane background

- **WHEN** one finger drags lane background outside selected editable target
- **THEN** timeline viewport pans and items do not move, and the playhead does not move except on the phone editor timeline, where the time at the centre line becomes the playhead

#### Scenario: Finger scrubs ruler

- **WHEN** one finger drags ruler
- **THEN** playhead changes and viewport does not pan

#### Scenario: Pinch zooms timeline

- **WHEN** two pointers change distance over timeline
- **THEN** timeline zoom changes around stable focal time and browser page does not zoom; on the phone editor timeline the focal time is the playhead at the centre

#### Scenario: Unsupported axis is suppressed

- **WHEN** a surface declares `touch-action` that disables browser behavior with no matching handler
- **THEN** touch contract test fails
