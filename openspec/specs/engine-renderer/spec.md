# engine-renderer Specification

## Purpose

The Rust renderer draws video frames from the render storyboard, so that preview and export on every platform can come from one engine instead of from Remotion in a browser.

## Requirements

### Requirement: The renderer draws a frame of a render storyboard

The renderer SHALL take a render storyboard, a frame index and an output size, and SHALL return
one RGBA frame. The render storyboard SHALL be the same value that the Remotion compositions
receive, built by the same shared function. The renderer SHALL NOT read a second document
shape. Frame timing SHALL use the storyboard frame rate and the same frame-to-time rule as
Remotion.

The renderer SHALL refuse a storyboard that fails to parse, with an error that names the
failing field. It SHALL NOT draw a partial frame for an unparseable storyboard.

#### Scenario: A frame is drawn

- **WHEN** the renderer receives a valid 1080x1920 storyboard and frame 30
- **THEN** it returns one 1080x1920 RGBA frame for the time 1.0 s at 30 fps

#### Scenario: The same input draws the same frame

- **WHEN** the renderer draws the same storyboard and frame twice on one device
- **THEN** the two frames are byte-identical

#### Scenario: A storyboard does not parse

- **WHEN** the renderer receives a storyboard whose `scenes` field is not an array
- **THEN** it returns an error that names `scenes`
- **AND** it returns no frame

### Requirement: The renderer supports the static layers and captions

The renderer SHALL draw these elements as Remotion draws them:

- the storyboard background, as a solid color or a CSS linear or radial gradient,
- image scene visuals and image overlays, with their layout box, crop, fit and opacity,
- plain text overlays,
- caption cues, with every caption style option and every caption motion that the web client
  offers.

Layers SHALL stack in the order that the Remotion composition uses.

#### Scenario: A caption with a box and a stroke is drawn

- **WHEN** a frame shows a caption cue with a background box, a stroke and the karaoke highlight
- **THEN** the renderer draws the box, the stroke and the active word color at the positions Remotion uses

#### Scenario: A caption motion is drawn

- **WHEN** a frame falls inside the entrance of a caption chunk with the `Pop` motion
- **THEN** the renderer draws the chunk at the scale and opacity Remotion uses at that frame

#### Scenario: An image overlay with a crop is drawn

- **WHEN** an image overlay has a layout box, a crop and `cover` fit
- **THEN** the renderer draws the cropped image inside that box, covering it

### Requirement: The renderer reports what it cannot draw

For every frame, the renderer SHALL return a coverage report beside the frame. The report SHALL list each visible unsupported element or option by element kind and storyboard path. Support SHALL be inspected from the input independently of whether the drawing path visits the element. The renderer SHALL NOT omit an unsupported element or option without listing it. A frame with an empty report SHALL be a complete frame.

Supported motion or compositing on an element SHALL NOT hide unsupported media, presets, fonts or other options on that element. A render failure SHALL remain an error, not a successful frame with an empty report.

#### Scenario: A frame has a keyframed overlay

- **WHEN** a frame shows a text overlay with opacity keyframes, and keyframes are not supported yet
- **THEN** the coverage report lists that overlay with its kind and path
- **AND** the frame is still returned

#### Scenario: A video also has supported rotation

- **WHEN** a visible video overlay has rotation that the renderer supports but video media remains unsupported
- **THEN** coverage lists the unsupported video media with its kind and path
- **AND** it does not list rotation as unsupported

#### Scenario: A template remains outside this change

- **WHEN** a visible text overlay uses an unsupported visual template with otherwise supported keyframes
- **THEN** coverage continues to name the unsupported template

#### Scenario: A frame has only supported elements

- **WHEN** every visible element and option at a frame is supported
- **THEN** the coverage report is empty

### Requirement: The renderer bundles its fonts

The renderer SHALL draw text only with fonts that it bundles: Inter (the weights, italic and
subsets that the compositions use) and a color emoji font. It SHALL NOT read system fonts. A
glyph that no bundled font covers SHALL be drawn as the bundled font's missing-glyph shape, and
the frame SHALL NOT fail.

#### Scenario: A caption contains an emoji

- **WHEN** a caption cue contains an emoji
- **THEN** the renderer draws the emoji in color from the bundled emoji font

#### Scenario: Two hosts draw the same text

- **WHEN** a native host and a browser host draw the same text frame
- **THEN** both use the same bundled font files

### Requirement: Missing media draws a placeholder

When the bytes of an image that a frame needs are not available to the renderer, the renderer
SHALL draw a placeholder in that element's layout box and SHALL list the element as missing
media in the coverage report. It SHALL NOT fail the frame.

#### Scenario: An image is not loaded

- **WHEN** a frame shows an image overlay whose URL the host has not supplied
- **THEN** the renderer draws a placeholder in the overlay's box
- **AND** the coverage report lists the overlay as missing media

### Requirement: Animated drawing preserves authored timing

The renderer SHALL sample visual layout and plain-text animation at the displayed frame using the existing keyframe contract. Clip tracks SHALL use clip-local seconds, entering-key easing, endpoint holds and retained easing subranges. Camera motion SHALL retain its existing normalized-progress timing. The renderer SHALL NOT rewrite authored animation or stretch ordinary clip tracks when duration changes.

Plain-text animation SHALL apply supported numeric and color tracks to the box or content that the reference renderer affects. Properties with no visual effect in the reference SHALL remain inert.

#### Scenario: A hold key changes at its boundary

- **WHEN** an image overlay has opacity 1 at local 0 s and a hold key of 0 at local 2 s
- **THEN** its opacity is 1 before 2 s and 0 at 2 s
- **AND** seeking directly to either frame produces the same result as sequential drawing

#### Scenario: A trimmed animation retains its curve

- **WHEN** a clip carries a retained easing subrange after trimming
- **THEN** the rendered values match the untrimmed animation at the corresponding original times

#### Scenario: Text animation changes layout and color

- **WHEN** a plain-text overlay animates its box, font size, line spacing, background opacity or text color
- **THEN** the renderer applies each value at the same local time and to the same box or content as the reference renderer
- **AND** captions retain their existing independent layout and motion

### Requirement: Camera motion preserves presets and custom paths

The renderer SHALL draw existing camera presets and custom camera keyframes with the reference defaults, focal origin, clipping and pixel-coordinate semantics. A custom path SHALL override the preset path. Deterministic glitch offsets SHALL follow the reference frame rule, including when a custom path is present.

#### Scenario: A custom camera path uses its focal origin

- **WHEN** an image scene has custom scale, translation and rotation keys and a noncentral focal point
- **THEN** the camera transform matches the reference at the start, intermediate frames and the final visible frame

#### Scenario: A camera preset is absent

- **WHEN** camera motion is active and no movement or custom path is supplied
- **THEN** the renderer uses the reference default Ken Burns motion

### Requirement: Clip compositing preserves local order and scene isolation

The renderer SHALL draw authored rotation, flips, crop, fit, opacity, rectangle and ellipse masks, mask rotation, feather and inversion. It SHALL apply brightness, contrast and saturation in the reference order and implement normal, multiply and screen blending against the same backdrop.

Compositing SHALL preserve source transparency, scene/visual layout inheritance and explicit mask removal. Local masks and crop SHALL transform with the element. Scene isolation and stacking SHALL match the reference. This requirement SHALL NOT make unsupported video media or text templates supported.

#### Scenario: A feathered mask moves with the element

- **WHEN** a cropped and flipped image has a rotated feathered ellipse mask and an animated outer rotation
- **THEN** the mask remains in the clip's local coordinates
- **AND** the displayed pixels match the reference order of crop, correction, masking and transforms

#### Scenario: An inverted mask reveals the outside

- **WHEN** an image has an inverted rectangle mask
- **THEN** the renderer retains pixels outside the mask with the reference feather and alpha behavior

#### Scenario: Blend modes see the correct backdrop

- **WHEN** translucent image overlays use multiply and screen over other layers
- **THEN** the renderer blends them in track order using the reference scene isolation
- **AND** an explicit null visual mask removes an inherited scene mask

### Requirement: Reveals preserve existing visual progression

The renderer SHALL draw existing fade, wipe, spotlight and sketch/draw reveals with the reference directions, phases, textures, intensity and color-build behavior. Auto duration SHALL follow the render clip duration. Manual duration, delay and phase boundaries SHALL use the reference clamping and frame rounding.

Reveal SHALL preserve the clip's media identity, authored placement, camera motion and transition. A video clip SHALL remain reported as unsupported media until video decoding is implemented.

#### Scenario: Black enters before color

- **WHEN** an image uses black-then-color reveal with a directional dark slide and a staged color build
- **THEN** the dark and color layers enter at the reference frames with the reference treatment
- **AND** full color completes according to the effective reveal duration

#### Scenario: An automatic reveal follows clip duration

- **WHEN** a clip with automatic reveal duration is extended
- **THEN** the renderer resolves reveal timing from the extended render duration without changing stored reveal metadata

### Requirement: Transitions preserve the active placement mode

The renderer SHALL draw cut, fade, slide, zoom, wipe, flip, clock wipe and pixel transitions according to the reference path for sequential scenes, absolute scenes, scene visuals and timeline visuals. It SHALL preserve incoming and outgoing visibility, transition duration defaults, frame rounding, outgoing holds, gaps and stacking. It SHALL NOT replace different existing placement paths with one approximate transition rule.

#### Scenario: Sequential scenes overlap through a transition

- **WHEN** sequential image scenes use a clock wipe
- **THEN** overlap timing and the wipe presentation match the reference sequential-scene path

#### Scenario: Absolute scenes hold the outgoing image

- **WHEN** an absolute scene starts after the previous scene's nominal end and uses a slide entrance
- **THEN** the outgoing hold and exit match the reference absolute-scene path
- **AND** the transition introduces no extra black boundary frame

#### Scenario: A visual inside a scene enters

- **WHEN** a later visual in a multi-visual scene has an entrance transition
- **THEN** its local start, visibility and entrance match the reference scene-visual path

### Requirement: Effects and decorations preserve their scope

The renderer SHALL draw fade-in, fade-out, zoom-out-from-black, flash, zoom-punch and whip-pan effects with the reference envelopes, intensity defaults, overlap rules and layer scope. It SHALL draw scene labels and their legibility gradient, vignette, grain, chapter pills and progress bars using the reference visibility and timing rules.

Repeated and out-of-order frame requests SHALL produce the same pixels on one device. Chapter spans and progress SHALL use the same composition timing as the reference.

#### Scenario: Overlapping effects retain their combination rule

- **WHEN** fade, flash and zoom effects overlap
- **THEN** black/white envelopes and transforms combine as in the reference
- **AND** captions and decorations are affected only where the reference affects them

#### Scenario: A chapter changes

- **WHEN** the displayed frame crosses a chapter boundary
- **THEN** the chapter pill changes label and restarts its reference entrance motion
- **AND** progress remains relative to the whole composition

#### Scenario: A bare scene has no label shading

- **WHEN** a scene has no visible label and vignette and grain are disabled
- **THEN** the renderer adds no label legibility gradient
