# Rust renderer

`crates/renderer` (`maleo-renderer`) draws one video frame from the render
storyboard, the same value `buildRenderStoryboardFromDoc` builds for the
Remotion compositions (ADR 0009). Remotion is still the only preview and export
renderer; this crate is measured against it until it can take over.

## Flow

```text
storyboard JSON ──storyboard.rs──> Storyboard (drawn fields decoded, the rest raw)
       │
       ├──timeline.rs──> elements visible at the frame, back to front
       │                 (Sequence bounds, base reel modes, z-index order)
       ├──coverage.rs──> what the frame shows that the renderer does not draw
       └──frame.rs─────> scene/background, scene/image, scene/text, scene/caption
                           │  parley layout on bundled fonts (fonts.rs)
                           │  shadows: offscreen silhouette + blur.rs (wgpu)
                           │  layout/text sampling: editor-core keyframes.rs
                           └──vello Scene──gpu.rs──> wgpu texture ──> RGBA or canvas
```

## Modules

| Path                       | Role                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| `src/storyboard.rs`        | Decode the render storyboard; zod top-level defaults, raw `rest` maps  |
| `src/timeline.rs`          | Frame time, `Sequence` spans, scene placement, visible-element walk    |
| `src/coverage.rs`          | Declared support table (`SUPPORTED`) and the per-frame coverage report |
| `src/paint.rs`             | CSS colors, linear and radial gradients                                |
| `src/fonts.rs`             | Inter v20 and Noto Color Emoji from `fonts/`, no system fonts          |
| `src/media.rs`             | Host-supplied images by URL; the missing-media placeholder             |
| `src/scene/*.rs`           | One module per layer, ported from the composition source               |
| `src/correction.rs`        | GPU brightness, contrast and saturation on straight sRGB channels      |
| `src/blur.rs`              | Shadow alpha blur and full-color content blur, each in two GPU passes  |
| `src/scene/text_motion.rs` | Shared primitive/container box, style and animation sampling           |
| `src/scene/shape.rs`       | Five shapes, shared-source geometry fixtures and physical strokes      |
| `src/scene/composition.rs` | Versioned packed layers, span timing, stacking and primitive dispatch  |
| `src/scene/mask.rs`        | Physical rectangle/ellipse geometry, inversion and SVG filter region   |
| `src/scene/transition.rs`  | Placement-specific transitions, projection, clip paths and nesting     |
| `src/scene/reveal.rs`      | Reveal timing, directions, dark/color phase layers and local textures  |
| `src/scene/effect.rs`      | Absolute-time envelopes, solid plates and base-only transforms         |
| `src/scene/decoration.rs`  | Spring labels, vignette, fixed grain tile, chapters and progress       |
| `src/scene/camera.rs`      | Preset/custom normalized camera paths and deterministic glitch offsets |
| `src/gpu.rs`               | Device, vello renderer, offscreen target, readback                     |
| `src/frame.rs`             | `Renderer`: compose, draw, read back, release shadow textures          |
| `corpus/`, `tests/golden/` | Golden frames from Remotion and the SSIM parity gate                   |

## Animation and GPU ownership

Image layout and plain-text animation reuse the host-free evaluators in
`crates/editor-core/src/keyframes.rs`. Ordinary tracks use clip-local seconds,
with entering-key easing, endpoint holds and retained subranges. Legacy text
`anim` uses normalized clip progress. Modern `layout.animation` takes precedence.
Plain-text body/accent colors remain inert where the reference does not use them.
Packed compositions use sampled outer foreground/accent colors as their palette.
Version 1 and compatible unversioned bundles retain saved spans and relative
starts. Inner `anim` stays normalized; inner local keys stretch with the saved
span, while outer keys use clip-local seconds. Stable track sorting preserves
input order for ties. Layers reuse the standalone primitive painters inside the
sampled outer box. Invalid bundles fail decoding with their path; unsupported
layer options/fonts remain in input-derived coverage at the layer path.

`scene/image.rs` applies sampled outer position, scale, rotation and opacity.
Crop and flips remain source-local. `scene/text_motion.rs` resolves text box,
style and content transforms. Content blur preserves premultiplied alpha between
passes, then returns straight-alpha pixels to Vello. `Renderer` owns GPU blur and color-correction
pipelines and rebuilds them through `replace_gpu`. Per-frame registered textures
are released after drawing. Invalid content-target bounds fail the frame.

Image correction renders fitted/cropped/flipped camera content into a bounded
local target before sampled outer layout. The compute pass applies brightness,
contrast and saturation in CSS order, clamping each result and preserving alpha.
Vello boundaries use straight sRGB RGBA8; transparent output clears hidden RGB.
Neutral correction bypasses the offscreen pass. Text compositing stays in coverage.

Local rectangle/ellipse masks use physical box dimensions and even-odd inversion.
Explicit null removes an inherited mask. Feathered masks retain the rotated SVG
filter region and source white/black luminance order. Broad masks use Skia's
specified three-box approximation, with reduced targets retaining sixteen samples
per sigma; small masks retain full resolution. Text blur keeps its existing
Gaussian path. `Canvas` puts normal/multiply/screen blends outside local layout
and treatments; each scene isolates its backdrop before its visual blends.

`scene/reveal.rs` samples Auto/Manual duration, delay and cubic-out progression
in clip-local frames. Direct fade/wipe/spotlight/sketch, both diagonal paths,
dark-pixels-first and black-then-color preserve source phase/color-build order.
The dark SVG matrix retains alpha replacement semantics. Paper/dust use local
physical mask pixels; ink/glitch retain ordered contrast and drop shadows.
Clips transform with their reveal layers inside opacity groups. Prepared filtered
scenes append directly, avoiding an extra neutral GPU copy. Video media remains
unsupported even when its reveal is supported.

Patch-free offscreen scenes keep a transparent image anchor outside the canvas.
This avoids Vello 0.11's solid-only resolver shrinking its GPU atlas while cached
placements remain. An image/solid/image regression and mask/inverse alpha test
cover the ownership fix. The anchor belongs to `Gpu` and rebuilds with the device.

`scene/camera.rs` resolves every existing preset and UI alias. Missing/unknown
movement uses Ken Burns; custom paths override preset paths. Camera progress
stays normalized to its motion span, while x/y offsets stay pixels and the focal
point sets transform origin. Glitch aliases add frame-derived offsets even with
custom motion. The image's intrinsic cover-fit box clips before camera transforms;
the camera wrapper clips again afterward. Scene visuals use their local frame
and hold-adjusted motion span; timeline visuals use their own clip span.

Root Cargo.toml patches `vello_shaders` to `vendor/vello_shaders` 0.11.0. Its
medium-quality image sampler computes bilinear fractions before atlas offsets,
so registering identical scaled textures does not change their output. The
analytic-area branch visits segments in geometry order, avoiding scheduling-
dependent floating-point sums. GPU preprocessing remains enabled. The
vendor directory retains upstream licenses and source/patch provenance. Both
Rust Docker stages copy it. Native and browser builds use the same correction.
Source images opt into raw quality value 3 through a checked, pinned encoding
adapter: four-bit bilinear weights and premultiplied-byte truncation match the
production CPU image sampler. GPU treatment textures retain standard filtering.

`corpus/manifest.json` names each supported option's case and required frames.
Each case annotates its exercised options. The checker rejects missing cases,
annotations or frames. Random-access tests compare exact bytes independently
of the production-reference SSIM and region-edge checks. Unsupported media,
templates and unbundled fonts remain in coverage.

## Hosts

- Native: the test harness (`cargo test -p maleo-renderer`), on Metal locally
  and on lavapipe (`WGPU_BACKEND=vulkan`) in CI.
- Browser: `crates/renderer-wasm` (`maleo-renderer-wasm`) composes the crate
  with the preview session (`crates/preview`) and exports the session through
  `wasm-bindgen` (ADR 0011). `scripts/build-renderer-wasm.ts` writes the module
  and the preview worker (`apps/web/src/preview-worker/worker.ts`) to
  `target/renderer-wasm/`; the web serves both at `/renderer/`
  (`apps/web/src/app/renderer-routes.ts`) and starts the worker only in
  compare mode (`?renderer=compare`, `hooks/timeline/use-rust-compare.ts`).

## Preview session

`crates/preview` (`maleo-preview`) is host-free: no GPU, renderer or IO. It
holds the storyboard, the playback clock (the host supplies the time), the
frame scheduler (one draw in flight, the latest due frame wins, passed-over
frames count as dropped) and the preview states (`loading`, `ready`,
`playing`, `paused`, `device-lost`, `failed`). It decides which frame to draw;
the host draws it with `Renderer::draw`. On device loss the host requests a new
device and calls `Renderer::replace_gpu`, which keeps fonts and the supplied
images. The `Decoder` and `AudioOutput` traits are defined for the media
change to implement.

On the web the session runs in a dedicated worker that owns the transferred
canvas and fetches and decodes images; the main thread sends the protocol in
`apps/web/src/models/timeline/preview-protocol.ts` through
`preview-client.ts`.

Photographic `reveal-color-builds` retains full-frame and region SSIM. Its approved
geometry companion, `reveal-phase-geometry`, measures the same boxes/timing with
high-contrast pixels at the unchanged two-pixel edge limit. Corpus checks require
a reason, matching dimensions, every sampled frame and nondelegated regions.

Sequential scene cut/fade/slide/zoom presentations use frame/duration progress.
Remotion fade keeps its outgoing plate opaque; zoom fades both plates. Exit
wraps entrance when both windows overlap. One-frame cuts retain the existing
series placement rule. Absolute scenes retain separate entrance/exit and gap-hold rules. Inner scene
visuals use their source branch, including inert flip/clock entrances. Timeline
clips and overlays use absolute styles with exits spanning their complete hold. Series wipe/clock-wipe use clip paths, flip uses bounded
inverse projection, and pixel uses a raster grid plus inherited nearest sampling.
Pixel groups and solid effect plates opt into byte-opacity composition through checked raw mix value 16;
ordinary groups retain their existing arithmetic. Projection reuses the rebuilt
correction pipeline. Pixel wrappers retain sampling at clamped endpoint progress.

Effect envelopes use absolute seconds and clamped intensity. Black/white plates
combine maxima at z60/61. Zoom factors multiply and whip offsets add. The base
subtree alone moves; captions, pacing and overlay rows remain fixed.

Scene labels reuse bundled-font layout, fixed spring configurations and source
bottom padding/gaps. Their gradient exists only with a visible label. CSS gradient
endpoint holds are explicit before Vello normalizes its stops. Vignette precedes
grain; labels follow both. Grain reads a constant production-rasterized 200px
SVG tile from `assets/grain.rgba`, with draw-time overlay blending and opacity.
Its generator/provenance lives beside the asset; no general SVG interpreter runs.

Chapter spans follow nominal consecutive scene runs, including unassigned runs.
Pills suppress fewer than two spans and disappear in chapter gaps. Progress uses
composition duration including trailing overlays. The browser host passes its
existing session fps and duration into `Renderer::draw`; native timed rendering
uses that same path. No new storyboard representation or worker protocol exists.

The vendored coarse/fine path keeps sixteen clip/blend levels inline. This
avoids the fixed 4096-tile spill buffer that cleared complex full-frame scenes.
`Gpu::draw` refuses deeper scenes explicitly. Shader/CPU constants and the Rust
guard are checked together. Hardware measurements include register-pressure
cost; no extra local mask raster copy is used as a workaround.

Composition goldens retain original SSIM limits. The normalized text cases use
`composition-geometry` at matching dimensions/frames for the unchanged two-pixel
geometry gate: faint shadow tails differ by one or two bytes at the ink cutoff,
while glyph bounds differ by one pixel. The companion adds an opaque padded text
background; shape geometry, motion and outer timing stay identical.
