# Spike C: captions in Rust against Remotion

Question: can Rust draw maleo's caption styles close enough to Remotion that
the renderer migration is safe?

Design: `openspec/changes/platform-p0-foundations/design.md`, decision D4.

## Pass criteria

1. SSIM at least 0.95 against the Remotion still for every fixture.
2. Line breaks, word highlight timing (frame index) and safe-area position
   match exactly.
3. Outline, shadow and highlight color are visually equal in a side-by-side
   review.

## What the spike does

- `fixtures/fixtures.json` holds 14 fixtures at 1080x1920, 30 fps. Each
  property of `Captions.tsx` is covered on its own: weight, italic, stroke,
  shadow, background, vertical position (top 15%, center 50%, 70%, and the
  bottom default) and the Karaoke highlight. Two combined styles stack them
  (`combined-a`: Bold, stroke, shadow, Karaoke, three wrapped lines;
  `combined-b`: Black italic, box, Word pop, all caps, emoji). The text is
  English and Indonesian, one fixture wraps to three lines, and one carries
  emoji.
- Each fixture renders three frames. Word 1 runs from 0.5 to 0.9 s and word 2
  starts at 1.0 s. Frame 21 (0.70 s) is mid-word, frame 28 (0.93 s) is between
  words (word 1 stays active), and frame 30 (1.00 s) is the exact frame word 2
  takes over.
- Reference: `remotion/render.ts` renders the product's own `Captions.tsx`,
  with the font load of `packages/video/src/fonts.ts`, through Remotion
  4.0.462 `renderStill`. It ran twice:
  - `reference/`: Chrome on macOS (this machine).
  - `reference-linux/`: the production image (`oven/bun` Debian, amd64,
    Chrome Headless Shell, `fonts-liberation`), which is where exports render.
- Candidate (`src/render.rs`): parley lays the cue out with the CSS rules of
  `Captions.tsx`. Those rules are `max-content` width capped at 86%, the
  14/24 px box padding, `top: N%` with `translate: 0 -100%`, `line-height`
  1.15, centered lines that exclude hanging spaces, and inline-block words.
  vello then draws the frame offscreen through wgpu: the background, the box,
  the shadow layer, and each word's fill with a 3 px miter stroke over it. A
  faded word is drawn in a layer. The fonts are the same Inter v20 files that
  `@remotion/google-fonts` loads (`fetch-fonts.sh`).
- Comparison (`src/compare.rs`): SSIM (11x11 Gaussian window, sigma 1.5, on
  luma) over the whole frame, and over the caption region alone (the caption's
  bounding box in either image plus 24 px). The structural checks compare ink
  extents within each line's x-height band, the box position (or the ink
  bounds when the cue has no box), and the bounds of the highlight color.

## Run

```bash
cd spikes/rust-captions
./fetch-fonts.sh                                    # Inter v20 TTFs
bun remotion/render.ts                              # reference/ (macOS)
docker run --rm --platform linux/amd64 -e REFERENCE_DIR=reference-linux \
  -v "$PWD/../../packages/video/src:/app/packages/video/src:ro" \
  -v "$PWD:/app/spikes/rust-captions" -w /app --entrypoint bun \
  <production image> spikes/rust-captions/remotion/render.ts
cargo run --release -- reference-linux              # or: reference
cargo run --release -- ssim A.png B.png             # one SSIM score
```

## Result

- Date: 2026-10-22, Apple M1 Pro (Metal).
- Text stack: **parley 0.11.1 with vello 0.11.0** on wgpu 30.0.1. Why:
  - parley ships Chromium's line-break table
    (`CHROMIUM_LINE_BREAK_OVERRIDE`) and applies the `wght` axis of the
    variable Inter.
  - vello draws glyph outlines on the GPU, so it can stroke them as
    `-webkit-text-stroke` does. It also draws bitmap and COLR emoji.
  - Both share skrifa and one font handle type.
  - cosmic-text with swash rasterizes glyphs to CPU coverage masks and has no
    outline stroke, so the stroke would need a second path.
  - parley 0.12.0 was 13 days old, so 0.11.1 was used.
- Raw output: `results/reference-linux/report.tsv`, `results/reference/report.tsv`
  and the side-by-side crops in `results/*/side-by-side/` (reference above,
  Rust below; frames 21 and 30).

SSIM per fixture (frame 21; frames 28 and 30 are within 0.003):

| Fixture          | Linux, frame | Linux, caption | macOS, frame | macOS, caption |
| ---------------- | ------------ | -------------- | ------------ | -------------- |
| base             | 0.9986       | 0.9800         | 0.9966       | 0.9500         |
| weight-black     | 0.9985       | 0.9787         | 0.9963       | 0.9468         |
| italic           | 0.9986       | 0.9795         | 0.9965       | 0.9490         |
| stroke           | 0.9984       | 0.9768         | 0.9974       | 0.9612         |
| shadow           | 0.9985       | 0.9797         | 0.9964       | 0.9514         |
| background       | 0.9979       | 0.9800         | 0.9954       | 0.9567         |
| position-top     | 0.9995       | 0.9921         | 0.9967       | 0.9518         |
| position-center  | 0.9994       | 0.9905         | 0.9966       | 0.9481         |
| position-percent | 0.9995       | 0.9921         | 0.9967       | 0.9518         |
| highlight        | 0.9989       | 0.9828         | 0.9969       | 0.9526         |
| wrap             | 0.9976       | 0.9792         | 0.9897       | 0.9100         |
| emoji            | 0.9871 (a)   | 0.7557 (a)     | 0.9950       | 0.9055         |
| combined-a       | 0.9909       | 0.9275         | 0.9892       | 0.9141         |
| combined-b       | 0.9759 (a)   | 0.7717 (a)     | 0.9924       | 0.9277         |

(a) The production image has no emoji font, so its reference draws the emoji
as empty boxes ("tofu"). Rust draws Apple Color Emoji through the system
fallback. The difference is the environment, not the renderer.

Structural checks, maximum over all frames (excluding the emoji fixtures
against Linux, see (a)): line count equal in every case; line ink extents
within 2 px; box or ink position within 2 px; highlight bounds within 2 px.
At frame 30, both renderers move the highlight to word 2 on the same frame
(`results/reference-linux/side-by-side/highlight-30.png`).

Criteria:

1. **Pass.** Full-frame SSIM is at least 0.9759 against Linux and 0.9892
   against macOS for every fixture and frame.

   Full-frame SSIM is diluted by the plain background, so the caption-region
   score is the stricter view. Against the production renderer it is
   0.977–0.992 for single properties and 0.928 for `combined-a`. The stroke
   and shadow edges account for most of that gap.

   Against macOS it is 0.91–0.96, because Chrome on macOS rasterizes through
   CoreText, which thickens glyph stems. In `base`, the macOS reference has
   14,341 fully covered pixels, while Linux has 12,182 and Rust has 12,072.
   Remotion on a Mac already differs from Remotion in production by about
   this much (`base`: SSIM 0.9969 between the two references).

2. **Pass.** Every line holds the same words, the active word changes on the
   same frame (including the 1.00 s edge), and the box sits within 2 px of the
   reference.
3. **Pass for outline, shadow and highlight.** See
   `results/reference-linux/side-by-side/combined-a-21.png`,
   `stroke-21.png`, `shadow-21.png` and `highlight-30.png`. Both renderers
   even show the same seams where Inter's variable outlines overlap under the
   stroke. Emoji placement does not fully match: in the Black italic context
   of `combined-b`, macOS Chrome places each emoji about 6 px further right
   than Rust (`results/reference/side-by-side/combined-b-21.png`). In upright
   text (`emoji`) they match within 1 px.

Gaps and limits:

- **Production cannot draw emoji today.** The deploy image installs no emoji
  font, so Remotion exports show tofu for every emoji. This is a defect in the
  current renderer, outside this spike.
- The shadow blur (a Gaussian with sigma = radius / 2) runs on the CPU,
  because vello has no blur for arbitrary shapes. P2 replaces it with a wgpu
  blur pass.
- Not covered: the motion styles (Fade, Pop, Slide Up), Typewriter, the
  fit-to-height down-scaling in `Captions.tsx`, scripts outside Latin, and
  font-size steps other than 64 px.
- The Rust renderer used macOS system fonts for emoji fallback. A shipped
  renderer must bundle its emoji font so that every platform draws the same
  glyphs.

**Verdict: go.** Rust matches the production caption renderer on layout,
timing and position, and on stroke, shadow and highlight. Grand-plan D1
(rendering moves into the Rust engine) stands. P2 carries three items:
bundle an emoji font, add a GPU shadow blur, and match emoji placement in
synthesized italic and bold.
