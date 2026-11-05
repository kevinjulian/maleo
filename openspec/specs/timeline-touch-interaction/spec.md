# timeline-touch-interaction Specification

## Purpose

TBD - created by archiving change add-timeline-touch-model. Update Purpose after archive.

## Requirements

### Requirement: Manipulation requires an explicit selection

On a coarse pointer, a clip SHALL be movable and trimmable only while selected. A press on an unselected clip SHALL pan the timeline, and a tap on an unselected clip SHALL select it without moving it. The same rule SHALL govern lane headers: a lane SHALL be reorderable only while selected, a press on an unselected lane header SHALL scroll the timeline, and a tap SHALL select it without moving it. Neither case SHALL require a press-and-hold.

With a mouse, pressing a clip is unambiguous: the pointer is already hovering it and scrolling is a different device. With a finger, press-and-move is simultaneously "move this clip" and "scroll the timeline", and no threshold separates the two because both begin identically. Gating manipulation behind selection removes the ambiguity instead of arbitrating it, and costs one tap that is undone by tapping elsewhere.

Lane headers had the same conflict and were never given the same answer — they use the HTML5 drag-and-drop API, which does not fire on touch at all, so lane reordering has been silently desktop-only. Extending selection-arms-manipulation to them fixes that with the rule already in use rather than a second one. A press-and-hold is excluded deliberately: it would reintroduce a timing threshold racing the gesture it shares a surface with, which is the arbitration this requirement exists to avoid, and it cannot be verified without hardware.

#### Scenario: An unselected clip is dragged

- **WHEN** a finger presses an unselected clip and moves horizontally
- **THEN** the timeline pans, and the clip's position is unchanged

#### Scenario: A clip is tapped

- **WHEN** a finger taps a clip without exceeding the drag threshold
- **THEN** the clip becomes selected and nothing is moved

#### Scenario: A selected clip is dragged

- **WHEN** a finger presses an already-selected clip and moves
- **THEN** the clip moves with the finger and the timeline does not pan

#### Scenario: The same clip is dragged with a mouse

- **WHEN** a pointer drags a clip on a fine-pointer device
- **THEN** the existing direct-manipulation behaviour applies, with no selection step

#### Scenario: An unselected lane header is dragged

- **WHEN** a finger presses an unselected lane header and moves
- **THEN** the timeline scrolls, and no lane is reordered

#### Scenario: A selected lane header is dragged

- **WHEN** a finger presses an already-selected lane header and moves
- **THEN** the lane is reordered, with its clips and its visibility, mute and lock flags moving with it

#### Scenario: A lane is reordered with a mouse

- **WHEN** a pointer drags a lane header on a fine-pointer device
- **THEN** the lane reorders directly, with no selection step

#### Scenario: A lane header is held without moving

- **WHEN** a finger rests on a lane header without moving
- **THEN** nothing happens beyond the selection a tap would produce

### Requirement: A tap is protected by a movement threshold

A drag SHALL NOT begin until the pointer has travelled beyond a movement threshold AND the press has lasted beyond a hold. Below either, the interaction SHALL resolve as a tap.

A finger never presses perfectly still. Without a threshold a two-pixel wobble registers as a drag and nudges a clip by a frame, so the operator sees an edit they did not make on a surface where undo is several taps away. The threshold exists to make taps reliable; treating it as drag detection tunes it the wrong way.

The hold is the second half: a press that crosses the distance inside the hold is a flick, which on a timeline means "throw the view" rather than "move this clip by a frame". Nothing is lost by waiting it out, because the drag's delta is measured from the original press point — the clip catches up to the finger the instant the gesture qualifies rather than starting from wherever it had reached.

The hold SHALL be measured on a monotonic clock, not the wall clock. Wall time moves with NTP corrections and daylight saving, and it is what test harnesses freeze — under a frozen clock every elapsed measurement is zero, the hold never expires, and a selected clip silently refuses to move.

#### Scenario: A tap wobbles

- **WHEN** a press moves a few pixels before release
- **THEN** it is treated as a tap and no clip moves

#### Scenario: A deliberate drag

- **WHEN** a press travels past the threshold
- **THEN** a drag begins from that point

### Requirement: Multi-select is unavailable on a coarse pointer

Multi-clip selection SHALL be disabled at coarse-pointer viewports.

Its gesture is press-and-move on empty timeline space, which is the pan gesture; the two are indistinguishable by a finger, and the operator gets a rubber-band selection when they meant to scroll. Rebinding is not available — a modifier needs a keyboard, and long-press is taken by the context menu. This is a real capability loss rather than a simplification: bulk selection is a precision operation that wants a pointer.

#### Scenario: A drag begins on empty timeline space

- **WHEN** a finger presses empty space in the lane area and moves
- **THEN** the timeline pans, and no selection rectangle appears

#### Scenario: The same gesture with a mouse

- **WHEN** a pointer drags across empty timeline space on a fine-pointer device
- **THEN** multi-select behaves as it does today

### Requirement: Each gesture has one surface

Scrubbing and panning SHALL be separated by surface rather than by heuristic: dragging the ruler SHALL move the playhead, and dragging the lane area SHALL pan the timeline. Pinching SHALL zoom the timeline.

Pointer capture for every timeline gesture SHALL be held by the timeline surface, not by the clip the gesture acts on. A clip SHALL be free to re-render, change lane, or unmount while a gesture concerning it is in flight, and the gesture SHALL continue and reach the terminal phase the pointer actually produced.

Both scrub and pan want a horizontal drag. Disambiguating by velocity or duration produces a control that behaves differently depending on how fast the operator moved, which is unlearnable. Separate surfaces are learnable in one try. Pinch is unambiguous — two fingers never means pan — and is worth taking because zoom is otherwise two taps deep in a sheet while being the main defence against a timeline showing only a few lanes.

Capture belongs to the surface for the same reason the surfaces are separate: so that ownership is decided by structure rather than by timing. When capture sat on the clip, writing a lane change during a drag re-parented that element, unmounted it, and cancelled the gesture — the clip snapped back and the drag appeared to do nothing. A virtualized timeline recycles clip elements constantly, so this is the normal case, not an edge case.

#### Scenario: The ruler is dragged

- **WHEN** a finger drags along the ruler
- **THEN** the playhead follows and the timeline does not pan

#### Scenario: The lane area is dragged

- **WHEN** a finger drags across the lanes, not on a selected clip
- **THEN** the timeline pans and the playhead does not move

#### Scenario: Two fingers pinch

- **WHEN** a pinch gesture occurs over the timeline
- **THEN** the timeline's zoom changes, and the page does not scale

#### Scenario: A dragged clip changes lane mid-gesture

- **WHEN** a clip is dragged across a lane boundary and the editor writes the lane change while the pointer is still down
- **THEN** the drag continues, subsequent pointer movement still applies, and the gesture ends on release rather than being cancelled

#### Scenario: A dragged clip is recycled by virtualization

- **WHEN** a drag carries a clip beyond the visible range so its element is released
- **THEN** the drag continues and commits at the position the pointer reached

### Requirement: A surface only suppresses the touch behaviour it replaces

A timeline surface SHALL declare `touch-action` no broader than the axes its own handlers implement.

The layout work set `pan-x` on the drag rails precisely because no handlers existed, so `none` would have produced a timeline that could not be moved at all. As handlers land the scope narrows: surfaces that own both axes take `none`, and containers whose scrolling still belongs to the browser keep `pan-x`. Both errors are silent — too much `none` and the timeline stops scrolling, too little and a gesture is stolen mid-drag.

#### Scenario: A surface handles both axes

- **WHEN** a surface implements its own drag in both directions
- **THEN** it declares `touch-action: none`

#### Scenario: A container still scrolls natively

- **WHEN** a container relies on the browser for panning
- **THEN** it declares the axis the browser still owns, rather than `none`

### Requirement: Selecting a clip turns the bottom bar into that clip's controls

When a clip is selected at a coarse-pointer viewport, the editor's bottom bar SHALL be replaced by a contextual bar carrying: a control that leaves the nearest open layer, one control per property group the selected clip actually has, and a disclosure holding the clip's actions. Deselecting SHALL restore the tool rail.

The leading control SHALL close the open sheet when there is one, and SHALL end the selection when there is not. Two things can be open and they nest, so one control cannot mean one thing: an always-deselect control threw the selection away when the operator only meant to put a sheet down, and two separate controls would leave a dead one on screen half the time.

Its controls SHALL carry no captions. The bar's one label is the subject of the selection, which has to be read rather than recognised; a caption under every glyph competes with it for the same glance.

The property groups SHALL be the same list that drives the desktop clip inspector's rail, so a clip kind gains or loses a group in one place rather than two.

This replaces a long-press context menu, and the reason is worth recording. Long press is a timing-sensitive gesture racing the drag threshold: the press that opens a menu is the press that begins a drag, and separating them is a tuning problem with no clean answer — one that emulated touch cannot verify, so it would only ever be settled on hardware. A visible bar has no timing, is discoverable without being taught, and makes selection state unmissable in a way a few pixels of highlight on a clip cannot.

It also keeps the transport reachable across the swap itself. The transport is a separate bar, so undo, redo, play and the timecode survive a clip being selected — which matters most immediately after an accidental edit.

They do NOT survive a sheet being opened, and that limit is stated rather than left to be discovered. A bottom sheet spans the whole timeline region including its toolbar, so while one is open none of the transport's controls can be reached, and the tools sheet — whose control lives there — cannot be opened from another sheet at all. Switching to it costs a dismiss and a reopen. If that has to change, the answer is to move the affected controls onto the bottom bar, which is the one surface that stays live, rather than to shrink the sheet.

#### Scenario: A clip is selected

- **WHEN** a clip becomes selected at a coarse-pointer viewport
- **THEN** the bottom bar shows a deselect control, one control per property group that clip has, and an actions disclosure

#### Scenario: A clip kind has fewer groups

- **WHEN** the selected clip's kind defines fewer property groups than another kind
- **THEN** only that kind's groups appear, from the same source the desktop inspector rail reads

#### Scenario: A property group is opened

- **WHEN** a property group control is used
- **THEN** that clip's properties open at that group

#### Scenario: The clip is deselected

- **WHEN** the leading control is used with no sheet open
- **THEN** the selection clears and the tool rail returns

#### Scenario: A sheet is put down

- **WHEN** the leading control is used with a sheet open
- **THEN** the sheet closes and the clip stays selected

#### Scenario: The selection is lost from elsewhere

- **WHEN** a selection ends while one of its sheets is open
- **THEN** that sheet closes with it, rather than inspecting a clip that is no longer there

#### Scenario: Clip actions are opened

- **WHEN** the actions disclosure is used
- **THEN** the clip's actions are available, including at minimum split at playhead, duplicate and delete

#### Scenario: The transport during selection

- **WHEN** a clip is selected and no sheet is open
- **THEN** undo, redo, play/pause and the timecode remain reachable without deselecting

#### Scenario: The transport under an open sheet

- **WHEN** a bottom sheet is open
- **THEN** the transport is covered, and the way back to it is the bar's own control

### Requirement: A clip is always large enough to hit

A clip SHALL present a touch target no smaller than the platform minimum, regardless of its rendered duration, and SHALL NOT become unreachable at low zoom.

A clip's interactive area, its drawn area, and the duration it represents SHALL be three separately computed boxes. Expanding the interactive area SHALL NOT change the duration the clip represents, and SHALL grow inward from the clip's own edges so that it never takes a press belonging to an adjacent clip.

At a wide zoom a short clip renders a few pixels across and cannot be tapped at all. Padding the target breaks the timeline's honesty — the clip no longer represents its duration — which is a real cost, and the reason the discrepancy should be visible rather than silently applied. Separating the three boxes is what makes the discrepancy statable: the drawn box can report that it exceeds the duration box, instead of the duration quietly becoming a function of finger size.

#### Scenario: A very short clip at low zoom

- **WHEN** a clip renders narrower than the minimum touch target
- **THEN** it remains selectable by touch

#### Scenario: The padding is applied

- **WHEN** a clip's touch target exceeds its rendered width
- **THEN** the difference is apparent to the operator rather than silently widening the clip

#### Scenario: Two adjacent clips both expand

- **WHEN** two clips share an edge and both expand their interactive areas to the minimum
- **THEN** neither takes a press on the other, and each keeps a region that reaches only itself

### Requirement: A clip drag owns the viewport for its duration

While a clip is being dragged, the timeline SHALL NOT pan under it, and a drag reaching the edge of the visible timeline SHALL scroll toward that edge.

Without the lock, the surface moves while the clip moves and the operator is aiming at a moving target. Without the auto-scroll, a clip cannot be moved further than one viewport width, which on a phone is a few seconds of timeline.

#### Scenario: A drag reaches the edge

- **WHEN** a clip is dragged to the edge of the visible timeline
- **THEN** the timeline scrolls in that direction and the drag continues

#### Scenario: A drag is in progress

- **WHEN** a clip is being dragged
- **THEN** the timeline does not pan from any other source

### Requirement: Trim is coarse by gesture and exact by control

A selected clip SHALL offer trim handles no smaller than the platform minimum, inset within the clip and present only while it is selected; a clip too narrow to hold body-plus-handles SHALL show none. Clip properties SHALL additionally offer In and Out controls that step by exactly one frame.

Where a handle is not offered, no element for it SHALL exist. A handle SHALL NOT be withheld by styling alone.

At normal zoom a frame is well under a pixel wide, so trimming by dragging an edge cannot resolve one — with a finger OR a mouse. The handles place a clip; the steppers land it. This is the one place where the touch affordance beats the desktop one rather than approximating it, because a stepper is more precise than any drag.

Suppressing the handles on a narrow clip is not a degradation. Two touch-sized handles would meet in the middle and leave no body to grab, and there is no trim precision at that zoom to lose — the clip is moved by its body and zoomed into before it is trimmed.

Suppressing them with `display: none` is a defect, because a hidden handle keeps its hit area and takes the press meant for the clip body. Withholding the handle means not producing it.

#### Scenario: A clip wide enough to trim

- **WHEN** a clip is selected and is wider than body-plus-handles
- **THEN** it shows trim handles at no less than the platform minimum, inset within its own bounds

#### Scenario: A clip too narrow to trim

- **WHEN** a selected clip cannot hold body-plus-handles
- **THEN** no handle element exists for it, a press at either edge reaches the clip body, and it remains movable by its body

#### Scenario: An unselected clip under a finger

- **WHEN** a clip that is not selected is pressed with a coarse pointer
- **THEN** no handle element exists for it, and the press selects the clip or falls through to the pan the browser owns

#### Scenario: A frame-accurate adjustment

- **WHEN** the In or Out stepper is used
- **THEN** the clip's edge moves by exactly one frame at the composition's rate, computed in exact rational time rather than in float seconds

### Requirement: VUI timeline touch rules apply through adapters

VUI timeline primitives SHALL expose touch and pointer behavior that can be shared by content clips, template timing ranges, and custom element layers/keyframes. Consuming adapters SHALL decide whether a neutral range is movable, resizable, selectable, or read-only.

On coarse pointers, VUI-backed timelines SHALL preserve the same gesture separation as the content editor: panning, scrubbing, selecting, moving, and resizing must be reachable without relying on HTML5 drag-and-drop or press-and-hold timing.

#### Scenario: A template timing range is dragged on touch

- **WHEN** a finger interacts with a template timing range
- **THEN** VUI applies the shared touch rules and the template adapter decides whether to update the corresponding template field

#### Scenario: A motion keyframe is dragged on touch

- **WHEN** a finger interacts with a motion keyframe or sublane
- **THEN** VUI applies shared hit-target and gesture rules while the motion adapter translates the result into keyframe timing

#### Scenario: A range is read-only

- **WHEN** an adapter marks a VUI range as read-only
- **THEN** VUI allows selection and inspection but does not emit move or resize mutations for that range

### Requirement: Nested VUI editors own their keyboard scope

A VUI-backed modal or nested editor SHALL own keyboard events while open so parent editor shortcuts such as undo, delete, split, and playback do not mutate the parent timeline.

#### Scenario: Motion Studio is open above the content editor

- **WHEN** the operator presses delete, undo, split, or play/pause while Motion Studio has focus
- **THEN** the command is handled by Motion Studio or ignored, and the parent content timeline is unchanged

#### Scenario: A nested editor closes

- **WHEN** the nested VUI editor closes
- **THEN** parent editor keyboard shortcuts resume according to the parent editor's existing rules

### Requirement: VUI pointer gestures have explicit lifecycle and cleanup

Every VUI timeline gesture SHALL define owning surface, allowed pointer types, begin threshold, transient update, commit, cancel, pointer capture, and cleanup behavior. Global listeners SHALL be removed after commit, cancel, lost capture, or unmount. Consumer mutation SHALL occur only through documented callbacks.

#### Scenario: Pointer completes drag

- **WHEN** captured pointer crosses threshold, updates, and releases
- **THEN** gesture produces one commit and releases capture and listeners

#### Scenario: Browser cancels pointer

- **WHEN** `pointercancel` or lost capture occurs
- **THEN** gesture cancels, transient projection clears, and no commit occurs

#### Scenario: Workspace unmounts mid-gesture

- **WHEN** editor closes while pointer gesture is active
- **THEN** all listeners, capture state, timers, animation frames, and auto-scroll stop

#### Scenario: Adapter rejects proposed mutation

- **WHEN** domain adapter clamps or rejects transient edit
- **THEN** VUI renders returned accepted projection or restores prior state without persisting hidden intermediate state

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

### Requirement: Nested tracks remain operable by touch and keyboard

Nested range, property, curve, marker, and keyframe renderers SHALL participate in shared selection, focus, hit-target, scroll, zoom, and gesture lifecycle. Interactive marks SHALL meet platform minimum touch target without falsifying visible timing geometry, and SHALL support documented keyboard movement or value adjustment.

#### Scenario: Short keyframe marker is selected

- **WHEN** operator taps marker whose visual glyph is smaller than touch minimum
- **THEN** invisible hit target selects marker without widening its displayed timing position

#### Scenario: Keyframe is dragged

- **WHEN** selected keyframe moves across nested track
- **THEN** VUI emits normalized time through gesture lifecycle and Motion adapter maps it to composition-relative keyframe value

#### Scenario: Keyframe receives keyboard command

- **WHEN** focused keyframe receives left or right adjustment
- **THEN** it moves by documented step, remains within adapter limits, and announces committed position

### Requirement: Touch interaction verification uses real pointer sequences

Verification SHALL exercise mouse, coarse single-pointer, cancellation, lost capture, multi-pointer pinch, edge auto-scroll, and keyboard alternatives against shared VUI timeline plus Maleo adapters. Direct function tests alone SHALL NOT prove browser gesture behavior.

#### Scenario: Cancellation coverage runs

- **WHEN** browser test begins a drag then dispatches cancellation
- **THEN** range returns to uncommitted state and later pointer interactions still work

#### Scenario: Edge auto-scroll coverage runs

- **WHEN** selected range is dragged to timeline viewport edge
- **THEN** viewport scrolls while gesture remains owned and final commit reflects scrolled position

#### Scenario: Pointer modes differ

- **WHEN** same timeline fixture runs under mouse and coarse-pointer projects
- **THEN** tests assert intended direct-manipulation and selection-first differences

### Requirement: The editor declares its engagement policy rather than inheriting one

The editor SHALL declare the rule that decides when a press has become a drag, and SHALL declare it once. It SHALL NOT run one threshold of its own in front of a different threshold inside the timeline library.

Engagement on a coarse pointer requires both a movement threshold and a hold: a press that crosses the threshold within the hold is a flick, which on a timeline means throw the view, not move this clip by a frame. When the library could express only "threshold or hold", the editor ran a second dead zone of its own and two gates decided one question — a state in which neither can be reasoned about alone.

#### Scenario: A press wobbles

- **WHEN** a finger presses a selected clip and moves less than the declared threshold
- **THEN** the clip does not move, and the press is treated as a tap

#### Scenario: A flick crosses the threshold quickly

- **WHEN** a finger crosses the movement threshold before the declared hold has elapsed
- **THEN** the clip does not move, and the gesture is available to the surface that owns the view

#### Scenario: The policy is located

- **WHEN** the engagement rule is searched for in the editor
- **THEN** it is found in exactly one place, and the timeline library applies that rule rather than a second one

### Requirement: Studio inspection and actions come from the bottom, not the toolbar

At a coarse-pointer viewport, Template Studio and Motion Studio SHALL expose inspector categories, actions, and their cancel/close and save/create controls from a persistent bottom action surface and from bottom sheets. They SHALL NOT expose them from a text button embedded in the timeline toolbar, nor from a desktop-shaped modal button row.

This is stated separately from the clip-selection bottom bar because it is a different subject. Selecting a clip swaps the tool rail for that clip's controls; a studio has no clip selection to swap on, and its bar is resident. The two requirements share a shape and a reason — the bar is the one surface that survives a sheet — but folding the studios into the clip requirement would make its title untrue.

The reason for moving off the timeline toolbar is not consistency alone. A text button there consumes toolbar width that the timeline needs, it differs from the surface operators learn first, and it does not scale: a second studio panel has nowhere to go.

The bar SHALL carry one control per inspector category, and using one SHALL open the sheet at that category. A single control that opens a sheet whose own rail then selects the category is two actions where the main editor takes one, and it puts a column of destinations inside a surface that already has a row of them. The categories SHALL come from the same list the resident rail reads, so a category gained or lost moves in one place. While the sheet is open, the rail inside it SHALL be hidden, because at that width the bar is the rail and two rows of the same glyphs read as two different controls.

Studio bottom controls SHALL use icon controls with accessible names wherever an icon exists, following the main editor's rule that the bar's controls carry no captions. The commit control is the stated exception: it SHALL remain visible and captioned, because it is not a navigation control and an unlabelled commit on a form is a guess.

The bar's leading control and its commit control SHALL remain reachable however far the categories are scrolled. A bar that scrolls as one strip can carry either off screen, and a commit control that has scrolled away is not visible in any sense that matters.

While no sheet is open, the transport and the timeline SHALL remain reachable, and the preview SHALL remain visible.

#### Scenario: Studio inspector opens from the bottom

- **WHEN** Template Studio or Motion Studio is open at a coarse-pointer viewport
- **THEN** inspector categories open from the bottom action surface into a bottom sheet, with no timeline-toolbar text button required to reach them

#### Scenario: A category is chosen from the bar

- **WHEN** a category control on the bar is used
- **THEN** the sheet opens with that category active, in one action rather than two

#### Scenario: The sheet does not repeat the bar

- **WHEN** a studio inspector sheet is open at a coarse-pointer viewport
- **THEN** it shows the chosen category's body and not a second column of category controls

#### Scenario: The categories are scrolled

- **WHEN** the category controls are scrolled to either end
- **THEN** the leading control and the commit control are still on screen

#### Scenario: Studio CTA is reachable

- **WHEN** Template Studio or Motion Studio is open at a coarse-pointer viewport and no sheet is open
- **THEN** cancel/close and save/create are reachable from the compact header or the bottom action surface, and neither covers the preview

#### Scenario: A studio sheet is closed

- **WHEN** a studio inspector or action sheet closes
- **THEN** the preview, transport, and timeline are visible and interactive again without the editor remounting

#### Scenario: A studio bottom control has no icon

- **WHEN** a studio bottom control has no icon that carries its meaning
- **THEN** it may carry text, and every control on the bar carries an accessible name either way

#### Scenario: The bar's leading control is used under a sheet

- **WHEN** the leading control is used with a studio inspector sheet open
- **THEN** the sheet closes and the studio stays open, proven by the resulting state rather than by the control's label

### Requirement: The phone editor timeline holds the playhead at the centre

At phone width the editor timeline and the Motion Studio timeline SHALL keep the playhead at the horizontal centre of its scroller and SHALL move the lanes under it. The scroller SHALL have leading and trailing padding equal to half its own width, measured from the scroller and not from its containing block, so that time zero and the project end can reach the centre.

During playback the lanes SHALL scroll so that the playhead stays at the centre. A scroll of the lanes by the operator SHALL seek to the time at the centre. Operator input is a pointer held on the scroller, a touch, a wheel, and the momentum and edge autoscroll that follow them. A scroll that no operator input caused, such as a clamp by the browser or a kernel viewport sync, SHALL NOT seek. A press on the timeline during playback SHALL pause playback.

While a pointer is held on the scroller the lanes SHALL NOT move to follow the playhead. On release, if the press moved the playhead without a scroll, the lanes SHALL move to put the playhead at the centre. A press that did not move the playhead SHALL NOT move the lanes, so that the click of a tap lands on the element that the finger aimed at.

Zoom SHALL keep the playhead time at the centre.

The visible playhead line SHALL be drawn outside the scrolled content, at the scroller centre, so that a scroll never moves it. The playhead in the scrolled content SHALL stay as the keyboard slider, hidden and without pointer input. While paused, the lanes SHALL NOT move for a playhead change of less than half a frame, because that change is the seek of a scroll that comes back snapped to a frame.

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

#### Scenario: The operator drags the lanes

- **WHEN** the operator drags the paused phone timeline and lifts the finger
- **THEN** the playhead line does not move during the drag, and the lanes do not move after the release except for momentum

#### Scenario: Motion Studio on a phone

- **WHEN** the operator opens Motion Studio at phone width and scrolls its lanes
- **THEN** the playhead line is at the scroller centre and the time at the centre becomes the playhead time

#### Scenario: The operator taps a clip

- **WHEN** the operator taps a clip and the tap does not move the playhead
- **THEN** the lanes do not move, and the tap selects the clip
