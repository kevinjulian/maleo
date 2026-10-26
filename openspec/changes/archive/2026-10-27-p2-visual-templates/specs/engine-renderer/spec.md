# Spec Delta

## ADDED Requirements

### Requirement: The renderer draws five basic shape primitives

The renderer SHALL draw Circle, Rectangle, Triangle, five-point Star and plus-sign Cross from the shared visual definition. Shapes SHALL preserve fill, stroke color/width, opacity, layout, transforms and supported property animation. Corner radius SHALL apply only to Rectangle. Shapes SHALL NOT require text content or font metrics.

Both renderers SHALL use the same normalized geometry and stroke convention. Shapes SHALL retain authored zero values and transparency at different output aspect ratios and dimensions.

#### Scenario: A Star is rotated and stroked

- **WHEN** a five-point Star has a transparent fill, visible stroke and rotation keyframes
- **THEN** the renderer draws its authored geometry and stroke at each sampled rotation
- **AND** the shape requires no text or font fallback

#### Scenario: A Cross has zero opacity

- **WHEN** a plus-sign Cross has authored opacity zero
- **THEN** it remains invisible rather than receiving a default nonzero opacity

### Requirement: The renderer interprets user-authored motion layers

The renderer SHALL interpret validated user-authored compositions of plain text and the five supported shapes. It SHALL preserve the existing composition span, relative layer placement, layer order, local layout/style and normalized internal animation. Ordinary outer clip tracks SHALL retain their clip-local-seconds timing.

The renderer SHALL NOT read a second editable document or execute template scripts. Missing fields SHALL follow explicit retained-primitive defaults, never a retired title preset. Unsupported versions or layer options SHALL be refused or reported at the exact layer path, not silently omitted.

#### Scenario: Inner and outer animation coexist

- **WHEN** a composition has normalized internal layer animation and clip-local outer opacity keys
- **THEN** each uses its own timing rule
- **AND** direct seeking draws the same result as sequential playback

#### Scenario: A layer is unsupported

- **WHEN** an input bypasses authoring validation and contains an unsupported layer option
- **THEN** the renderer reports that option at its composition-layer path or refuses malformed input
- **AND** it does not declare the frame complete by skipping the layer
