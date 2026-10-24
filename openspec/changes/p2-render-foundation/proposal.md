# Proposal

## Why

ADR 0009 moves rendering into the Rust engine and retires Remotion after a
parity window. P2 of `platform-grandplan` builds that renderer and proves it
against Remotion. The P2 surface is large, so P2 ships as four changes, the
same way P1 did:

1. `p2-render-foundation` (this change): the renderer crate, the golden-frame
   parity gate, and the web build in a compare mode. Static layers and
   captions only.
2. Motion: keyframes, camera motion, reveals, scene transitions, effects and
   text templates.
3. Media: video frames through WebCodecs, and the audio mix.
4. Export: WebCodecs export in the browser and a headless core in the render
   worker, with production dual-run.

This change comes first because every later slice needs the same three
things: a crate that draws a frame from the storyboard Remotion draws, a
measured comparison with Remotion, and a way to see both renderers on one
real project. `remove-infographics` lands before it, so the infographic layer
is never ported.

## What Changes

- New crate `crates/renderer` (`maleo-renderer`). It reads the render
  storyboard JSON that the Remotion compositions receive today, and draws one
  frame at a given frame index and size. It uses parley for text layout and
  vello on wgpu for drawing (ADR 0009). It bundles its fonts: Inter v20 and
  Noto Color Emoji.
- The renderer supports these layers in this change: the background (solid
  colors and CSS gradients), image scene visuals and image overlays with their
  static layout, plain text overlays, and captions with every offered style
  and motion.
- For each frame, the renderer reports every element that it cannot draw yet
  (coverage). It never skips an element silently. A clip whose media is not
  available draws a placeholder and is reported.
- New golden-frame corpus `crates/renderer/corpus/`: storyboard cases with
  Remotion reference frames, rendered in the production image. `cargo test`
  renders each case and compares it with SSIM. CI runs it on a software
  Vulkan driver.
- New crate `crates/renderer-wasm` (`maleo-renderer-wasm`). It builds the
  renderer for the browser through `wasm-bindgen`, because wgpu reaches
  WebGPU only through it. Its exported calls keep the JSON calling convention
  of ADR 0010. A new ADR 0011 records this exception.
- The web editor gets a hidden compare mode (`?renderer=compare`). It draws
  the Rust frame beside the Remotion Player at the same frame, and shows frame
  time and coverage. The renderer module loads only in this mode. Remotion
  stays the only renderer for preview and export.
- The production image installs an emoji font, so Remotion exports draw emoji
  instead of empty boxes, and the references match what the Rust renderer
  draws.

Non-goals:

- No change to preview or export output for users, except emoji in exports.
- No motion, video, audio, text templates or export in Rust. Later P2
  changes own them.
- No production dual-run. The export change owns it.
- The legacy `Product*` compositions are not ported. A later change decides
  whether they stay.

## Capabilities

### New Capabilities

- `engine-renderer`: the Rust renderer: its input, the frame it draws, its
  bundled fonts, its coverage report, and its placeholder for missing media.
- `renderer-parity`: the golden-frame corpus, the parity gate against
  Remotion, the shared font set of both renderers, and the web compare mode.

### Modified Capabilities

None. Remotion stays authoritative, so no existing render, export or preview
requirement changes.

## Impact

- Cargo workspace: two new members, `crates/renderer` and
  `crates/renderer-wasm`. New dependencies: `wgpu`, `vello`, `parley`,
  `wasm-bindgen`, `web-sys` (renderer-wasm only), `image` (PNG and JPEG decode
  for the corpus and native hosts). The versions are those of spike C,
  re-checked at the 14-day rule.
- `apps/web`: a lazily loaded renderer module route beside
  `app/engine-routes.ts`, a compare surface beside `remotion-preview.tsx`,
  and a hook that feeds it the preview storyboard and frame.
- `packages/video`: a reference render script for the corpus.
- `Dockerfile`: a renderer WASM build stage and `fonts-noto-color-emoji` in
  the runtime image.
- CI: a software Vulkan driver (`mesa-vulkan-drivers`) and the
  `wasm-bindgen` CLI at a pinned version.
- Docs: ADR 0011, `docs/CODEMAPS/` renderer entry, `AGENTS.md` workspace map,
  `docs/development.md` (corpus and compare mode), `CHANGELOG.md`.
- `spikes/rust-captions/` is deleted. Its fixtures move into the corpus.
