# crates/renderer — agent instructions

`maleo-renderer` draws one frame of the render storyboard with parley and
vello on wgpu. Remotion is the authority: the Rust renderer is correct when it
draws what `packages/video/src` draws for the same storyboard. Architecture:
`docs/CODEMAPS/renderer.md`. Browser build: `crates/renderer-wasm`, ADR 0011.
The renderer draws a frame when asked; when and which frame is the preview
session's call (`crates/preview`). `crates/renderer-wasm` composes the two and
exports the session (`init`, `set_storyboard`, `seek`, `play`, `pause`,
`tick`, `resize`, `put_image`, `report_remotion`, `state`, `lose_device`),
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
- No IO: hosts decode media and pass bytes (`Renderer::put_image`).
- Fonts and `Media` are CPU-side; GPU-owned state is rebuilt by
  `Renderer::replace_gpu` after device loss. Keep new GPU state rebuildable
  there, and never move supplied images onto the device only.

## Golden corpus (D6)

```text
corpus/manifest.json        Remotion version, image, emoji font pin, thresholds,
                            lowered thresholds with their reasons
corpus/<case>/storyboard.json
corpus/<case>/case.json     width, height, frames, regions to score
corpus/<case>/media/*       synthetic PNG/JPEG, referenced as media/<file>
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
