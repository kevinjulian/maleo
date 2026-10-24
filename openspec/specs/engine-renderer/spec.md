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

For every frame, the renderer SHALL return a coverage report beside the frame. The report SHALL
list each element visible at that frame that the renderer does not support, by element kind and
storyboard path. The renderer SHALL NOT omit an unsupported element without listing it. A frame
with an empty report SHALL be a complete frame.

#### Scenario: A frame has a keyframed overlay

- **WHEN** a frame shows a text overlay with opacity keyframes, and keyframes are not supported yet
- **THEN** the coverage report lists that overlay with its kind and path
- **AND** the frame is still returned

#### Scenario: A frame has only supported elements

- **WHEN** every visible element at a frame is supported
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
