# clip-reveal-effects Specification

## Purpose

Define clip-local reveal effects for visual clips, including progressive
appearance, reveal timing, supported controls, and preview/export parity.

## Requirements

### Requirement: Visual clips can reveal progressively

The timeline SHALL allow an operator to enable a reveal effect on an image or
video visual clip. The effect SHALL make the clip appear progressively over time
without changing the clip's media URL, start time, duration, track, transition,
or camera motion.

#### Scenario: Enable reveal on an image clip

- **WHEN** the operator selects an image clip and enables a wipe reveal
- **THEN** the clip retains its existing media, timing, transition, and camera
  movement
- **AND** the preview renders the image progressively revealed during the clip

#### Scenario: Clip without reveal is unchanged

- **WHEN** a visual clip has no reveal metadata
- **THEN** preview and export render it with the same behavior as before this
  change

### Requirement: Reveal timing defaults to the clip duration

Reveal timing SHALL default to Auto. In Auto mode, the effective reveal duration
SHALL equal the current visual clip duration and the reveal SHALL begin at the
clip start unless a delay is explicitly configured.

#### Scenario: Auto reveal follows a stretched clip

- **WHEN** a clip with Auto reveal duration is stretched from 4 seconds to 7
  seconds
- **THEN** the effective reveal duration becomes 7 seconds
- **AND** no stored reveal duration is required to change

#### Scenario: Auto reveal follows a trimmed clip

- **WHEN** a clip with Auto reveal duration is trimmed from 6 seconds to 3
  seconds
- **THEN** the effective reveal duration becomes 3 seconds

### Requirement: Operators can override reveal duration

The timeline inspector SHALL let the operator switch reveal duration from Auto
to Manual and set a manual duration. Manual duration SHALL be clamped to the
current clip duration and SHALL remain manual when the clip is later resized,
unless it must be clamped because it exceeds the new clip duration.

#### Scenario: Manual reveal duration is shorter than clip

- **WHEN** a 6 second clip has reveal duration set manually to 2 seconds
- **THEN** the reveal completes after 2 seconds
- **AND** the clip remains visible for the rest of its duration

#### Scenario: Manual reveal duration is clamped after resize

- **WHEN** a 6 second clip has manual reveal duration set to 5 seconds
- **AND** the clip is trimmed to 3 seconds
- **THEN** the manual reveal duration is clamped to 3 seconds

### Requirement: Reveal controls expose supported options only

The timeline inspector SHALL offer only reveal types, directions, phases,
black-slide directions, textures, and color builds implemented by the renderer.
The MVP supported reveal types SHALL include fade, directional wipe, center
spotlight, and sketch/draw-style reveal. The MVP supported reveal phases SHALL
include direct color reveal, dark-pixels-first reveal, and black-then-color
reveal.

#### Scenario: Inspector shows supported reveal choices

- **WHEN** the operator opens reveal controls for a visual clip
- **THEN** the listed reveal types are values the renderer can render
- **AND** no unimplemented reveal type is selectable

#### Scenario: Direction controls match reveal type

- **WHEN** the selected reveal type supports direction
- **THEN** the inspector offers the supported directions
- **AND** when the selected reveal type does not support direction, direction is
  not required to render the effect

#### Scenario: Dark pixels reveal before color

- **WHEN** the operator selects the dark-pixels-first reveal phase
- **THEN** the preview reveals only dark pixels from the original clip first
- **AND** the original color clip is revealed after the dark-pixel phase begins

#### Scenario: Inspector shows supported enhancement choices

- **WHEN** the operator opens reveal controls for a visual clip
- **THEN** the listed direction, black-slide direction, texture, and color build
  options are values the renderer can render
- **AND** no unimplemented reveal enhancement is selectable

### Requirement: Reveal renders in preview and export

Reveal effects SHALL render through the shared Remotion storyboard path used by
both the web preview and final export. The same storyboard payload SHALL produce
the same reveal timing and visual progression in preview and export.

#### Scenario: Preview and export use same reveal payload

- **WHEN** a clip with a manual 2 second reveal is previewed and exported
- **THEN** both preview and export resolve the reveal to the same type,
  direction, phase, and effective duration

#### Scenario: Auto reveal resolves from render clip duration

- **WHEN** a clip with Auto reveal is rendered through preview or export
- **THEN** both paths derive reveal duration from that clip's render duration

### Requirement: Reveal can use textured edges

Reveal effects SHALL support deterministic edge treatments that alter the
reveal boundary without changing the clip media.

#### Scenario: Paper edge texture

- **WHEN** the operator selects a paper reveal edge
- **THEN** the reveal boundary renders with a subtle uneven edge
- **AND** preview and export use the same edge treatment

### Requirement: Reveal can build color progressively

Reveal effects SHALL support a color build mode that brings color in stages
instead of switching immediately from dark pixels to full color.

#### Scenario: Muted color before full color

- **WHEN** a clip uses dark-pixels-first phase and muted-to-full color build
- **THEN** dark pixels reveal first
- **AND** muted color appears before full saturation
- **AND** full color completes by the effective reveal duration

### Requirement: Reveal can slide in black before coloring

Reveal effects SHALL support a black-then-color phase that moves the clip as
dark pixels first through a selectable slide direction, then reveals the color
layer.

#### Scenario: Dark image slides in, then color follows

- **WHEN** a clip uses black-then-color phase
- **THEN** the dark-pixel image layer translates through the selected
  black-slide direction instead of being clipped by a mask
- **AND** the color layer starts after the dark-pixel reveal segment
- **AND** the color layer uses the selected reveal type and direction
- **AND** the effective reveal duration still controls when full color completes

#### Scenario: No black slide

- **WHEN** a clip uses black-then-color phase with black-slide direction `None`
- **THEN** the dark-pixel image layer is visible without slide translation
- **AND** the color layer still starts after the dark-pixel segment

#### Scenario: Default black slide direction

- **WHEN** a clip uses black-then-color phase without a stored black-slide
  direction
- **THEN** the renderer uses right-to-left for the dark-pixel reveal segment

### Requirement: Reveal can draw diagonally across the image

Reveal effects SHALL support a drawing-style top-left-to-bottom-right direction
that uses a moving reveal band rather than a direct triangular fill.

#### Scenario: Drawing-style diagonal direction

- **WHEN** the operator selects draw top left to bottom right
- **THEN** the reveal begins at the top-left corner
- **AND** a moving band sweeps toward the bottom-right edge
- **AND** existing camera motion remains unchanged
