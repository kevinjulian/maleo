# crates/renderer — agent instructions

`maleo-renderer` draws one frame of the render storyboard with parley and
vello on wgpu. Remotion is the authority: the Rust renderer is correct when it
draws what `packages/video/src` draws for the same storyboard. Architecture:
`docs/CODEMAPS/renderer.md`. Browser build: `crates/renderer-wasm`, ADR 0011.
The renderer draws a frame when asked; when and which frame is the preview
session's call (`crates/preview`). `crates/renderer-wasm` composes the two and
exports the session (`init`, `set_storyboard`, `seek`, `play`, `pause`,
`tick`, `resize`, `put_image`, `image_requests`, `video_requests`, `put_video`, `remove_video`,
`report_remotion`, `state`, `lose_device`),
not per-frame draws; its module comment lists them.

## Rules

- Port from the composition source line by line (`StoryboardReel.tsx`,
  `StoryboardScene.tsx`, `AnimatedVisual.tsx`, `VisualMediaFrame.tsx`,
  `CameraMotion.tsx`, `Captions.tsx`, `reel-text.tsx`), and name the source in
  the module comment. A CSS rule nobody wrote down is still a rule.
- The input is the render storyboard, never `TimelineDoc`. Decode only what
  draws or what coverage must inspect; keep the rest raw.
- Never skip an element silently. Coverage (`coverage.rs`) decides support
  from the input, not from the drawing code. Drawing support for a new kind or
  option means: add it to `SUPPORTED` or remove its problem in `coverage.rs`,
  draw it, and add a corpus case for it, in the same change.
- Text uses the bundled fonts only (`fonts/`). Do not enable parley's
  `system` feature.
- No IO: hosts decode media and pass bytes (`Renderer::put_image`, `Renderer::put_video`).
  Video supply uses placement paths and source presentation intervals; a still
  image at the same URL cannot satisfy a requested video frame. Hosts accept
  native pool generations/revisions before supply and remove evicted placements.
  Cache-backed hosts use `cache_media_frame` once per native frame ID and bind
  placements to that ID. Eviction removes the buffer and every image/video binding.
- `audio_requests::project` owns production storyboard-to-mix projection. Reuse
  the timeline's placement rules. Portable timing, volume keys, fades and ducking
  live in `maleo_media::audio`; IO and output devices remain host-owned.
  `scripts/audio-mix-fixtures.ts` derives gain and document/render references.
- Fonts and `Media` are CPU-side; GPU-owned state is rebuilt by
  `Renderer::replace_gpu` after device loss. Keep new GPU state rebuildable
  there, and never move supplied images onto the device only.
- Root Cargo.toml patches `vello_shaders` to `vendor/vello_shaders`. Its local
  bilinear correction preserves byte equality across texture allocations.
  Pixel presentations and solid full-frame effect plates use checked raw mix
  value 16 for Skia byte opacity.
  Keep ordinary blend groups on their existing arithmetic. The shader and CPU
  coarse paths share a sixteen-level inline stack; Gpu refuses deeper scenes
  before submission. Keep its depth-budget and combined-overlap regressions.
  CPU source images opt into checked raw quality value 3 for Skia four-bit
  premultiplied-byte sampling. GPU intermediates keep standard filtering.
  Keep its licenses/provenance and both Rust Docker-stage copies together.
  Replace it only with upstream code that passes the same regression gates.

## Golden corpus (D6)

```text
corpus/manifest.json        Remotion version, image, emoji font pin, thresholds,
                            lowered thresholds with their reasons,
                            supportedOptions mapping options to cases/frames
corpus/<case>/storyboard.json
corpus/<case>/case.json     width, height, frames, regions to score, options exercised
corpus/<case>/media/*       synthetic PNG/JPEG/MP4/WebM, referenced as media/<file>
corpus/<case>/frames/*      decoded video presentation samples for the native host
corpus/<case>/reference/<frame>.png
```

- `cargo test -p maleo-renderer --test golden` is the gate: full-frame SSIM at
  least `thresholds.frame`, each listed region at least `thresholds.region`
  with its box or ink within 2 px of the reference's, and an empty coverage
  report, for every case frame. It also checks the
  corpus: a reference per frame, a case per supported kind, the bundled emoji
  font matching the manifest pin.
- On failure the Rust frame and a difference image are in `target/golden/`.
  `MALEO_GOLDEN_SCORES=1 cargo test -p maleo-renderer --test golden -- --nocapture`
  prints every score.
- Lower a threshold only in `manifest.json` `lowered`, per case, with the
  reason. Never edit a reference to pass.
- Add a case per option of a kind, not one per kind. Media is synthetic: no
  project, stock or third-party media.
- Video cases declare `videoFrames` in `case.json`: source URL, SHA-256 revision,
  and contiguous half-open presentation intervals with decoded PNG paths.
  The native host supplies the requested placement and source interval before
  each draw. It never loads a movie as a still image. Corpus checks reject a
  changed source hash, missing sample, or invalid interval. Native CI needs no
  FFmpeg process. Author inputs with
  `bun crates/renderer/tests/fixtures/build-video.ts`; its default output stays
  under `data/video-parity-corpus` until production references pass review.
  Production Remotion consumes the encoded movie, not the decoded PNGs.
  Hosts retain original sample intervals in `FrameIdentity.presentation` and
  use `start`/`end` for nearest-PTS selection windows. Equal-distance ties choose
  the later frame. Source times before a nonzero first PTS select the first
  sample, matching the pinned production extractor.
- Declare each supported option in `manifest.json` `supportedOptions` with its
  case and required frames. Annotate that case's `options`. The corpus checker
  rejects missing cases, annotations or frames, and undeclared annotations.
- References come from the production image, never from a desktop browser
  (macOS Chrome draws text measurably heavier). Build the image, then render
  from `apps/render-worker`, where the image caches the browser exports use:

  ```bash
  docker build --platform linux/amd64 --target runtime -t maleo-golden:local .
  docker run --rm --platform linux/amd64 \
    -e MALEO_GOLDEN_IMAGE="$(docker image inspect maleo-golden:local --format '{{.Id}}')" \
    -v "$PWD/crates/renderer/corpus:/app/crates/renderer/corpus" \
    -v "$PWD/packages/video/scripts/render-golden.ts:/app/packages/video/scripts/render-golden.ts:ro" \
    -w /app/apps/render-worker --entrypoint bun maleo-golden:local \
    ../../packages/video/scripts/render-golden.ts [case ...]
  ```

- A reference change is a reviewed commit: show the old and new frame side by
  side in the review.
- The emoji font follows Debian. When the production image's
  `fonts-noto-color-emoji` changes, copy its `NotoColorEmoji.ttf` into
  `fonts/`, update the manifest pin, and re-render the references.

## Verification

```bash
cargo test -p maleo-renderer                 # unit tests and the golden gate
WGPU_BACKEND=vulkan cargo test -p maleo-renderer   # as CI runs it (lavapipe)
bun crates/renderer/tests/fixtures/build.ts --check   # TS-derived fixtures current
bun scripts/build-renderer-wasm.ts           # browser module
```

Local compositing uses GPU correction and mask blur before outer clip layout.
Mask geometry stays in physical pixels; explicit null removes inheritance.
The broad SVG mask kernel follows the three-box approximation used by Skia;
text blur retains its Gaussian kernel. Keep the solid-only atlas-anchor regression
when changing offscreen draws. The anchor is invisible and owned by `Gpu`.

Reveals retain source-local filters and textures before sampled outer transforms.
The approved photographic `reveal-color-builds` case keeps all SSIM checks and
names `reveal-phase-geometry` for geometry. Its high-contrast regions retain the
two-pixel limit. Corpus validation rejects missing or incomplete companions.
The approved change-wide policy also permits low-contrast cases with measured
one-to-two-byte ink instability and a recorded reason. Companions must retain
matching dimensions and frames and pass the original two-pixel geometry gate.
