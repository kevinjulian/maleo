# desktop-editor-layout Specification

## Purpose

Provide adjustable desktop editing space with consistent tool rails and uncluttered scrolling while preserving mobile navigation and editor reachability.

## Requirements

### Requirement: Editor tools use compact desktop headers and clear mobile sheets

Desktop editor tool panels SHALL use compact, quiet titles and named close actions. On phones, tool sheets SHALL retain prominent identity, visible close actions and at least 44px touch targets. Assets source tabs SHALL read Media, References and Stock. Reference ownership SHALL remain explained inside References content; Assets SHALL omit quick-create tiles; media search and import SHALL precede kind/sort controls and icon-only grid/list actions without repeated header or instruction rows. Import availability, errors, retries and upload feedback SHALL remain reachable.

#### Scenario: Desktop operator scans tool content

- **WHEN** an operator switches between editor tool destinations above 860px
- **THEN** their compact headers use consistent type and spacing
- **AND** Assets exposes its three source tabs with search/import preceding other media controls

#### Scenario: Phone operator uses and dismisses tools

- **WHEN** an operator opens Assets on a 320px coarse-pointer device
- **THEN** sheet title and close action remain visible with usable touch targets
- **AND** all three sources, search and file selection remain operable

### Requirement: Desktop editor panes resize at their boundaries

The editor SHALL allow resizing tools against preview, inspector against preview, and the upper panes against the full-width timeline on desktop widths above 860px. Boundaries SHALL have invisible pointer hit areas filling the entire existing inter-panel gap with horizontal or vertical resize cursors and no decorative handle or new panel appearance. Keyboard focus SHALL remain visible, and separators SHALL expose accessible names, orientation, current size, and arrow-key resizing. Resizing SHALL preserve a usable preview and reachable controls, clamp dimensions to available space, and release drag state on cancellation, pointer loss, or unmount.

#### Scenario: Operator resizes all desktop boundaries

- **WHEN** an operator drags each boundary in a desktop editor with tools and inspector open
- **THEN** its adjacent panes resize in the drag direction
- **AND** preview remains visible and timeline spans the entire workspace width

#### Scenario: Resize remains bounded

- **WHEN** an operator drags past available space or narrows the browser after resizing
- **THEN** pane dimensions are clamped without obscuring the preview or putting controls outside their scrollable regions

#### Scenario: Keyboard resizing

- **WHEN** an operator focuses a resize separator and presses an arrow along its resize axis
- **THEN** its size changes within the same bounds as pointer resizing
- **AND** focus and current size remain accessible

#### Scenario: Interrupted drag

- **WHEN** a resize gesture is cancelled, loses capture, or its editor unmounts
- **THEN** drag listeners and global cursor or text-selection overrides are released

#### Scenario: Phone retains existing housing

- **WHEN** the viewport becomes 860px wide or narrower
- **THEN** desktop separators and their dimension overrides do not affect phone preview, timeline, bottom rail, or sheets
- **AND** returning to desktop restores a bounded desktop layout

### Requirement: Inspector and contextual panels scroll without scrollbar chrome

The inspector and contextual panel bodies SHALL hide scrollbar chrome while retaining wheel, trackpad, touch, and keyboard scrolling. Focused fields SHALL scroll into view, and long content SHALL remain reachable. Timeline navigation scrollbars SHALL retain existing behavior.

#### Scenario: Long panel remains usable

- **WHEN** panel content exceeds its body height
- **THEN** no scrollbar chrome occupies body space
- **AND** the final field is reachable by scrolling and keyboard focus

### Requirement: Desktop tools and inspector rails share visual behavior

The desktop tools rail and its buttons SHALL match the inspector rail's width, alignment, padding, spacing, icon sizing, border, active, hover, and focus behavior. Their distinct destinations and accessible names SHALL remain intact, with existing shortcuts retained. Phone rail layout and touch targets SHALL remain usable.

#### Scenario: Rails align on desktop

- **WHEN** both rails are visible
- **THEN** their containers and child buttons share the same visual metrics and interaction states
- **AND** each destination remains identifiable and operable by keyboard

#### Scenario: Phone destinations remain reachable

- **WHEN** the editor is opened at 320px with a coarse pointer
- **THEN** the existing bottom rail and sheets retain reachable destinations and touch targets

### Requirement: Editor disclosures and timeline cursors stay clear

Inspector disclosure SHALL use SVG chevrons instead of text glyphs. Non-editable timeline backgrounds, ruler and labels SHALL use the default cursor; actual text fields and gesture handles SHALL retain their applicable cursors.

#### Scenario: Inspector disclosure glyph

- **WHEN** an operator expands or collapses an inspector section
- **THEN** its chevron points down or right without textual greater-than or down glyphs

#### Scenario: Timeline navigation cursor

- **WHEN** a pointer moves over timeline ruler, lane background or non-editable labels
- **THEN** the cursor is default rather than text

### Requirement: Captions reveal configuration only when enabled

Captions SHALL show only its title/close and enable control while disabled. Enabling SHALL reveal semantic inspector sections for presets, typography, timing/alignment/SRT, layout and colors/shadow. Disabling SHALL hide them without discarding configuration. Existing setup/alignment, re-align, SRT, preview/render and persistence behavior SHALL remain functional.

#### Scenario: Captions off and back on

- **WHEN** an operator disables captions and later enables them
- **THEN** configuration is hidden while off and returns with its retained values when enabled

### Requirement: Templates keeps its title above both sections

Templates SHALL have one panel header/close above Render override and Templates inspector sections, within one scrollable content body. Existing override write/reset and template create/edit/select behavior SHALL remain intact.

#### Scenario: Templates hierarchy

- **WHEN** an operator opens Templates in a project
- **THEN** title and close precede both collapsible sections and remain outside their scroll body

### Requirement: Clip property groups follow one order per clip kind

The clip inspector rail and the phone contextual bar SHALL offer the same property groups for a clip kind, in the same order, with the clip's own content group first and selected by default when no remembered group applies. Each group SHALL have its own icon, and no two groups SHALL share an icon. The groups SHALL be:

- Text: Text, Transform, Blending, Timing
- Video overlay: Source, Transform, Blending, Audio (only when the media carries sound), Timing, Masks, Adjust, Reveal
- Image overlay: Source, Transform, Blending, Timing, Masks, Adjust, Reveal
- Scene: Source, Shot, Transform, Blending, Timing (only when a scene visual is a video), Masks, Adjust, Background
- Audio: Audio, Timing, Source
- Data callout: Data, Transform, Blending, Motion, Background

Transform SHALL hold position, size, scale and rotation; Blending SHALL hold opacity and blend mode; Masks SHALL hold the clip mask; Adjust SHALL hold brightness, contrast and saturation; Timing SHALL hold trim and source playback (rate, reverse, pitch).

#### Scenario: Default group is the clip's content

- **WHEN** an operator selects a text overlay for the first time
- **THEN** the inspector opens on Text, and the rail lists Text, Transform, Blending, Timing in that order

#### Scenario: Opacity lives in Blending

- **WHEN** an operator opens Transform on an image overlay
- **THEN** it offers position, size, scale and rotation but not opacity, and Blending offers opacity and blend mode

#### Scenario: Same groups on the phone

- **WHEN** the same clip is selected at phone width
- **THEN** the contextual bar offers the same groups in the same order as the desktop rail

#### Scenario: A locked track freezes every canvas group

- **WHEN** an operator selects a clip on a locked track and opens Transform, Blending, Masks or Adjust
- **THEN** each group shows that the track is locked instead of its controls
