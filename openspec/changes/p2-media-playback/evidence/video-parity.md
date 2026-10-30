# Task 3.5 production video parity

## Approved resolution and refreshed proof

The user approved matching production source-frame selection. D5, the media
spec, and task 3.5 now require that policy. Export behavior and thresholds are
unchanged. The results below under Initial result record the investigation.

Pinned upstream source:
`https://github.com/remotion-dev/remotion/blob/v4.0.462/packages/compositor/rust/frame_cache.rs#L197`
selects nearest PTS and favors the later decoded frame on equal distance.
`opened_stream.rs::calc_position` truncates requested stream ticks. The worker
uses the actual track time resolution. It keeps original sample timestamps in
`identity.presentation` and uses `start`/`end` for cache selection windows.
Video supply/binding rejects missing or invalid presentation intervals.

`production-video-selection.json` records 48 actual production-image frame-ID
observations: CFR/VFR, exact and adjacent ties, rates 0.25/0.5/1/2/4, in-points,
nonzero PTS and the final source frame. The real Chromium decoder matched all
48 IDs, then passed sequential/cache-eviction, 100 random seeks and 100 queued
generation changes without source network reads. Original timestamps are not
normalized: production holds frame zero before this fixture's first PTS at
5 seconds. That existing export behavior is preserved, not repaired here.

All **67 frames in nine video cases passed** production parity: whole-frame
SSIM >= 0.98 and region SSIM >= 0.92. Current supported frames have empty
coverage. Direct and sequential video draws match byte-for-byte. The existing
animated-element reverse-order test, now including video, also passed.
Corpus completeness passed, including source hashes and sample continuity.

Two original transparent cases retain every SSIM check and use opaque geometry
companions under the renderer's existing approved corpus policy. The companions
keep identical video, timing, layout, masks, blending and animation. Both pass
the original two-pixel geometry check. No comparator or threshold changed.
At an original overlap edge, production RGBA `[0,0,10,26]` versus Rust
`[0,0,0,2]` changes visible blue by one byte but shifts the raw straight-RGB
ink extent by 27 pixels. At a mask edge, alpha 2 versus 1 similarly destabilizes
straight-RGB ink. Opaque companions measure placement without that ambiguity.
Original and companion reference images were inspected visually.

Refreshed checks: 106 renderer unit tests, 22 portable media tests, four focused
web files / 18 tests, decoder browser probe (2 including warmup), and rendered
media/editor offline probe (3 including warmup) passed. Renderer WASM build
passed: 14,956,688 raw / 11,704,390 gzip bytes. Full root CI and physical-device
acceptance remain group 7 work.

Run on 2026-10-28 after the user authorized Docker Desktop restart.
Build recovery is recorded in `video-parity-blocker.md`.

Production image:
`sha256:a83ea6dea45681c80a287330411b13b743f25d0a3788d85fa46497e875f5e762`.
Remotion 4.0.462. The production emoji font hash matched the corpus pin:
`e5899ed38b8ed83e08bd3ac5de09791e9d19d288333a796de1d35ad17396f1ec`.

## Fixture and host checks

`bun crates/renderer/tests/fixtures/build-video.ts` writes seven synthetic
video cases under ignored data. It validates the storyboard, all 24 decoded
binary frame IDs, and integer presentation timestamps against the stream time
base. A repeat run produced the same movie and 24 PNG sample hashes.
`video-parity-fixtures.json` records generation commands and source revision.

Production Remotion rendered 54 candidate PNGs from the encoded H.264 source.
The native test host supplies decoded samples by requested placement and
half-open source interval. Source SHA-256, sample continuity, and file existence
checks protect the host input. New direct/sequential and reverse-order tests
retain existing parity requirements. The absent-corpus test first failed with
`video corpus is required`, as intended.

## Initial result

`cargo test -p maleo-renderer --lib`: **105 passed**.
`cargo test -p maleo-renderer --test golden video_frames_match_production -- --exact --nocapture`:
**failed**, 16 of 54 candidate frames, 69.49 seconds.

```text
video-overlap-motion 0: box edge 5 px
video-overlap-motion 5: box edge 3 px
video-overlap-motion 12: SSIM 0.9632; box edge 19 px
video-overlap-motion 24: SSIM 0.9132; box edge 6 px
video-overlap-motion 36: box edge 27 px
video-overlay-mask-color 0,5: box edge 4 px
video-overlay-mask-color 12,24,36,45: box edge 3 px
video-reveal 24,47: SSIM 0.9713
video-scene-transition 19: SSIM 0.8898
video-timeline-transition 34: SSIM 0.9673
video-timeline-transition 51: SSIM 0.9439
```

Thresholds remain 0.98 whole-frame SSIM, 0.92 region SSIM, and two pixels for
geometry. Existing reference PNGs were not changed. Candidate video references
are new. Mask/color and overlap reference images were visually inspected beside
Rust diagnostic frames. Diagnostics remain under ignored `target/golden`.

## Initial frame-selection decision

The candidate `video-timeline-transition` contains a 12 fps numbered source in
a 30 fps composition. At composition frames 34 and 51, reading the eight binary
cells from production and native outputs gives:

| Composition frame | Production frame ID | Rust interval-selected frame ID |
| ----------------- | ------------------- | ------------------------------- |
| 34                | 11                  | 10                              |
| 51                | 18                  | 17                              |

The design's D5 requires selection by sample presentation intervals. The new
golden host follows that rule. Production extraction selects a different source
sample at these positions. The observed IDs establish the conflict, but do not
establish the full production selection algorithm for CFR, VFR, or ties.

The initial requested decision was to revise D5 and associated parity evidence to match
production source-frame selection while preserving export behavior and all
existing thresholds. The alternative is to retain current interval selection
and explicitly revise parity requirements. Neither change was accepted or
implemented automatically. The user subsequently approved production alignment;
the resolution and refreshed checks are recorded above.

The apply skill required a pause at that point. No later task started during
the pause. Work resumed after the user's explicit approval.

## Final contributor verification

After formatting the generated case JSON, `bun run check` passed: version and
reference gates, formatting, lint/type checks, and all 12 workspace typechecks.
`openspec validate p2-media-playback --strict` and `git diff --check` passed.
The production reference container exited and was removed. No container remains
running. Final contributor gate also passed after the source policy, companion
and documentation updates. Clippy passed with warnings denied. The quiet editor
WASM/readiness gate passed five tests; editor WASM remains 716,620 raw bytes.
Full-corpus SSIM rerun, full CI and physical-device acceptance remain group 7
work. Focused video SSIM, sequential/reverse and refreshed browser checks passed.
