# Proposal

## Why

Production export still runs Remotion in headless Chromium. The browser offers only a simplified canvas draft that omits transitions, effects and caption styling. The Rust renderer now draws every retained feature at golden-frame parity and plays decoded media, but no export path uses it. This change completes roadmap milestones 6.1–6.4 of `platform-grandplan`. Export moves to Rust before preview cutover (D17), with a measured comparison and a rollback.

## What Changes

- Add browser export through the Rust renderer. The renderer-wasm session draws each output frame after its media is ready. Rust mixes the audio. MediaBunny 1.45.0 (installed) encodes and muxes an H.264/AAC MP4 through WebCodecs.
- Replace the simplified canvas draft export (`apps/web/src/models/render/export.ts`). A project whose coverage report is not empty for every frame, or a browser without WebGPU, gets no browser export. The editor offers server export instead. **BREAKING** for users who used the draft export on uncovered projects or without WebGPU.
- Add a native render host: a Rust binary that renders the prepared render storyboard on a software Vulkan device (lavapipe). It decodes and encodes through a pinned LGPL FFmpeg build that uses OpenH264 for H.264. The render worker runs it as a subprocess through the existing job queue, phases, progress, cancellation and failure states.
- Extend export preflight to read the asset manifest for both export paths:
  - Browser export fetches each used `ready` asset and checks it against the manifest hash.
  - A fetch failure offers server export.
  - A `pending` or `failed` asset refuses export and names the file. Browser export no longer renders a pending file from the browser's copy.
- Add production dual runs. Remotion stays authoritative. For each production job with empty coverage, the worker runs a shadow Rust render when the queue is idle. The worker compares the two outputs against recorded criteria and stores the result.
- Add a renderer authority switch (`MALEO_EXPORT_RENDERER=remotion|rust`, default `remotion`). The switch to `rust` is allowed after at least 14 days and at least 50 compared jobs with zero unexplained divergence. Jobs with non-empty coverage always render on Remotion. Rollback is the same setting. The Remotion path stays installed until P6.

Non-goals: preview cutover (milestones 7.x), removal of Remotion, Chromium or Lambda (P6), Lambda for the Rust host, hardware GPU or hardware encoders on the server, desktop or mobile export, local-first media storage (P3), and new render features.

## Capabilities

### New Capabilities

- `export-rendering`: browser and server export through the Rust renderer, coverage eligibility, the native render host contract, job progress and cancellation, renderer recording and the authority switch with rollback.

### Modified Capabilities

- `asset-manifest`: export preflight serves browser export as well as server export. It verifies downloaded bytes against the manifest hash, offers server export on a download failure and refuses unavailable assets.
- `renderer-parity`: production dual runs, output comparison criteria, divergence records and the observation window that gates the authority switch.
- `render-option-parity`: the simplified draft export leaves. Browser export becomes production-equivalent and is offered only for covered projects.
- `project-media-library`: browser export treats a pending asset as unavailable, as production export does. The draft exception for the browser's copy leaves.
- `media-url-resolution`: the browser export scenario replaces the draft export scenario for reads after URL expiry.

## Impact

- `crates/renderer-wasm`: an export mode that steps frames deterministically, waits for media, reads back pixels and returns mixed PCM blocks. Normal editor loads still do not fetch the renderer module.
- New crate `crates/render-host` (binary `maleo-render`): headless wgpu device, FFmpeg subprocess decode and encode, JSON-lines progress and signal cancellation. It reuses `maleo-renderer`, `maleo-media` and `audio_requests::project`.
- `apps/web`: export menu, the browser export pipeline over MediaBunny, preflight, and the server-export offer. `export.ts` and its draft request builder are deleted.
- `apps/render-worker`: a `rust` renderer path, shadow jobs, a comparison table and the authority setting. `apps/api`: preflight reads for browser export and a renderer field on job status.
- `Dockerfile` and `deploy/`: a Rust stage for `maleo-render`, Mesa lavapipe and the pinned LGPL FFmpeg with OpenH264 in the render-worker image. Third-party notices are updated.
- Docs: `apps/render-worker/AGENTS.md`, `docs/self-hosting.md`, `docs/development.md`, the renderer codemap and `CHANGELOG.md`.
