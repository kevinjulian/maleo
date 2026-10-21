# web-mobile-editor-layout Specification

## Purpose

TBD - created by archiving change add-mobile-editor-layout. Update Purpose after archive.

## Requirements

### Requirement: The stage and the timeline are co-resident at every viewport

The editor SHALL render the stage and the timeline simultaneously at every supported viewport width, without requiring the operator to switch a mode or scroll the page to move between them. When the viewport cannot hold the editor's panes side by side, the stage and the timeline SHALL stack vertically, stage above.

These two panes are one instrument. A timeline scrub whose result is not visible is not an edit — the operator is guessing and then checking. Any composition that separates them, including a segmented mode switcher, converts every adjustment into a round trip.

#### Scenario: The editor is opened on a portrait phone

- **WHEN** an operator opens the content editor at a portrait phone width
- **THEN** the stage and the timeline are both visible at once, with the stage above the timeline

#### Scenario: A clip is scrubbed on a phone

- **WHEN** the operator moves the playhead
- **THEN** the stage updates in place, with no navigation, mode change or page scroll required to observe it

#### Scenario: The editor is opened on a desktop viewport

- **WHEN** the viewport is wide enough for the side-by-side composition
- **THEN** media, preview, and inspector remain clear upper panes with a full-width timeline below, and both preview and timeline remain visible

### Requirement: Contextual panels remain sheets while chat becomes a workspace

When the viewport cannot hold the editor's panes side by side, the rail's contextual panel SHALL render as an overlay sheet opened from a persistent trigger and SHALL NOT occupy resident width. Project chat SHALL render as the Chat view of the content workspace rather than as a partial-height sheet.

The Editor view SHALL preserve the existing stage-plus-timeline composition. Changing between Editor and Chat SHALL NOT recreate the editor document, reset selection or playhead, lose a composer draft, or detach an active run.

#### Scenario: Chat opens on a phone

- **WHEN** the operator activates Chat at phone width
- **THEN** the workspace displays the full Chat view
- **AND** the Editor view retains its stage, timeline, selection, and playhead state

#### Scenario: Operator returns to Editor

- **WHEN** the operator activates Editor from Chat
- **THEN** the stage and timeline are both visible in their prior positions
- **AND** no route navigation or project reload occurs

#### Scenario: Contextual panel opens on a phone

- **WHEN** the operator opens a rail panel from Editor
- **THEN** the panel appears as an overlay sheet with a scrim
- **AND** it closes by scrim, explicit control, or the established keyboard dismissal

#### Scenario: Reduced motion is requested

- **WHEN** the operating system reports a reduced-motion preference
- **THEN** workspace-view and sheet changes occur without nonessential transition

#### Scenario: Desktop viewport is wide enough

- **WHEN** the viewport can hold the desktop composition
- **THEN** chat and the contextual panel render as resident panes rather than phone workspace views or sheets

### Requirement: Pane height is measured against the visible viewport

Pane heights SHALL be expressed against the dynamic viewport, so a retracted browser URL bar does not make a pane taller than the area the operator can see. Heights that already clamp to a fixed maximum SHALL be reviewed individually rather than converted by substitution.

`100vh` on a mobile browser is the viewport with the URL bar retracted. Every pane sized `calc(100vh - var(--cv-top))` therefore extends below the fold, and the bottom of the timeline — where the trigger bar and the last lanes sit — is the part that disappears. Modal sizes of the form `min(860px, calc(100vh - 40px))` do not have this problem, because the clamp already absorbs the overshoot, and converting them introduces a modal that resizes while the URL bar animates.

#### Scenario: The editor is opened in a mobile browser with a visible URL bar

- **WHEN** the editor renders before the URL bar has retracted
- **THEN** the timeline's lowest row and the sheet triggers are within the visible area

#### Scenario: The URL bar retracts during a scroll

- **WHEN** the browser chrome collapses
- **THEN** the editor's panes grow into the reclaimed space rather than the layout staying short

#### Scenario: A modal is open while the viewport changes

- **WHEN** a clamped modal is open and the visible viewport height changes
- **THEN** the modal does not resize under the operator

### Requirement: The timeline can be scrolled by finger

Timeline drag surfaces SHALL permit native horizontal panning on touch devices. They SHALL NOT declare `touch-action: none` while no touch gesture handler is present to replace the behavior it suppresses.

`touch-action: none` is currently set on the motion track and the studio rails so that desktop pointer-drag is not stolen by browser scrolling. On a touch device it means the browser does nothing, and until drag handlers exist that produces a timeline that renders correctly and cannot be moved at all. Reserving only the axes a future handler needs keeps the surface usable in the interim.

#### Scenario: An operator drags horizontally across the timeline

- **WHEN** a finger drags along the timeline's rails
- **THEN** the timeline pans horizontally

#### Scenario: A drag surface suppresses touch behavior

- **WHEN** a timeline surface declares that the browser must not handle a touch axis
- **THEN** a handler for that axis exists in the same component, or the declaration is narrowed to the axes that are handled

#### Scenario: Desktop pointer drag is unaffected

- **WHEN** a mouse drags on the same surfaces
- **THEN** the existing pointer-drag behavior works exactly as it does today

### Requirement: Touch density is selected by pointer type

The editor SHALL select its lane and ruler metrics from the pointer type, not from the viewport width. Lane height SHALL additionally vary by lane group, so a lane is as tall as its contents need and no taller. Gutter visibility SHALL be selected the same way: hidden by default on a coarse pointer, visible by default on a fine one, and persisted once the operator sets it.

`tracks.css` already defines both a default lane metric and a compact one. The compact metric is what makes the portrait height budget hold roughly nine lanes instead of six, which is the difference between a multi-track edit and a peephole. Width is the wrong selector for it: a touch laptop at desktop width needs the touch density, and a desktop browser narrowed to phone width does not.

A single compact metric is not enough on its own, because it applies the same height to a lane holding a thumbnail strip and a lane holding a waveform. Per-group heights recover most of the remaining budget without shrinking the lanes that actually use the pixels. The gutter follows the same pointer-type rule for the same reason: at a fixed 176px it takes 45% of a phone's width for labels that per-group heights have already made redundant.

#### Scenario: The editor renders on a coarse pointer

- **WHEN** the device reports a coarse pointer
- **THEN** the timeline uses the compact lane and ruler metrics, and the gutter is hidden by default

#### Scenario: The editor renders on a fine pointer at a narrow width

- **WHEN** a desktop browser window is narrowed to phone width
- **THEN** the lane and ruler metrics are unchanged from their desktop values, and the gutter remains visible

#### Scenario: Lanes of different groups render together

- **WHEN** the timeline holds lanes of more than one group
- **THEN** each lane is drawn at its group's height, and each gutter row matches the lane beside it

#### Scenario: The gutter is toggled

- **WHEN** the operator changes gutter visibility from the timeline's tools sheet
- **THEN** the setting persists across sessions for that pointer type

### Requirement: Phone-width behavior is covered by a test that drives the app

The change SHALL add viewport coverage at phone width that exercises the editor: that the stage and timeline are both present, that each sheet opens and closes, and that no pane extends past the visible viewport.

That coverage SHALL additionally assert, for every surface required to draw, both that its box is non-zero and that it is the element receiving input at its own centre. Neither half is sufficient alone: a correct box says nothing about whether anything painted, and being topmost says nothing about being sized.

Four of the five defects in this capability's implementation shared one shape — an element with a correct-looking box and nothing drawn inside it. A sheet reported full width and height while rendering as an empty strip; the stage was visible and correctly sized while holding only a hidden inspector; the preview canvas measured 0x0 inside a 393x250 parent; the navigation drawer opened beneath the editor with a winning z-index it could not escape its stacking context to use. Every one passed an assertion aimed at its container, and three were found by looking at a screenshot after the suite was green.

The existing visual suite runs at desktop widths, so every rule in this capability is invisible to it by construction. Reachability is not something a static render test can see.

#### Scenario: The suite runs

- **WHEN** the web test suite runs
- **THEN** it includes at least one phone-width run of the editor asserting the stage and timeline are both rendered

#### Scenario: A surface reports a healthy box but draws nothing

- **WHEN** an element required to draw has a non-zero bounding box while its contents have collapsed
- **THEN** the coverage fails and names the surface, rather than passing on the container's dimensions

#### Scenario: A surface is painted over

- **WHEN** an element required to draw is covered by another, whatever its declared z-index
- **THEN** the coverage fails, because the hit test at its own centre does not resolve to it or a descendant

#### Scenario: A sheet regresses

- **WHEN** a change makes a sheet trigger unreachable or leaves a sheet unable to close
- **THEN** the phone-width coverage fails and names the surface

#### Scenario: A pane overflows the viewport

- **WHEN** a pane extends below the visible viewport at phone width
- **THEN** the coverage fails rather than the overflow shipping unobserved

### Requirement: The transport bar keeps only constant-use controls at phone width

When the viewport cannot hold the editor's panes side by side, the timeline's transport bar SHALL render on one row, carrying only the controls reached constantly during an edit, and SHALL move the remainder behind a single disclosure that opens a sheet. A control that is inert at that viewport SHALL be omitted rather than relocated.

This SHALL hold on every VUI editor surface — the content editor, Template Studio and Motion Studio — and the three SHALL draw one transport. The play control and the timecode readout SHALL come from a single component owned by the application, so the same glyph and the same readout appear on all three; a package default rendered on one surface beside the application's own on another is the drift this forbids.

Where a surface can add content to its own timeline, that surface's toolbar SHALL carry one control that opens a sheet listing the kinds it can add, rather than one control per kind. Three add-layer buttons on a 393px strip is the crowding this exists to prevent, and a control per kind does not survive a fourth kind.

A transport SHALL report the state of the renderer it drives, at every viewport width. Its play control SHALL reflect whether the renderer is playing, and its timecode SHALL advance while the renderer advances. Both studios failed this: driven at 1440x900 the content editor's timecode ran from `00:00:00` to `00:01:43` while both studios stayed at `0:00` and their play controls never changed state — not because playback had not started, but because nothing was subscribed to the renderer that had. A transport that issues a command and then reports the state it had before is indistinguishable from a dead control.

The bar carries nineteen controls behind a three-column grid whose minimums total roughly 912px. On a 393px phone it ran more than twice the viewport and cut off mid-timecode, with the aspect, insight and zoom controls off-screen and nothing to scroll. Wrapping it instead kept everything reachable but spent about 110px of a 659px viewport — seventeen percent of the screen on chrome, against a timeline measuring 126-190px. Height here is not cosmetic: it is lane count, which is the scarcest thing on the screen.

#### Scenario: The editor is opened on a phone

- **WHEN** the transport bar renders below the breakpoint
- **THEN** it occupies a single row, showing undo, redo and play/pause as controls plus the timecode readout

#### Scenario: A displaced control is needed

- **WHEN** the operator opens the bar's disclosure
- **THEN** the controls that left the bar — playback speed, jump to start and end, trim/split, hook takes, aspect ratio, organize, pacing insights, beat grid and zoom — are present in the sheet and operable

#### Scenario: A control has no effect at this viewport

- **WHEN** a control's behaviour is already forced by the pointer type, as the timeline density toggle is by the compact metrics
- **THEN** it is absent from both the bar and the sheet, rather than offered as a control that does nothing

#### Scenario: The same bar renders on a desktop viewport

- **WHEN** the viewport is wide enough for the side-by-side composition
- **THEN** the bar renders its full three-column layout with every control in place

#### Scenario: A studio's toolbar renders on a phone

- **WHEN** Motion Studio's toolbar renders below the breakpoint
- **THEN** it carries the add control, play/pause and the timecode readout, and its remaining controls are behind the disclosure

#### Scenario: A studio has nothing to add to its timeline

- **WHEN** Template Studio's toolbar renders below the breakpoint
- **THEN** it carries play/pause, the timecode readout and the disclosure, and no add control

#### Scenario: A studio's displaced control is needed

- **WHEN** the operator opens a studio toolbar's disclosure
- **THEN** the controls that left that toolbar, including returning the playhead to the start, are present and operable

#### Scenario: Content is added to a studio's timeline

- **WHEN** the operator activates the add control at phone width
- **THEN** a sheet lists the kinds that surface can add, and choosing one adds it and dismisses the sheet

#### Scenario: Two surfaces' transports are compared

- **WHEN** the content editor's and a studio's transports are rendered at the same width
- **THEN** their play control and timecode readout are the same component, so their accessible names and their appearance agree

#### Scenario: Playback is started on any editor surface

- **WHEN** the operator activates the play control on the content editor, Template Studio or Motion Studio, at any viewport width
- **THEN** the timecode advances and the play control reports the playing state

#### Scenario: The renderer attaches after the surface first renders

- **WHEN** the renderer's imperative handle becomes available on a later commit than the one that mounted the transport
- **THEN** the transport observes that renderer from the moment it exists, rather than remaining bound to its absence

### Requirement: Navigation outranks every editor surface

The navigation drawer and its scrim SHALL stack above all editor chrome and above any open sheet, at every viewport width.

Below the breakpoint the drawer is the only route from the editor back to the rest of the app — there is no sidebar at that width. Its stacking was declared inside a desktop-only media query, so on a phone it fell back to a value beneath the editor's topbar and beneath a sheet: it opened, and could not be seen. A surface that cannot bury the navigation reaching it is the invariant; a sheet covering the trigger while that sheet is open is not a violation of it, because the sheet is modal and dismissible.

#### Scenario: The drawer is opened from the editor on a phone

- **WHEN** the operator opens the navigation drawer
- **THEN** it renders above the editor topbar and above any sheet, and is the element receiving input at its own coordinates

#### Scenario: A sheet is open

- **WHEN** a sheet is open and its scrim covers the drawer's trigger
- **THEN** dismissing the sheet restores access to the trigger

### Requirement: A bottom sheet occupies the timeline region, not the screen

At phone width every bottom sheet SHALL span the timeline region — its toolbar and its lanes — and SHALL stop at the bottom bar. All bottom sheets SHALL take the same geometry, and the bottom bar SHALL remain visible AND hittable underneath any of them.

The bar is the only navigation these surfaces have: it reaches another tool, another property group, or out of the selection entirely. A sheet that covered it turned each of those into three taps — dismiss, find the bar, choose — which is what shipped and what was reported. Both halves of "stays live" are load-bearing, and they fail differently: a sheet that stops above the bar while its scrim stays flush leaves the bar visible and dead, which reads as a broken control rather than a covered one.

Uniform geometry is a separate claim from uniform behaviour. The bar does not move between sheets, so a sheet that sized itself to its own content made the surface behind the bar change shape for no reason the operator could see.

The region is measured, not calculated. `svh` is the viewport with the browser chrome at its largest, so on a phone whose address bar has collapsed a `calc()` against it overstates the screen by exactly the height that bar used to take, and the sheet misses the gap it was sized to fill.

#### Scenario: A sheet is opened

- **WHEN** any bottom sheet opens at phone width
- **THEN** its top edge meets the top of the timeline's toolbar and its bottom edge meets the top of the bottom bar

#### Scenario: The bar beneath an open sheet

- **WHEN** a bottom sheet is open
- **THEN** the bottom bar is the topmost element at its own centre, and its controls act

#### Scenario: Two sheets from the same bar

- **WHEN** one bottom sheet replaces another
- **THEN** both occupy the same region, so nothing behind them moves

#### Scenario: A second sheet is asked for

- **WHEN** a sheet is open and another is opened
- **THEN** the first closes, and exactly one sheet is open

### Requirement: The bottom bar is one structure

The tool rail and the contextual clip bar SHALL share one declaration of spacing, control size, and overflow behaviour. Controls SHALL NOT shrink below the platform minimum; a bar too full for its width SHALL scroll.

Every VUI editor surface's bottom bar SHALL take these two states, and SHALL be in the state its selection dictates. With nothing selected the bar SHALL offer the surface's destinations and no subject; with something selected it SHALL offer a leading control that leaves the nearest layer, the subject's title, and one control per inspector section that applies to that subject. A surface that commits — a studio — SHALL keep its commit pinned in both states.

The studios previously listed every destination at once, in both states, so a motion with nine layers was a nine-glyph strip that had to be searched before it could be used, and selecting a layer changed nothing about the bar. The rail-until-selected model is not a preference: it is what makes the bar's contents a function of what the operator is looking at, which is the only thing that keeps a bar short as a document grows.

A surface whose header already carries a close control SHALL NOT repeat one in the bar's unselected state, because the bar's leading control means "leave the nearest layer" and there is no layer to leave.

They occupy the same slot, one at a time, so any difference between them is something the operator sees as the bar jumping when a clip is tapped. Written separately they had already diverged — a 4px gap against 8px, 40px controls against 44px — which is the state that produces a jump, and it arrived without anyone deciding on it.

#### Scenario: A bar is measured against the other

- **WHEN** the tool rail and the contextual bar are compared
- **THEN** their control size, spacing and height agree

#### Scenario: A bar holds more than fits

- **WHEN** a bar's contents exceed the viewport width
- **THEN** the bar scrolls horizontally and no control is compressed below the platform minimum

#### Scenario: A studio is opened with nothing selected

- **WHEN** a studio renders its bottom bar at phone width and nothing is selected
- **THEN** the bar offers the surface's identity destination and its commit, and carries no subject title and no leading close control

#### Scenario: A layer is selected in a studio

- **WHEN** the operator selects a layer or a range in a studio at phone width
- **THEN** the bar becomes that subject's bar — a leading control, the subject's title, one control per inspector section that applies to it — and the commit stays pinned

#### Scenario: The selection is cleared

- **WHEN** the operator leaves the selection
- **THEN** the bar returns to its unselected state, by the same route the content editor's clip bar returns to the tool rail

#### Scenario: A section control is activated

- **WHEN** the operator activates one of the subject's section controls
- **THEN** the inspector opens at that section, in one action rather than two

### Requirement: VUI-backed editors keep preview and timeline co-resident on mobile

Every VUI-backed editor workspace SHALL keep preview and timeline visible together on supported mobile viewports. Template editing and custom element editing SHALL NOT place preview and timeline behind separate modes or require page scrolling to move between them.

Consulted panes such as inspector, tools, layer actions, and template fields SHALL become sheets or bounded panes when resident columns do not fit.

#### Scenario: The template editor opens on a portrait phone

- **WHEN** the operator opens the video template editor at portrait phone width
- **THEN** the preview and timeline are visible together, and template fields are reachable through a bounded inspector or sheet

#### Scenario: The custom element editor opens on a portrait phone

- **WHEN** the operator opens the custom element editor at portrait phone width
- **THEN** the preview and layer/keyframe timeline are visible together, and layer properties are reachable through a bounded inspector or sheet

#### Scenario: A sheet opens

- **WHEN** a VUI-backed editor opens an inspector or tools sheet on mobile
- **THEN** the sheet is dismissible and the underlying preview/timeline workspace remains in place

### Requirement: VUI mobile verification covers every editor surface

Phone-width verification SHALL cover the content editor, video template editor, and custom element editor after they are VUI-backed. The coverage SHALL assert that required surfaces have non-zero boxes, receive hit tests at their centers when visible, and can open and close mobile sheets.

#### Scenario: Mobile coverage runs for VUI editors

- **WHEN** the web verification suite exercises VUI editor mobile behavior
- **THEN** it checks content, template, and custom element editor workspaces rather than only the content editor

#### Scenario: A VUI editor overflows the viewport

- **WHEN** a converted editor surface extends required controls or timeline content outside the visible mobile viewport
- **THEN** the phone-width coverage fails and names the surface

### Requirement: VUI mobile performance is measured on editor interactions

Mobile verification for VUI-backed editors SHALL include performance probes for interactions that are expected to happen repeatedly: playback, timeline scrub or drag, sheet open/close, and inspector field edits.

The probes SHALL record changed-surface render counts or timing measurements with a documented baseline. A changed surface SHALL NOT be declared complete when the probe shows a regression caused by VUI extraction.

#### Scenario: Playback runs on mobile

- **WHEN** a VUI-backed editor plays preview on a phone-width viewport
- **THEN** the performance probe records that non-playhead panes do not rerender on every frame

#### Scenario: Timeline is scrubbed on mobile

- **WHEN** the operator scrubs or drags on a VUI-backed timeline at phone width
- **THEN** the performance probe records interaction timing or render counts for the timeline without unrelated inspector/panel churn

#### Scenario: Inspector field changes on mobile

- **WHEN** the operator edits an inspector field in a mobile sheet
- **THEN** the performance probe records that preview/timeline projection is rebuilt only when the edited field affects preview or timeline output

### Requirement: VUI studios become full-screen phone workspaces

At supported phone widths, video-template editor and custom-element/Motion Studio editor SHALL render as full-screen VUI workspaces occupying visual viewport from edge to edge. They SHALL NOT retain desktop modal padding, backdrop gaps, border radius, or a maximum width or height.

Fullscreen workspace SHALL account for dynamic viewport changes, display cutouts, home indicators, and on-screen keyboard. Header and action footer SHALL remain reachable; independently scrollable regions SHALL absorb overflow without causing document scrolling.

#### Scenario: Template editor opens on portrait phone

- **WHEN** operator opens video-template editor at phone width
- **THEN** workspace bounds match visual viewport bounds within device-pixel rounding and no desktop-modal gap remains

#### Scenario: Custom element editor opens on landscape phone

- **WHEN** operator opens Motion Studio at supported landscape phone size
- **THEN** workspace fills visual viewport, accounts for safe-area insets, and exposes close and save controls

#### Scenario: Virtual keyboard opens

- **WHEN** operator focuses inspector text field and virtual keyboard reduces visual viewport
- **THEN** focused field and action needed to finish or dismiss edit remain reachable without page scrolling beneath workspace

#### Scenario: Phone workspace closes

- **WHEN** operator dismisses editor
- **THEN** underlying page returns to previous scroll position and focus target

### Requirement: Every VUI editor keeps preview and timeline co-resident on phone

Content editor, video-template editor, and custom-element editor SHALL keep a non-zero preview and timeline visible together in the phone workspace without mode switching or page scrolling. Secondary inspector, tools, library, and action panes SHALL use VUI sheets or bounded overlays instead of a resident column that competes with preview height.

#### Scenario: Template field is edited

- **WHEN** operator opens template inspector sheet
- **THEN** preview and timeline retain their layout underneath and sheet can be dismissed back to same playhead and selection

#### Scenario: Motion layer is edited

- **WHEN** operator opens layer-property sheet
- **THEN** layer remains selected, preview and keyframe timeline retain state, and footer navigation remains operable according to sheet geometry

#### Scenario: No sheet is open

- **WHEN** phone workspace is idle
- **THEN** inspector does not consume a permanent preview column or vertical block

### Requirement: Fullscreen phone verification checks geometry and reachability

Phone portrait and landscape coverage SHALL exercise template and custom-element workspaces through real controls. Coverage SHALL verify viewport equality, safe-area containment, preview/timeline coexistence, header/footer reachability, sheet open/close, focus containment, center hit tests, absence of document scroll, and restoration after close.

#### Scenario: Fullscreen geometry regresses

- **WHEN** workspace leaves an outer gap, exceeds visual viewport, or preserves desktop radius at phone width
- **THEN** geometry coverage fails and names editor and viewport

#### Scenario: Required control is painted over

- **WHEN** close, save, transport, sheet trigger, or bottom navigation is not topmost at its actionable center
- **THEN** hit-test coverage fails

#### Scenario: Sheet cannot be dismissed

- **WHEN** explicit close, permitted Escape, or scrim dismissal fails
- **THEN** interaction coverage fails and leaves editor open for diagnostic screenshot

#### Scenario: Underlying document scrolls

- **WHEN** operator swipes or scrolls while fullscreen workspace is open
- **THEN** underlying page scroll position remains unchanged

### Requirement: The mobile inspector sheet is padded from a package token

The VUI sheet body SHALL apply padding from a documented custom property, and the property SHALL appear in the package's published styling contract alongside its other supported tokens.

The sheet body declares overflow and a maximum height and nothing else, so every field in every mobile inspector in the repository — content editor, Template Studio, Motion Studio — meets the sheet's wall with no gap. The remedy is a token rather than a rule in the application, because the package's own contract states that internal `.vui-*` class names are private and that consumers are not to fork package CSS; an unpaddable sheet body is therefore a gap in the package, not something for each consumer to work around.

#### Scenario: A mobile inspector sheet is opened

- **WHEN** any editor surface opens its inspector as a sheet at phone width
- **THEN** its content is inset from the sheet's edges rather than meeting them

#### Scenario: A consumer wants a different inset

- **WHEN** a consumer sets the documented padding property on a VUI root
- **THEN** the sheet body takes that value, without the consumer referencing a private class name

#### Scenario: The token is absent

- **WHEN** no consumer value is set
- **THEN** the sheet body falls back to the package's own spacing token rather than to no padding

### Requirement: The width at which panes stop being columns has one definition

Every editor surface that chooses between a column composition and a sheet composition SHALL read that answer from one exported predicate. A surface SHALL NOT restate the breakpoint, and SHALL NOT carry its own copy of the media query behind it.

There were three. `usePhoneLayout` answered at 860px; Template Studio and Motion Studio each declared `(max-width: 700px), (max-height: 500px) and (pointer: coarse)` in their own component; and the workspace answered again for itself. Between 700 and 860 the main editor composed as a phone while the studios composed as desktops, in the same window, in the same app — a band 160px wide where the editor disagreed with itself about what the viewport was.

Sharing the predicate is not only about the number. The two studios held the same media-query string verbatim, so the breakpoint was already stated in three places before anyone tried to change it, and a change to one of them would have widened the disagreement rather than fixed it.

One answer is deliberately separate and SHALL remain so: a workspace measures its OWN width, because an editor embedded in a narrow column is a narrow editor whatever the viewport is doing. That is a different question from how wide the viewport is, and the reason SHALL be recorded where the two sit next to each other, so the exception does not read as another copy that was missed.

#### Scenario: A surface asks whether to compose as columns

- **WHEN** any editor surface chooses between a resident column and a sheet
- **THEN** it reads the shared predicate rather than declaring a width or a media query of its own

#### Scenario: The viewport is inside the previously disputed band

- **WHEN** the viewport is between the old studio breakpoint and the editor's
- **THEN** every surface makes the same choice as every other

#### Scenario: The breakpoint moves

- **WHEN** the width is changed
- **THEN** it is changed in one place and every surface follows

#### Scenario: An editor is embedded in a narrow container on a wide viewport

- **WHEN** a workspace is narrower than the viewport that contains it
- **THEN** it may compose as compact on its own measurement, and that difference from the viewport predicate is documented rather than incidental

### Requirement: Desktop panel proportions persist consistently

The desktop editor SHALL default upper panes and timeline to 50%/50% of available height and tools, preview and inspector to 35%/30%/35% of available width after padding and gaps. Explicit pointer and keyboard resizing SHALL persist browser-local proportions across reloads and tool changes. Existing bounds SHALL retain usable panes on constrained viewports; phone housing SHALL ignore desktop overrides without overwriting them.

#### Scenario: Fresh editor

- **WHEN** no valid custom panel proportions are stored
- **THEN** the editor uses the default proportions, subject to existing minimum pane bounds

#### Scenario: Resize and reopen

- **WHEN** an operator resizes each desktop boundary and reloads or changes tools
- **THEN** all boundaries retain their authored proportions, including Chat

#### Scenario: Storage is malformed or unavailable

- **WHEN** browser storage contains invalid values or refuses access
- **THEN** the editor recovers to defaults and pointer and keyboard resizing remain usable

### Requirement: Chat uses shared tool-panel geometry

Desktop Chat SHALL use the same tools-panel sizing, minimum bounds and resize controls as other destinations. Chat and nested scrolling content SHALL hide scrollbar chrome while retaining native scrolling. Chat history SHALL shrink without forcing a different upper-row minimum height.

#### Scenario: Chat opens in resized workspace

- **WHEN** the operator switches between Chat and another tool or reduces upper-row height
- **THEN** pane boundaries remain unchanged, inspector remains available, and the Chat composer remains reachable
