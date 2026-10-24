## Purpose

Measure the Rust renderer against Remotion on real storyboards, so that render authority moves to Rust only on evidence and every supported feature stays at parity during the window.

## ADDED Requirements

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
not by any visible control. In compare mode, the editor SHALL draw the Rust frame for the same
storyboard and frame as the Remotion Player, beside it, and SHALL show the Rust frame time and
the coverage report. Remotion SHALL stay the only preview in every mode and the only export
renderer.

The renderer module SHALL load only in compare mode. Without the parameter, the editor SHALL NOT
fetch it.

When the browser has no WebGPU adapter, compare mode SHALL show that the Rust renderer is not
available, and the Remotion preview SHALL work as without the parameter.

#### Scenario: An operator compares a project

- **WHEN** an operator opens a project with `?renderer=compare` and seeks to 4.0 s
- **THEN** the Rust frame for 4.0 s shows beside the Remotion Player
- **AND** the panel shows the Rust frame time and lists any unsupported elements

#### Scenario: The editor opens normally

- **WHEN** an operator opens a project without the parameter
- **THEN** the renderer module is not requested

#### Scenario: WebGPU is not available

- **WHEN** an operator opens compare mode in a browser with no WebGPU adapter
- **THEN** the compare panel says the Rust renderer is not available in this browser
- **AND** the Remotion preview plays and seeks as usual
