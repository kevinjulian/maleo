# renderer-parity Specification

## Purpose

Measure the Rust renderer against Remotion on real storyboards, so that render authority moves to Rust only on evidence and every supported feature stays at parity during the window.

## Requirements

### Requirement: A golden-frame corpus holds Remotion references

The repository SHALL hold a golden-frame corpus. Each case SHALL hold a render storyboard, its
media, the frame indexes to compare, and one Remotion reference frame per index. References SHALL
be rendered by the product's Remotion compositions in the production image. The corpus SHALL
record the Remotion version and the image that rendered the references.

Every element kind that the renderer supports SHALL appear in at least one case. Adding support
for an element kind SHALL add a case for it.

#### Scenario: A case is complete

- **WHEN** the corpus check runs
- **THEN** every case has one reference frame for each listed frame index
- **AND** the check fails when a reference is missing

#### Scenario: A supported kind has no case

- **WHEN** the renderer declares support for an element kind that no corpus case contains
- **THEN** the corpus check fails and names the kind

### Requirement: The parity gate compares every case

The test suite SHALL render every corpus case with the Rust renderer and compare each frame with
its reference by SSIM, over the whole frame and over each element region the case lists. A frame
SHALL pass only when both scores meet the thresholds the corpus records and its coverage report
is empty. The gate SHALL run in CI without a GPU.

A threshold SHALL NOT be lowered without a recorded reason in the corpus. When a reference
changes, the change SHALL show the old and new frame side by side in review.

#### Scenario: A frame is at parity

- **WHEN** a case frame scores above both thresholds and its coverage report is empty
- **THEN** the frame passes

#### Scenario: A frame drifts

- **WHEN** a code change lowers a frame's region SSIM below its threshold
- **THEN** the test fails and names the case, the frame, the region and the score
- **AND** it writes the Rust frame and a difference image for review

#### Scenario: A frame is not fully supported

- **WHEN** a case frame has a non-empty coverage report
- **THEN** the frame fails and the report is printed

### Requirement: Both renderers draw from the same fonts

Remotion references, Remotion exports and the Rust renderer SHALL draw with the same font set:
Inter and one color emoji font. The production image SHALL install the color emoji font that the
Rust renderer bundles.

#### Scenario: An export contains an emoji

- **WHEN** a storyboard with an emoji caption is exported through Remotion in the production image
- **THEN** the exported frame shows the emoji in color, not an empty box

### Requirement: The web editor offers a hidden compare mode

The web editor SHALL offer a compare mode, opened by the `renderer=compare` URL parameter and
not by any visible control. In compare mode, the editor SHALL draw the Rust frame through the
preview session, in a worker, beside the Remotion Player and for the same storyboard. A seek in
the editor SHALL seek the session. When the Remotion Player plays or pauses, the session SHALL
play or pause from the same position on its own clock. The panel SHALL show the Rust frame time,
the dropped-frame count, the drift between the two playheads, and the coverage report. Remotion
SHALL stay the only preview in every mode and the only export renderer.

The renderer module and the preview worker SHALL load only in compare mode. Without the
parameter, the editor SHALL NOT fetch either.

When the browser has no WebGPU adapter, compare mode SHALL show that the Rust renderer is not
available, and the Remotion preview SHALL work as without the parameter.

#### Scenario: An operator compares a project

- **WHEN** an operator opens a project with `?renderer=compare` and seeks to 4.0 s
- **THEN** the Rust frame for 4.0 s shows beside the Remotion Player
- **AND** the panel shows the Rust frame time and lists any unsupported elements

#### Scenario: An operator plays a project in compare mode

- **WHEN** an operator plays a project in compare mode for 10 seconds
- **THEN** the Rust preview plays on its own clock beside the Remotion Player
- **AND** the panel shows the playhead drift and the dropped-frame count

#### Scenario: The editor opens normally

- **WHEN** an operator opens a project without the parameter
- **THEN** neither the renderer module nor the preview worker is requested

#### Scenario: WebGPU is not available

- **WHEN** an operator opens compare mode in a browser with no WebGPU adapter
- **THEN** the compare panel says the Rust renderer is not available in this browser
- **AND** the Remotion preview plays and seeks as usual

### Requirement: Motion and compositing have option-level evidence

Each newly supported motion, compositing, transition, reveal, effect and decoration option SHALL have a synthetic golden case or named coverage within a case. Cases SHALL include representative combinations that expose treatment order, layer isolation and transparency. References SHALL come from the existing production Remotion path before any reference-behavior change.

The corpus SHALL identify the options each case exercises. An option declared supported without its required case SHALL fail the corpus check. Existing score thresholds and reference-review rules SHALL continue to apply.

For approved low-contrast compositing cases, full-frame and region SSIM SHALL
remain unchanged. Geometry SHALL be measured by a named high-contrast companion
with the same dimensions and all sampled frames, using the existing two-pixel
limit. The corpus check SHALL reject missing companions, delegated companions,
empty geometry regions or incomplete temporal coverage.

#### Scenario: A photographic reveal has unstable ink thresholds

- **WHEN** `reveal-color-builds` names `reveal-phase-geometry` as its approved geometry companion
- **THEN** the gate retains every photographic SSIM comparison
- **AND** the companion measures direct and dark reveal boundaries within two pixels
- **AND** removing the companion or one required frame fails corpus validation

#### Scenario: A declared mask option has no case

- **WHEN** mask inversion is declared supported but no corpus case exercises inversion
- **THEN** the corpus check fails and names the missing option

#### Scenario: Treatment order is exercised

- **WHEN** a case combines crop, flip, color correction, a feathered mask and rotation over a contrasting backdrop
- **THEN** the parity gate compares both the whole frame and the affected element region against the reference

### Requirement: Temporal parity includes boundaries and random access

Motion parity SHALL include deterministic numeric samples and golden frames at entrances, intermediate times, exits and discontinuities. Cases SHALL cover hold keys, retained easing subranges, camera focal points, reveal phase changes and transition placement modes. Samples SHALL state their frame rate, local time and reference rounding rules.

The renderer SHALL match the same reference frame after sequential drawing, direct seek and out-of-order drawing. A numeric fixture check SHALL fail when source behavior changes without regenerated fixtures.

#### Scenario: A hold boundary is sampled

- **WHEN** a key uses hold interpolation
- **THEN** the evidence includes samples immediately before and at its key time
- **AND** the gate detects a one-frame timing error

#### Scenario: A transition is reached by seeking

- **WHEN** a transition midpoint is drawn directly and after drawing earlier and later frames
- **THEN** the results are identical on one device and match the reference within the existing visual thresholds

#### Scenario: Identical textures receive different atlas allocations

- **WHEN** identical image bytes are registered again and drawn with the same affine transform on one device
- **THEN** output pixels remain byte-identical despite changed atlas placement
- **AND** native and WASM builds use the same reviewed dependency correction

### Requirement: Compare-mode validation covers expanded drawing support

Acceptance for expanded renderer support SHALL exercise the running hidden compare mode with motion and compositing fixtures. It SHALL record visual comparisons, coverage, frame times, dropped frames, seek behavior and GPU recovery. Recovery SHALL preserve supplied images and rebuild resources used by the new treatments.

Normal preview and production export SHALL continue through Remotion. Without the compare parameter, the web editor SHALL NOT load the Rust renderer or its worker.

#### Scenario: Recovery redraws a composited frame

- **WHEN** the GPU device is lost while a masked and color-corrected image frame is displayed in compare mode
- **THEN** recovery redraws the frame with its treatments and supplied image intact
- **AND** a failed recovery reports failure instead of silently dropping a treatment

#### Scenario: Normal editor remains on Remotion

- **WHEN** an operator opens the editor without the compare parameter after expanded support is installed
- **THEN** normal preview and export retain their existing renderer
- **AND** neither Rust renderer module nor preview worker is requested

### Requirement: Plain-text shadows and glyphs match production on dark backgrounds

The Rust renderer SHALL draw the plain-text shadow and the glyph positions as the production
Remotion image draws them, also when the shadow is the lowest ink of a frame. The renderer SHALL
put each text baseline on a whole pixel. For text that production draws from its glyph cache, the
renderer SHALL blur the shadow of each glyph separately and blend each blurred shadow in byte
arithmetic, so that the shadow tails on a dark background have the same darkness as production.
The corpus SHALL hold a case whose lowest ink is a text shadow on a dark background.

#### Scenario: A text shadow is the lowest ink

- **WHEN** the parity gate draws a frame whose lowest ink is a plain-text shadow on `#10182b`
- **THEN** the bottom edge of the ink box is at most 2 px from the reference

#### Scenario: A baseline falls between pixels

- **WHEN** the layout puts a text baseline at a fractional pixel position
- **THEN** the renderer draws the glyphs on the nearest whole-pixel baseline, as the reference does
