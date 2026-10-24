# Design

## Context

- Preview: `apps/web` plays `StoryboardReel` through `@remotion/player`
  (`remotion-preview.tsx`). `use-preview-composition.ts` builds the props with
  `buildRenderStoryboardFromDoc` from `@maleo/shared`. The comment there
  states that export renders the same object.
- Export: `apps/render-worker` renders the `Storyboard`, `StoryboardWide` and
  `StoryboardSquare` compositions with `renderMedia`, locally or on Lambda.
  The production image is the root `Dockerfile` (Chrome Headless Shell,
  `fonts-liberation`, no emoji font).
- Fonts: `packages/video/src/fonts.ts` loads Inter weights 300 to 900, normal
  and italic, latin and latin-ext. No other family is used.
- Spike C (`spikes/rust-captions/`) drew 14 caption fixtures with parley
  0.11.1 and vello 0.11.0 on wgpu 30.0.1 and matched Remotion (full-frame SSIM
  at least 0.9909 without emoji). It holds the fixture format, the SSIM code
  (11x11 Gaussian window, sigma 1.5, on luma) and the parley rules that copy
  the CSS of `Captions.tsx`.
- `crates/editor-wasm` is the only WASM module today. It uses no
  `wasm-bindgen`. The web serves it from `app/engine-routes.ts`. The workspace
  release profile is `opt-level = "z"`, `panic = "abort"`, `strip = true`.
- CI is `ubuntu-latest` with no GPU. It runs `bun run ci`, which includes
  `check:rust` (fmt and clippy). The browser tests use Playwright Chromium.
- `remove-infographics` lands before this change, so the render storyboard
  has no infographic layer.

## Goals / Non-Goals

**Goals:**

- One crate that draws a frame from the render storyboard, with a coverage
  report, for native and browser hosts.
- A parity gate that fails CI when a supported feature drifts from Remotion.
- A way to see the Rust frame beside the Remotion frame on any real project.

**Non-Goals:**

- Motion, video, audio, text templates, export, production dual-run (later P2
  changes).
- Preview at playback rate in the browser. This change measures frame time,
  it does not set a budget.
- A GPU path inside gpui (P4).

## Decisions

### D1. The input is the render storyboard, not the timeline document

The renderer reads the JSON that `buildRenderStoryboardFromDoc` produces and
that `packages/video/src/schema.ts` validates. Rust types in
`crates/renderer/src/storyboard.rs` decode the fields the renderer supports.
Every other field is kept as raw JSON, so that coverage (D4) can find the
elements the renderer does not draw.

- Why: through the parity window both renderers must draw the same input.
  A second input shape would make every divergence ambiguous: renderer or
  translation.
- Rejected: read `TimelineDoc` directly. That is the long-term shape (the
  engine already owns the document), but it puts the storyboard builder logic
  into the comparison. It can move after P6.

### D2. One crate draws, two thin crates host

```text
crates/renderer          maleo-renderer       storyboard -> vello Scene -> wgpu texture -> RGBA
  src/storyboard.rs      decode the supported subset, keep the rest raw
  src/scene/*.rs         one module per layer: background, image, text, caption
  src/coverage.rs        walk visible elements, list unsupported ones
  src/fonts.rs           bundled font data (include_bytes!)
  src/media.rs           image store keyed by URL; placeholder on miss
  src/gpu.rs             device, vello renderer, offscreen target, readback
  tests/golden.rs        the parity gate (D6)
crates/renderer-wasm     maleo-renderer-wasm  wasm-bindgen exports, canvas surface (D7)
```

The public API is three calls: `put_image(url, width, height, rgba)`,
`render(storyboard_json, frame, width, height) -> (rgba, coverage_json)`, and
`render_to_surface(...)` for a canvas. Each takes and returns JSON strings or
byte buffers, as ADR 0010 requires.

The native host for this change is the test harness. It decodes PNG and JPEG
corpus media with the `image` crate. The render worker becomes a native host
in the export change.

### D3. Port the spike, then port the composition

Captions start from spike C `src/render.rs`: parley with
`CHROMIUM_LINE_BREAK_OVERRIDE`, the `Captions.tsx` box and position rules,
inline-block words, a 3 px miter stroke, and the faded-word layer. The
caption shadow uses a wgpu Gaussian blur pass, because vello has no blur for
arbitrary shapes (ADR 0009). Caption motions (`Fade`, `Pop`, `Slide Up`) and
chunking come from `Captions.tsx` and the caption timing helpers, read line by
line.

Background gradients parse the CSS gradient strings the Style rail produces
(`linear-gradient(<angle>, <stops>)`, `radial-gradient(...)`). An unparsed
gradient string is a coverage entry, not a fallback color.

Image layout ports `layoutBoxStyle` and `layoutObjectFit` from
`StoryboardReel.tsx` and `VisualMediaFrame.tsx`. Plain text overlays port the
`preset === "plain"` branch only. Every other text preset is a coverage entry.

The spike directory is deleted when its fixtures and code have moved (the
spikes README rule).

### D4. Coverage is computed from the input, not from what drew

`coverage.rs` walks every element visible at the frame time (scenes, overlays,
text overlays, caption cues, effects, transitions, audio is excluded because
it does not draw) and lists each one whose kind or option the renderer does
not support. It decides support from the decoded fields: for example, a text
overlay with a non-empty animation value, a scene visual with camera motion,
or any `effects` entry.

- Why: an element that was skipped by mistake still shows in the report,
  because the report does not depend on the drawing code.
- The kinds and options the renderer supports are one declared table in
  `coverage.rs`. The corpus check (D6) reads it to require a case per kind.

### D5. Bundled fonts

`crates/renderer/fonts/` holds Inter v20 (the same files spike C fetched:
normal and italic, latin and latin-ext) and Noto Color Emoji (COLRv1). Both
are SIL OFL 1.1. The license files sit beside them and in
`third-party-release-compliance` notices. parley gets a font collection built
only from these bytes, with system font loading turned off.

The production image installs `fonts-noto-color-emoji` from Debian, and the
corpus pins the same font version in `corpus/manifest.json`. If the Debian
version differs from the bundled file, the bundled file follows Debian, so
both renderers draw the same glyphs.

### D6. The parity gate

Corpus layout:

```text
crates/renderer/corpus/
  manifest.json        Remotion version, image digest, emoji font version,
                       thresholds, per-case reasons for any lowered threshold
  <case>/storyboard.json
  <case>/media/*       small PNG or JPEG files, referenced by relative URL
  <case>/case.json     frame indexes, element regions to score
  <case>/reference/<frame>.png
```

- References: `packages/video/scripts/render-golden.ts` renders each case and
  frame with `renderStill` of the `Storyboard` composition. It runs inside the
  production image, as spike C did, so Chrome, fonts and the emoji font match
  exports. It is not part of CI. A reference change is a reviewed commit.
- Cases for this change: the 14 spike C caption fixtures (frames 21, 28, 30),
  caption motions (one case per motion, frames inside and after the
  entrance), backgrounds (solid, linear, radial), image visuals and overlays
  (cover, contain, fill, crop, opacity), plain text overlays, and one
  combined case built from a real development project with every supported
  layer.
- Gate: `cargo test -p maleo-renderer --test golden`. Default thresholds:
  full-frame SSIM at least 0.98, region SSIM at least 0.92, each region's box
  or ink within 2 px of the reference's on every edge (spike C's structural
  check, which catches a position drift SSIM forgives), empty coverage.
  These come from spike C (caption region 0.928 to 0.992 on the production
  image). A case may record a lower threshold only with a reason.
- On failure the test writes the Rust frame and a difference image to
  `target/golden/` and CI uploads that directory.
- CI has no GPU. The job installs `mesa-vulkan-drivers` and runs wgpu on
  lavapipe (`WGPU_BACKEND=vulkan`). Frames on lavapipe and on Metal can
  differ in anti-aliasing, so the thresholds, not byte equality, decide.

### D7. The browser build uses wasm-bindgen (ADR 0011)

wgpu reaches WebGPU only through `web-sys` and `wasm-bindgen`. ADR 0010 bans
`wasm-bindgen` at the core boundary. ADR 0011 records the exception:

- `crates/renderer-wasm` uses `wasm-bindgen` to reach WebGPU and the canvas.
- Its exported functions keep the ADR 0010 convention: JSON strings and byte
  buffers in and out, no exported Rust types or classes.
- `crates/editor-wasm` is unchanged. The two modules load separately.

Build: `cargo build -p maleo-renderer-wasm --target wasm32-unknown-unknown
--release`, then `wasm-bindgen --target web` with the CLI pinned to the crate
version, through `scripts/build-renderer-wasm.ts`. The workspace release
profile stays `z` for the editor module. The renderer module gets
`[profile.release.package.maleo-renderer-wasm] opt-level = 3` only if a
measured frame time shows `z` costs more than 20 percent. The module size
(raw and gzip) is recorded, not budgeted, in this change.

- Rejected: vello_cpu in WASM without `wasm-bindgen`. It keeps ADR 0010
  intact, but it is a second rasterizer beside the vello GPU path that
  desktop needs, and the user chose the GPU path.

### D8. Compare mode in the web editor

- `?renderer=compare` sets compare mode for that page load. No setting, no
  menu item, no stored preference.
- `use-rust-compare.ts` dynamically imports the renderer module from a new
  route beside `/editor-engine.wasm`. It takes `previewStoryboard` and the
  playhead from `usePreviewComposition`, and fetches each image URL in the
  storyboard once, decodes it with `createImageBitmap`, and passes the bytes
  to `put_image`.
- `rust-compare-panel.tsx` holds a canvas beside `remotion-preview.tsx`. On a
  playhead change it schedules one render in `requestAnimationFrame` and drops
  stale requests, so a slow frame never queues. It shows the last frame time
  and p50 and p95 over the session, and the coverage list.
- No pixel comparison runs in the browser. The Player draws DOM, and reading
  its pixels is not reliable. The corpus (D6) is the measured comparison.
  Compare mode is for looking.
- When `navigator.gpu?.requestAdapter()` returns null, the panel shows the
  unavailable message and loads nothing else.

## Risks / Trade-offs

- [vello compute shaders fail or time out on lavapipe] → Task 1 proves the
  spike C fixtures on lavapipe in CI first. If it fails, the gate runs on a
  macOS runner (Metal) and the Linux job runs only the corpus check.
- [Rust and Remotion disagree on a CSS rule nobody wrote down] → Port from
  the composition source line by line, and add a corpus case for every option
  of an element kind, not one per kind.
- [The renderer WASM module is large (wgpu, vello, parley, fonts)] → It loads
  only in compare mode. Size is recorded now. The motion or export change sets
  a budget before any user path loads it.
- [Debian emoji font and bundled emoji font drift] → One version in
  `manifest.json`. The corpus check compares the bundled file hash with it.
- [Two renderers to update during the window] → Each later P2 change adds
  cases. A visual change to a Remotion composition that a corpus case covers
  fails the gate until the Rust side matches or the reference is updated in
  review.
- [Emoji in exports change for existing projects] → Exports drew empty boxes
  before. This is a fix. `CHANGELOG.md` states it.

## Migration Plan

1. Land the renderer crate, fonts and corpus with the CI gate.
2. Land the WASM build, ADR 0011 and compare mode.
3. Add the emoji font to the production image and re-render references.

Rollback: remove the `renderer=compare` route and the CI job. Nothing in the
user path depends on the renderer, so no data or behavior rolls back. The
emoji font can stay.

## Open Questions

None. The slicing of P2 and the GPU backend were decided with the user
(2026-10-23).
