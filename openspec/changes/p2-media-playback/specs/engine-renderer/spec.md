# Spec Delta

## MODIFIED Requirements

### Requirement: Missing media draws a placeholder

When required image bytes or the requested video frame are unavailable, the renderer SHALL draw a placeholder in the element's layout box. Coverage SHALL identify the exact element and missing media or requested frame. A frame from another source position SHALL NOT count as complete. Missing media SHALL NOT fail drawing of other supported elements. This paused inspection behavior SHALL NOT bypass the editor's full-media playback gate.

#### Scenario: An image is not loaded

- **WHEN** a frame shows an image overlay whose URL the host has not supplied
- **THEN** the renderer draws a placeholder in the overlay box
- **AND** coverage lists the overlay as missing media

#### Scenario: A requested video frame is absent

- **WHEN** the host supplied a video frame for source time 1 s but the current render requires source time 4 s
- **THEN** the renderer reports the missing requested frame
- **AND** it does not report complete coverage by reusing the 1 s frame

## ADDED Requirements

### Requirement: Decoded video uses the retained visual pipeline

The renderer SHALL draw decoded video frames in scene visuals, visual timelines and video overlays. It SHALL preserve source timing, stacking, crop, fit, transforms, masks, color adjustment, blending, motion, reveals and transitions through the retained visual pipeline. Two simultaneous instances of one source at different times SHALL remain distinct. Supported media SHALL cease producing blanket unsupported-video entries only when the requested frames and options are supported. Unsupported codecs, missing frames and unsupported options SHALL retain exact-path coverage or named adapter failures. A drawing failure SHALL remain an error.

#### Scenario: A masked video overlay plays

- **WHEN** a supported decoded video overlay has a crop, feathered mask and transform animation
- **THEN** its requested source frame receives those operations in the reference order
- **AND** complete supported frames have empty visual coverage

#### Scenario: Video participates in a scene transition

- **WHEN** two video scenes overlap through a retained transition
- **THEN** each uses the source frame required by its own placement and local time
- **AND** direct, sequential and out-of-order rendering preserve the same result
