# Task 3.3 local video decoding

This records the original task 3.3 run. Task 3.5 replaces containing-interval
selection and first-timestamp normalization with the user-approved production
selection policy. Current CFR/VFR, timestamp, rate and boundary proof is in
`video-parity.md` and `production-video-selection.json`.

The production source client validates complete Files and retains primary video
dimensions, first presentation timestamp and required physical decoder slots.
The video adapter creates its worker after the native grant. One sequential
iterator retains current/next samples. Backward seeks and generation changes
reset it. Requests and completions carry source revision, consumer, generation
and sequence. The native pool rejects obsolete completions independently.

Chromium 151.0.7922.34 browser proof uses both actual WASM modules and production
source/video clients and workers. Five complete sources load once. All subsequent
source requests are blocked, including after native decoded-cache eviction.
CFR H.264/AAC, VFR H.264, nonzero-PTS H.264, opaque VP9 and transparent VP9 return
the expected numbered frames and half-open presentation intervals. Two placements
of one File return independent frame IDs 1 and 18.

The 100 random seeks measured p50 1.60 ms, p95 2.10 ms and maximum 23.70 ms.
These small 160×96 fixtures do not establish 1080p acceptance. One hundred queued
native generation changes retain one latest request. Old completion is rejected;
generation 100 returns the expected frame. Client unit tests also drive 100 rapid
requests and delayed replies. Peak native cached plus reserved bytes: 552960.
Every pool returns zero cached/reserved bytes, jobs and queued requests.
Worker instrumentation reports zero live codecs and tracked samples on disposal.
Transparent video reaches two physical video decoders; opaque video reaches one.

The transparent fixture exposed a MediaBunny 1.45.0 CPU alpha-merger defect:
`copyTo` copies visible pixels, while the merger used padded coded dimensions.
This shifted numbered cells and changed colors. The checked dependency patch
uses visible dimensions and preserves color space in source, ESM and CJS entry
points. The same browser probe failed before the patch and passed afterward.
`bun install --frozen-lockfile --ignore-scripts` passes with the patch installed.
No dependency version changed.

Verification on 2026-10-28:

- Chromium browser run: five passed, including warmup, codec matrix, native pool,
  four-worker physical codec slots and sequential/random-access decoding.
- WebKit 26.5 codec matrix: two passed including warmup. H.264/AAC, WAV and
  images pass. VP9 remains a named unsupported-codec failure on this host.
  Required audio in an FFV1/AAC container passes without decoding unrelated video.
- Focused web tests: 11 files, 39 tests passed.
- Native media/editor/WASM clippy passed with warnings denied.
- Warm editor WASM boundary/budget suite: two files, five tests passed.
- Full workspace typecheck: 12 workspaces passed.

Raw measurements: `video-decode-chromium.json` and both codec-matrix JSON files.
The browser test blocks source routes, not worker assets. Global offline compare,
renderer frame supply, 1080p performance and physical iPhone checks remain open.

Commands:

```sh
bun run --cwd apps/web playwright test --project=visual preview-video-decode.spec.ts preview-codecs.spec.ts preview-media-pool.spec.ts --workers=1
MEDIA_CODEC_BROWSER=webkit bun run --cwd apps/web playwright test --project=visual preview-codecs.spec.ts --workers=1
bun run --cwd apps/web test src/services/preview-media src/models/timeline/preview-local-sources.test.ts src/hooks/timeline/use-preview-composition.test.tsx src/hooks/auth/use-sign-out.test.tsx
cargo clippy -p maleo-media -p maleo-editor-core -p maleo-editor-wasm --all-targets -- -D warnings
bun scripts/editor-engine.mts build
bunx vp test run --project scripts scripts/editor-engine.test.ts scripts/media-readiness.test.ts
bun run typecheck
```

Worker startup failure regression: the new test first timed out with an unhandled
SecurityError. The adapter now rejects pending requests and returns native grants
if worker creation or message transfer throws. The regression passes and verifies
both video slots can be reused before the failed client is disposed. The real
video decode browser probe passed again after this fix.
