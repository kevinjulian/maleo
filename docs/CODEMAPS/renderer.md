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
| `src/blur.rs`              | CSS `text-shadow` Gaussian blur as two wgpu compute passes             |
| `src/gpu.rs`               | Device, vello renderer, offscreen target, readback                     |
| `src/frame.rs`             | `Renderer`: compose, draw, read back, release shadow textures          |
| `corpus/`, `tests/golden/` | Golden frames from Remotion and the SSIM parity gate                   |

## Hosts

- Native: the test harness (`cargo test -p maleo-renderer`), on Metal locally
  and on lavapipe (`WGPU_BACKEND=vulkan`) in CI.
- Browser: `crates/renderer-wasm` (`maleo-renderer-wasm`) wraps the crate with
  `wasm-bindgen` (ADR 0011). `scripts/build-renderer-wasm.ts` writes
  `target/renderer-wasm/`; the web serves it at `/renderer/`
  (`apps/web/src/app/renderer-routes.ts`) and loads it only in compare mode
  (`?renderer=compare`, `hooks/timeline/use-rust-compare.ts`).
