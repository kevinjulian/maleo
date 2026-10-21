# vui-library-stability Specification

## Purpose

TBD - created by archiving change stabilize-maleo-vui-library. Update Purpose after archive.

## Requirements

### Requirement: Public layers preserve dependency isolation

Successor shared editing mechanics SHALL load without client UI, renderer integrations, browser globals, network or persistence IO. Web DOM mechanisms SHALL remain independent of React; React presentation SHALL consume those mechanisms and the engine binding without loading renderer integrations through unrelated imports. Browser media work and renderer integrations SHALL remain distinct adapters. Dependency-graph checks SHALL enforce these boundaries in the actual built outputs.

#### Scenario: The kernel is imported in a non-browser process

- **WHEN** a native or server runtime loads shared editing mechanics
- **THEN** they work without DOM globals, React or any renderer integration

#### Scenario: The kernel declares a runtime dependency

- **WHEN** a shared engine dependency reaches client UI or platform IO
- **THEN** the architecture gate rejects the dependency and names its source

#### Scenario: React consumer uses no renderer integration

- **WHEN** web presentation is imported without the Remotion adapter
- **THEN** unrelated UI imports do not require the renderer integration

#### Scenario: A renderer integration is requested without its peer

- **WHEN** a selected renderer adapter lacks its required runtime dependency
- **THEN** failure identifies that adapter boundary instead of breaking unrelated UI imports

#### Scenario: Maleo dependency enters package source

- **WHEN** migrated shared mechanics import an app-owned module or IO implementation
- **THEN** the architecture gate fails; pure canonical domain types are permitted under explicit shared ownership

### Requirement: Core commands describe complete editor gestures

Core SHALL expose renderer-neutral types for time, frames, selection, lanes, nested tracks, ranges, markers, viewport state, snapping, commands, and gesture phases. Mutating gestures SHALL distinguish begin, update, commit, and cancel so consumers can preview transient state, create one undo entry on commit, and restore state on cancellation.

Core SHALL provide pure geometry and hit-target helpers. It SHALL NOT prescribe Maleo scene, template, clip, layer, keyframe, media, or persistence semantics.

#### Scenario: Range resize completes

- **WHEN** a resize gesture begins, moves repeatedly, and ends
- **THEN** VUI emits one begin, zero or more updates, and one commit with neutral timing values

#### Scenario: Pointer interaction is cancelled

- **WHEN** pointer cancellation, lost capture, Escape, or component teardown interrupts a gesture
- **THEN** VUI emits cancel, releases listeners or capture, and emits no commit

#### Scenario: Consumer applies undo

- **WHEN** an adapter maps a committed VUI gesture into its document commands
- **THEN** all updates from that gesture become one consumer-owned undo step

#### Scenario: Domain meaning differs

- **WHEN** content, template, and custom-element adapters project their data
- **THEN** each can map its own domain objects to the same neutral mechanics without VUI importing those domain types

### Requirement: React workspace has typed composition modes

The React layer SHALL expose one editor-workspace primitive with typed `embedded`, `modal`, and `fullscreen` modes. It SHALL compose documented header, preview, transport, timeline toolbar, timeline, inspector, tools, mobile action, status, and footer/action regions. Optional regions SHALL collapse without leaving inaccessible or empty layout tracks.

The preview, transport, and timeline SHALL remain first-class regions in every mode. A consumer MAY override layout through documented slots and tokens, but an override SHALL NOT flatten the workspace such that timeline, inspector, or empty-state content occupies the preview's visual region. A consumer that needs its own sizing SHALL express it against the documented slots rather than by removing them, and the workspace SHALL provide enough stable slots and tokens for that to be possible without targeting private package DOM.

The workspace SHALL provide a domain-neutral mobile action region, rendered at the bottom safe-area edge on a compact viewport, that persists while the workspace is open and remains USABLE while a sheet is open. It exists because a consumer in `modal` or `fullscreen` mode has no element outside the workspace to attach a persistent bar to, and because a dismissable sheet cannot serve that purpose. The region SHALL accept consumer-supplied content without naming any consumer domain, and the package SHALL publish the region's height so its own sheets clear it without a consumer measuring package DOM.

Usable is stated over reachable because the two came apart. An overlay makes its background inert, `inert` cannot be escaped from within, and a region rendered inside the workspace is inside that background — so the region sat clear of the scrim, with the right label and the right box, and did nothing. The region SHALL therefore be rendered outside the subtree an overlay inerts, and the workspace SHALL reserve its height, since a region that is positioned rather than laid out no longer occupies the space it did.

The workspace SHALL expose controlled state and callbacks for active panels, selection, playback, viewport, and dismissal. It SHALL NOT require one package-owned document shape or persistence implementation.

#### Scenario: Workspace is embedded

- **WHEN** a consumer selects embedded mode
- **THEN** the workspace fills its containing block and does not create a viewport modal or body scroll lock

#### Scenario: Workspace is a desktop modal

- **WHEN** a consumer selects modal mode at desktop size
- **THEN** workspace uses a bounded surface with fixed header/footer and independently scrollable preview, timeline, and inspector regions

#### Scenario: Workspace is fullscreen

- **WHEN** a consumer selects fullscreen mode
- **THEN** workspace occupies the visual viewport and applies safe-area-aware regions without outer modal gaps

#### Scenario: Optional inspector is absent

- **WHEN** an adapter provides no resident inspector
- **THEN** preview and timeline consume available space without an empty inspector column or row

#### Scenario: Preview survives a consumer layout override

- **WHEN** a consumer overrides workspace layout through documented slots and tokens
- **THEN** the preview slot keeps a non-zero visible region and no timeline or inspector content occupies that region

#### Scenario: Mobile action content is supplied

- **WHEN** a compact workspace receives mobile action content
- **THEN** it renders at the bottom safe-area edge without covering the preview or permanently hiding the transport

#### Scenario: A sheet opens over a mobile action region

- **WHEN** a sheet opens on a compact workspace that has a mobile action region
- **THEN** the sheet clears the region's published height and the region's own controls stay reachable

#### Scenario: The action region is used while a sheet is open

- **WHEN** a control in the mobile action region is used with a sheet open over the workspace
- **THEN** it acts, rather than being visible and inert, and the sheet's own dismissal is not the only way back

### Requirement: Timeline supports domain extension without skeleton duplication

React timeline primitives SHALL own reusable ruler, gutter, playhead, viewport, scroll, zoom, lane layout, selection, range geometry, hit targets, and gesture routing. Consumers SHALL be able to supply typed renderers or slots for lane labels, range bodies, handles, overlays, nested tracks, curves, markers, and empty states.

Extension renderers SHALL receive documented semantic props and callbacks and SHALL NOT need to query private VUI class names, walk private DOM, or attach global listeners to reproduce base mechanics.

The Maleo Main Editor, Motion Studio, and Template Studio SHALL present consistent chrome for ruler, gutter, playhead, toolbar placement, transport, selected-range state, and mobile access, even where each draws domain-specific row bodies. A surface SHALL NOT reimplement a different toolbar, gutter, or playhead vocabulary where the shared workspace and timeline contracts can express the same behavior; if they cannot, the missing extension point is added rather than worked around.

Those surfaces SHALL present the timeline toolbar in the workspace's documented toolbar region, and SHALL hold the transport in the same region as one another, so the controls for the playhead and the playhead itself are not separated on some surfaces and joined on others. Where a region exists for chrome a surface draws, that region SHALL be the one it uses — a published region with no consumer and three hand-rolled equivalents beside it is not a shared shell.

A surface MAY render that region itself rather than passing it to the workspace, where its toolbar reads state the timeline region owns. The content editor's does: its gutter toggle and its organize action come from the same hook as the lane collision and the drag, whose inputs exist nowhere above that region. Hoisting a drag to change which component writes a wrapper element buys nothing the contract can see, and the contract is the slot, its position and its arrangement — not which component emitted it.

The toolbar SHALL position its regions by layout track rather than by flexible spacers, so a region's position does not depend on how much its neighbours contain. Positioning by spacer is what let the same readout sit at a different offset on two surfaces that were meant to match.

#### Scenario: Motion adapter renders keyframes

- **WHEN** Motion Studio supplies nested animated-property tracks
- **THEN** shared timeline mechanics render and navigate their rows while adapter renderers draw curves and keyframe markers

#### Scenario: Content adapter renders a domain clip

- **WHEN** content editor supplies clip-specific visuals and command mapping
- **THEN** VUI owns shared geometry and interaction routing while Maleo owns clip meaning and persistence

#### Scenario: Template adapter uses default ranges

- **WHEN** video-template editor needs only ranges and resize handles
- **THEN** it uses default timeline renderers or documented render slots without recreating private gutter, ruler, playhead, or drag infrastructure

#### Scenario: Studio chrome is consistent

- **WHEN** Main Editor, Template Studio, and Motion Studio are opened at the same viewport class
- **THEN** their timeline toolbar, ruler, gutter, playhead, and transport use the same placement and action vocabulary while each keeps its own domain rows

#### Scenario: The toolbar is composed through its region

- **WHEN** a surface draws a timeline toolbar
- **THEN** it passes it through the workspace's toolbar region rather than rendering an equivalent inside another region

#### Scenario: The transport is in one place

- **WHEN** the three surfaces are compared
- **THEN** each holds its transport in the same region as the others, and the transport's position within the toolbar does not shift with the contents of the regions beside it

#### Scenario: A surface has little to put in a toolbar region

- **WHEN** a surface leaves a toolbar region empty
- **THEN** the remaining regions keep their positions, rather than the layout redistributing around the gap

#### Scenario: Extension uses private DOM

- **WHEN** an adapter depends on an undocumented VUI descendant selector or DOM traversal for required behavior
- **THEN** the structural contract test fails or the missing extension point is added before migration completes

### Requirement: Renderer integration follows one adapter lifecycle

React workspace SHALL consume a renderer adapter describing dimensions, duration, frame rate, readiness, playback state, seek, play, pause, and subscription cleanup. Remotion integration SHALL implement that contract without making Remotion part of core or generic React workspace.

Renderer callbacks SHALL avoid feedback loops when external playhead state seeks the renderer and renderer frame updates publish current time.

Every Maleo editor surface that previews final video output SHALL mount a non-empty renderer inside its preview region, through the same renderer path used for export preview. The preview SHALL stay visible while nothing is selected, while a bottom sheet is open, and while the timeline has focus. No inspector empty state SHALL replace or obscure the preview region.

#### Scenario: Remotion preview mounts

- **WHEN** Maleo supplies the Remotion adapter
- **THEN** workspace transport and timeline control the same Player instance used for WYSIWYG preview

#### Scenario: Alternate renderer mounts

- **WHEN** a standalone example supplies a non-Remotion renderer adapter
- **THEN** preview, transport, playhead, and seek work without Remotion installed

#### Scenario: Renderer unmounts during playback

- **WHEN** workspace or preview unmounts while renderer events are active
- **THEN** subscriptions are removed and no state update targets the unmounted workspace

#### Scenario: Editor preview has geometry

- **WHEN** an Maleo editor surface that previews video output is opened
- **THEN** its preview region has non-zero width and height, is not occluded, and contains the renderer used for export-preview parity

#### Scenario: Empty inspector does not replace the preview

- **WHEN** no clip, range, or layer is selected
- **THEN** the inspector empty state renders in the inspector or sheet region rather than as a descendant of the preview region, and the preview region still shows the video stage

#### Scenario: Readiness is not proven by the timeline alone

- **WHEN** an automated check decides a video-previewing editor screen is ready
- **THEN** it waits on the preview region, so a collapsed or absent preview fails rather than being captured as a baseline

### Requirement: Modal and sheet primitives are accessible

VUI modal and sheet primitives SHALL expose labelled dialog semantics, initial focus, Tab containment, Escape dismissal when permitted, focus restoration, background inertness, and body scroll locking for viewport overlays. Nested overlays SHALL restore focus and inertness in stack order. Every dismissal path SHALL call consumer callbacks rather than mutating domain state directly.

Timeline and transport primitives SHALL have keyboard-reachable controls, visible focus, accessible names, and announcements for committed move or resize results. Shortcut ownership SHALL be configurable and SHALL preserve native text editing.

#### Scenario: Fullscreen editor opens

- **WHEN** editor opens from a trigger
- **THEN** focus enters workspace, background is inert, body cannot scroll, and accessible name identifies editor

#### Scenario: Operator tabs through editor

- **WHEN** focus reaches last tabbable control and Tab is pressed
- **THEN** focus remains within active modal or sheet

#### Scenario: Editor closes

- **WHEN** close control or permitted Escape dismissal closes workspace
- **THEN** focus returns to opener and background inertness and scroll lock are removed

#### Scenario: Input receives editor shortcut

- **WHEN** operator types Space, Delete, or undo keys in a text input
- **THEN** native editing behavior wins and no timeline command is emitted

#### Scenario: Range moves by keyboard

- **WHEN** focused editable range receives documented keyboard movement command
- **THEN** timing changes by declared step and assistive technology receives committed result

### Requirement: Performance boundaries are observable

Playback ticks, pointer updates, sheet state, and inspector edits SHALL have subscription boundaries that prevent unrelated workspace regions from re-rendering, and SHALL NOT cause a full repaint of the timeline canvas when only part of it changed.

Verification SHALL record, for named regions, the React render count, the mounted interactive node count, the invalidated paint region, and interaction duration, each separately. A broad elapsed-time ceiling alone SHALL NOT serve as evidence about re-rendering or repainting.

The package SHALL publish a performance budget in measured numbers, stated together with the reference consumer and hardware the measurement was taken on. Every entry SHALL be classified as one of three kinds, and the classification SHALL be published with it:

- an **invariant**, asserted exactly, with no tolerance and no hardware dependence;
- a **bound**, asserted with a ceiling, qualified by the hardware and item count it was measured on;
- a **reported** value, recorded and never asserted.

A reported value SHALL NOT be asserted anywhere. Mixing the three is how a budget stops being believed: a threshold placed on a number that moves with hardware and load becomes a muted test, and once one entry is muted the rest are not trusted either.

#### Scenario: An entry is published without its kind

- **WHEN** a budget entry is documented without a classification
- **THEN** the documentation check fails

#### Scenario: A reported value is asserted

- **WHEN** a test asserts a value the budget classifies as reported
- **THEN** the check fails and names the entry

#### Scenario: Playback advances

- **WHEN** the renderer publishes consecutive frame updates
- **THEN** the playhead updates, no unchanged region re-renders, and the invalidated paint region is limited to the playhead's own path

#### Scenario: Pointer drag updates

- **WHEN** a timeline gesture publishes transient updates
- **THEN** the affected item and overlays update without reconstructing unrelated rows or preview props, and the repaint is limited to the affected region

#### Scenario: Inspector-only field changes

- **WHEN** a field does not affect the preview or the timeline projection
- **THEN** the preview renderer does not re-render and the timeline is not repainted

#### Scenario: The budget is published

- **WHEN** the performance budget is documented
- **THEN** every number in it names the reference consumer, the item count, and the hardware it was measured on

#### Scenario: Performance baseline changes

- **WHEN** an implementation intentionally changes render counts, node counts, paint regions, or a timing threshold
- **THEN** the change records the measurement method, the before and after values, and the rationale beside the test baseline

### Requirement: A conformance kit is a shipped entry point

Successor engine and host adapters SHALL have executable conformance suites accessible to repository consumers. Renderer suites SHALL cover readiness, time reporting, seek clamping, play/pause, subscriptions and teardown; document/command suites SHALL cover admission, commit, rejection, inverse and replay. These suites SHALL run against actual built bindings and first-party adapters, without requiring an externally packed VUI artifact.

#### Scenario: A consumer runs a conformance suite from the packed artifact

- **WHEN** a repository consumer runs the successor conformance suite through its built engine binding or renderer adapter
- **THEN** it reports pass or failure for each applicable contract rule

#### Scenario: The conformance entry point is packed

- **WHEN** a supported application build is produced
- **THEN** its engine/adapter outputs can be exercised by the conformance runner without private package-source imports
