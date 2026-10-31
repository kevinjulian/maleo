# Proposal

## Why

The Rust renderer draws the plain-text shadow (`0 4px 16px` black at 50 %)
fainter near the glyphs than Remotion does, and places glyphs about half a pixel
lower. Existing golden cases do not show it, because other ink sits below their
text shadows. A composition whose lowest ink is a text shadow fails the
two-pixel geometry gate.

Found by `add-motion-design-generation` (task 2.5). Its golden case
`composition-generated` scored 0.996 to 1.0 SSIM but failed the geometry gate on
frames 90, 120, 138 and 142: the reference ink box bottom is y=617, the Rust ink
box bottom is y=613.

Measured on frame 90, maximum channel deviation from the background per row
under the evidence line (reference, Rust with sigma = radius / 2 not captured,
Rust with sigma = 0.57735 * radius + 0.5):

| Row | Reference | Rust, Skia sigma |
| --- | --------- | ---------------- |
| 611 | 131       | 233              |
| 612 | 9         | 7                |
| 614 | 8         | 6                |
| 616 | 7         | 5                |
| 618 | 6         | 4                |
| 620 | 5         | 4                |

Row 611 shows the glyph offset. Rows 612 to 620 show the fainter tail. Changing
the sigma alone made the gate worse (5 px), so the cause is not only the sigma
conversion.

## What Changes

- Find why the Rust text shadow is fainter near the glyphs: candidates are the
  blur kernel shape (Skia three-box against a truncated Gaussian), alpha
  compositing space, and the silhouette's sub-pixel position.
- Find why plain-text glyphs sit about half a pixel lower in Rust.
- Fix both in `crates/renderer`, then add the `composition-generated` golden case
  (`motion-comp.generated`) with the script in `evidence.md` and
  references rendered from the pinned production image.

## Capabilities

### New Capabilities

### Modified Capabilities

- `renderer-parity`: plain-text shadows and glyph placement match Remotion when
  the shadow is the lowest ink.

## Impact

- `crates/renderer/src/scene/text.rs`, `crates/renderer/src/blur.rs`, and
  possibly `scene/caption.rs`, which shares the shadow path.
- `crates/renderer/corpus/`: one new case and its references.
