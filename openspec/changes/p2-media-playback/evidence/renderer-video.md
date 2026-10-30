# Task 3.4 typed renderer media supply

This records the initial task 3.4 run. Task 3.5 refines frame identities to retain
original presentation timestamps beside production selection windows. Refreshed
browser placement/cleanup proof and production parity are in `video-parity.md`.

Rust projects visible image/video requests from the same placement and transition
walk used by drawing. Source in-points round at composition fps. Rate and selected
endpoint holds follow SourceVideo. Overlays retain direct-OffthreadVideo timing.
Unresolved reverse sources keep blockers. Native and browser tests verify scene,
visual-timeline and overlay placement, transition holds and independent source
positions in overlapping instances.

Renderer cache IDs own one CPU RGBA buffer each. Image/video placement bindings
share those bytes. Eviction removes all associated bindings. Video lookup needs
its exact placement, URL and covering half-open presentation interval. An image
at the same URL cannot satisfy video. Missing intervals draw placeholders and
retain their exact coverage paths. Crop, masks, color, blend, reveal and layout
still use the existing compositing pipeline.

The production compare hook leases validated local Files. Its worker owns one
native visual pool and child video adapters. Main-thread code routes physical
codec grants through the shared editor-WASM broker. RGBA stays in workers.
Images share the visual-byte budget and have two native decode jobs, preventing
unbounded bitmap allocation before dimensions are known. Temporary-copy bytes
are reserved before RGBA allocation. Upload happens while that reservation is
held; JS ArrayBuffers detach before completion converts it to cached bytes.
Opaque codec/bitmap surfaces need separate process-memory measurement.

Source removal, project changes and sign-out deny new borrowers immediately,
then wait for decoder/worker acknowledgements before cancelling stored bytes.
Same-source reloads wait for preceding cleanup. The video worker script becomes
a session-owned blob, so later adapter creation and cache refill work offline.
Normal preview still imports no renderer module.

Chromium 151.0.7922.34 proof on 2026-10-28:

- Real renderer WASM, editor WASM, production source session, compare bridge,
  renderer worker and child codecs produced expected numbered pixels for scene,
  visual-timeline and simultaneous overlay placements. Two positions of one File
  produced IDs 1 and 18. Transition frames retained outgoing ID 5 and entering
  ID 13 with their respective opacity. An unavailable frame retained
  `videoOverlays[0]` missing-media coverage.
- After blocking all network, scene/timeline changes, 100 rapid seeks, decoded
  cache clearing/refill and image rendering still worked. Exactly two initial
  source downloads occurred. Native visual peak: 368640 bytes; peak video jobs:
  two. Disposal left zero cached/reserved bytes, jobs and queued requests. Both
  physical video slots could be reacquired together afterward.
- Production editor with compare enabled loaded a video, then accepted keyboard
  Playhead seeking after network blocking. Reference and Rust canvases displayed
  the changed frame. Screenshot inspected directly; pane geometry remains intact.
- Browser media run: three passed including warmup and both probes. Existing
  compare compatibility run: four passed, including no-renderer startup,
  unavailable WebGPU and saved text/shape composition seeking.
- Focused web run: 16 files, 61 tests passed. Renderer unit suite: 105 passed.
  Portable media suite: 22 passed. Native clippy passed with warnings denied.
- Renderer WASM build passed: 14952528 raw bytes and 11702536 gzip bytes.
  Editor WASM boundary/budget suite passed all five tests with unchanged caps.
- Full 12-workspace typecheck, static checks, layer checks and deploy gate passed.

The existing 167-case, 1163-frame golden corpus passed all 29 tests in
1147.74 seconds before cache-ID and browser integration additions. Later native
unit tests verify those additions. This is regression evidence for existing
reference cases, not production video parity. Video support warnings remain
until task 3.5 adds and accepts its production-reference cases. Full CI, 1080p
performance, audio output and physical iPhone acceptance remain open.

The browser probe exposed an existing progress-boundary bug: transport identity
fields reached Rust's strict progress object. Source-client callbacks and the
readiness boundary now pass only loaded/total values. The new source-client
assertion failed before that fix and passed afterward; the real browser probe
also passed without page errors.

The pinned MediaBunny patch also reaches Docker's dependency install layer.
The deploy gate passes with the patch included. No dependency version changed.
Raw measurements: `rendered-media-chromium.json`.
