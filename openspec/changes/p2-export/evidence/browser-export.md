# Browser export (group 2)

Recorded on macOS (Apple Silicon), Chromium from Playwright with
`--enable-unsafe-webgpu --use-angle=metal`, local checkout.

## 2.1 Export worker loop

Files: `apps/web/src/export-worker/worker.ts`, `apps/web/src/models/render/export-protocol.ts`,
`apps/web/src/services/preview-media/browser-export.ts`, `scripts/build-renderer-wasm.ts`
(bundles `export-worker.js`), `apps/web/src/app/renderer-routes.ts`.

| Command                                                                               | Result                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun scripts/build-renderer-wasm.ts --worker`                                         | `export-worker.js` 271476 bytes beside `preview-worker.js`.                                                                                                                                            |
| `bun run --cwd apps/web test src/services/preview-media/browser-export.test.ts`       | 7 passed: captured storyboard and borrowed local sources, decoder grant routing, cancel, source revoked during export, missing local source before worker start, invalid worker message, bitrate rule. |
| `bun test apps/web/src/app/renderer-routes.bun.test.ts`                               | 5 passed, including the export worker route and the updated list of modules that name `/renderer/`.                                                                                                    |
| `bunx playwright test visual/browser-export.spec.ts --project visual` (in `apps/web`) | Passed. Output of `cfr-av.mp4` (24 frames at 12 fps) at 30 fps, 320x192, 60 frames.                                                                                                                    |

Decoded output (`result.json` of the spec run):

| Output frame | Source frame ID | Grey band | Expected (nearest PTS, ties later, held at 23) |
| ------------ | --------------- | --------- | ---------------------------------------------- |
| 0            | 0               | 64        | 0                                              |
| 1            | 0               | 64        | 0                                              |
| 2            | 1               | 68        | 1                                              |
| 5            | 2               | 72        | 2                                              |
| 12           | 5               | 84        | 5                                              |
| 13           | 5               | 84        | 5                                              |
| 29           | 12              | 112       | 12                                             |
| 30           | 12              | 112       | 12                                             |
| 44           | 18              | 136       | 18                                             |
| 59           | 23              | 156       | 23                                             |

Packet count 60, duration 2.000 s, 320x192, progress reached 60 of 60. A storyboard with a
0.2 s `lower-third` overlay at 0.5 s failed with
`Frame 15 cannot be exported: textOverlays[0] \`lower-third\` preset` and produced no file.

Note: the first expectation used the containing interval (floor). The renderer selects the
nearest presentation time, as `crates/renderer/AGENTS.md` records, so the expectation was
corrected. No renderer change.

## 2.2 Audio track

Files: `apps/web/src/export-worker/worker.ts` (Rust mix through `createAudioMedia`, AAC
`AudioSampleSource`, priming measurement), `apps/web/src/models/render/mp4-audio-priming.ts`.

Fixture storyboard, 6 s at 30 fps (`visual/browser-export.spec.ts`, audio test):

| Clip                                                        | Authored                           | Expected onsets |
| ----------------------------------------------------------- | ---------------------------------- | --------------- |
| Voiceover `impulses-48000.wav` at 0.2 s, 2 s, `fadeInSec` 1 | impulse at 0.2 s is at fade gain 0 | 1.2             |
| Music `impulses-44100.wav` at 2.4 s, trimmed to 1 s         | impulse at 3.4 s is cut            | 2.4             |
| Clip audio of `cfr-av.mp4` overlay at 3.6 s, volume 1       | embedded AAC impulses              | 3.6, 4.6        |
| Sound effect at 5.2 s, `mediaStartSec` 1                    | source impulse at 1 s              | 5.2             |
| Sound effect at 5.6 s, volume 0                             | muted                              | none            |

Measured onsets in the decoded file: 1.19998, 2.39998, 3.60000, 4.59998, 5.19998 s
(all within one sample). Audio 48 kHz stereo. Video track 6.000 s; file 6.036 s because
the AAC track ends on a packet boundary.

Two defects were found and fixed while making this pass:

1. Encoded audio was silent except two short regions. The worker passed `subarray` views
   with a nonzero byte offset to `AudioSample`, and the encoder read from the buffer
   start. Each chunk is now a copy. Proof: before the fix, the mix pulled in the worker had
   impulses at 1.2/2.4/3.6/4.6/5.2 s while the file had energy only near 3.4 and 4.6 s.
2. Every onset was 44 ms late: AAC priming (about 2112 samples on macOS) with no edit list.
   The worker now measures priming per export and writes `edts/elst` (design E2).

| Command                                                                                              | Result                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run --cwd apps/web test src/models/render/mp4-audio-priming.test.ts`                            | 5 passed: edit list read back as first timestamp `-2112/48000` with every packet intact for `fastStart` in-memory and off, zero priming unchanged, refusals. |
| `bunx playwright test visual/browser-export.spec.ts visual/export-coverage.spec.ts --project visual` | 5 passed (video, audio, coverage).                                                                                                                           |
| `bunx vp check`                                                                                      | 2505 files clean.                                                                                                                                            |

## 2.3 Browser preflight

Files: `apps/web/src/models/render/export-preflight.ts` (rules and manifest schema),
`apps/web/src/services/preview-media/export-preflight.ts` (WebGPU adapter, `canEncodeVideo`
/`canEncodeAudio`, SHA-256 through `crypto.subtle.digest`),
`apps/web/src/services/preview-media/export-local-files.ts` (manifest entry to the preview's
complete local file, by media id or exact URL), `apps/web/src/api/asset-manifest.ts`
(`GET /projects/:id/asset-manifest`), `sourceUrls()` on the preview media session.

Order: WebGPU, encoders, coverage, manifest blockers (pending before failed), then each used
`ready`/`external` entry, one file at a time. Preflight takes no document or writer, so it cannot
change the document. The tests pass a frozen manifest.

| Refusal                       | Cause      | Names                                                 | Offers server export              |
| ----------------------------- | ---------- | ----------------------------------------------------- | --------------------------------- |
| No WebGPU adapter             | `webgpu`   | missing WebGPU                                        | yes                               |
| No H.264/AAC encoder          | `encoder`  | encoder                                               | yes                               |
| Uncovered element             | `coverage` | reason and time (`` `lower-third` preset at 1.50 s``) | yes                               |
| Used entry `pending`          | `pending`  | file label                                            | no (server export refuses it too) |
| Used entry `failed`           | `failed`   | file label                                            | no                                |
| No local file, or read failed | `download` | file label                                            | yes                               |
| Size or SHA-256 differs       | `hash`     | file label                                            | yes                               |

| Command                                                                                                                        | Result                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run --cwd apps/web test src/services/preview-media/export-preflight.test.ts`                                              | 14 passed: every refusal above, check order, pending before failed with no local reads, uppercase manifest hash, real SHA-256 of `abc`. |
| `bun run --cwd apps/web test src/services/preview-media/export-local-files.test.ts src/services/preview-media/session.test.ts` | 9 passed.                                                                                                                               |
| `bunx vp check`, web typecheck, `check-layers`                                                                                 | Clean (2511 files, 199 cross-cluster imports, unchanged).                                                                               |

The manifest describes the saved storyboard. Task 2.4 saves the storyboard before it reads the
manifest, as server export already does.

## 2.4 Editor integration and draft removal

Files: `apps/web/src/hooks/editor/use-browser-export.ts` (save, capture, manifest, coverage,
preflight, worker, save file, cancel), `export-menu.tsx` (Browser export entry, disabled until
coverage is eligible), `render-status-body.tsx` (Cancel export), `editor-views.tsx`,
`create-content.tsx`. The export source carries the output size from `FORMAT_DIMS` and the
preview's local-file lookup.

Deleted: `apps/web/src/models/render/export.ts`, `draft-request.ts`, its test, `exportFastDraft`,
`DRAFT_DIMS`, the four "Simplified draft omits" warnings and the server-only pending blocker. A
file still uploading now blocks both exports (`project-media-library` delta).
`timelineTotalSec` and `hasRenderableVisual` moved to `models/render/timeline-extent.ts` with their
tests. Prose updated: `docs/development.md`, `apps/web/DESIGN.md`,
`apps/render-worker/docs/RUNBOOK.md`, inventory rows in `docs/design-system/components.md`.

`git grep` for `render/export.ts`, `draft-request`, `exportFastDraft`, `DRAFT_DIMS`, `Fast render`,
`Fast draft`, `fast-draft` and `exportDraft` outside archives, HAR fixtures and released
CHANGELOG entries finds one hit: narrative text in `openspec/specs/render-option-parity/spec.md`
line 98, which is a main spec that this change does not own.

Running editor (`visual/browser-export-editor.spec.ts`, WebGPU Chromium, fixture project of 3 s):

| Check                                                                       | Result                                                                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Export at 1440 px                                                           | Download saved; ffprobe: 90 video frames, duration 3.0–3.055 s; no `/render` request; status says "saved to this device". |
| Export at 320 px                                                            | Same.                                                                                                                     |
| Cancel (worker script held 3 s)                                             | Status "cancelled", Cancel button gone, no download after 4 s, button idle again.                                         |
| Edit during export (manifest response held, clip dragged +160 px meanwhile) | File has 90 frames (the captured 3 s storyboard). The clip keeps its new position.                                        |
| Manifest names a used `ready` file the browser has no copy of               | "interview.mp4 could not be downloaded in this browser" shown; menu reopens; Server render enabled; no download.          |

| Command                                                                                                                          | Result                                                                |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `bunx playwright test visual/browser-export-editor.spec.ts visual/browser-export.spec.ts --project visual`                       | 8 passed.                                                             |
| `bunx playwright test visual/pending-media.spec.ts visual/reverse-video.spec.ts visual/export-coverage.spec.ts --project visual` | 13 passed (menu assertions moved from Fast render to Browser export). |
| `bun run --cwd apps/web test`                                                                                                    | 324 files, 2623 tests passed.                                         |
| `bunx vp check`, web typecheck, `check-layers`, `bun run check:references`                                                       | Clean.                                                                |

Deviation from design: `StreamTarget` dropped; see the design risk entry for browser memory.

## 2.5 Representative projects

Method (approved by the user on 2026-11-07): export golden corpus cases through browser export with
their media as complete local sources, decode the MP4, and score each compared frame by full-frame
SSIM against the case's production Remotion reference, with the golden gate's metric ported to the
page (`apps/web/visual/browser-export-corpus.spec.ts`). The golden gate holds the Rust renderer to
the same references, so the gap between the two scores is what export adds. The spec does not compare
against the Rust renderer's own pixels directly, because that would need a test-only capture message
in the production worker.

Golden scores: `MALEO_GOLDEN_SCORES=1 rtk proxy cargo test -p maleo-renderer --test golden
every_case_is_at_parity_with_remotion -- --nocapture` (passed, 1122.9 s on Metal). The hook
`rtk` rewrites `cargo test` into a summary, so `rtk proxy` is needed to see the scores.

| Case (feature)                           | Frames compared | Golden min (Rust vs Remotion) | Export min (decoded vs Remotion) | Largest gap |
| ---------------------------------------- | --------------- | ----------------------------- | -------------------------------- | ----------- |
| `caption-combined-a` (captions)          | 3               | 0.9908                        | 0.9904                           | 0.0004      |
| `caption-highlight` (captions)           | 3               | 0.9989                        | 0.9987                           | 0.0002      |
| `transition-series-fade` (transitions)   | 15              | 0.9999                        | 0.9995                           | 0.0005      |
| `transition-absolute-wipe` (transitions) | 18              | 1.0000                        | 0.9998                           | 0.0002      |
| `effect-flash` (effects)                 | 12              | 1.0000                        | 0.9994                           | 0.0006      |
| `effect-zoom_punch` (effects)            | 12              | 1.0000                        | 0.9998                           | 0.0002      |
| `video-scene-transition` (video)         | 8               | 0.9998                        | 0.9905                           | 0.0093      |
| `video-overlay-mask-color` (video)       | 7               | 0.9994                        | 0.9592                           | 0.0402      |
| `composition-primitives` (templates)     | 12              | 0.9958                        | 0.9954                           | 0.0008      |
| `shape-primitives-wide` (shapes)         | 1               | 0.9982                        | 0.9969                           | 0.0013      |
| `combined-project` (images, text, logo)  | 3               | 0.9933                        | 0.9901                           | 0.0033      |

94 frames, mean gap 0.0030. Every decoded file has the case's exact frame count.

Encoding tolerance found:

- Without source video: the gap is at most 0.0013 at the default bitrate (8 Mbit/s per 1080p).
- With source video: the gap reaches 0.0402. At four times the bitrate, the video cases score
  0.9921–0.9986 and 0.9593–0.9704, so the gap is not rate-control loss. The golden gate supplies
  pre-decoded PNG samples, while export decodes the MP4 through WebCodecs and re-encodes it to
  4:2:0 H.264. The cause is between those two steps and is not yet isolated. It is an open item
  for the comparison calibration (task 4.2), which measures Remotion against a re-encode of
  itself.
- The spec's floor is `EXPORT_FRAME_SSIM = 0.95`. Every frame passes it (lowest 0.9592).

Docs: `docs/development.md` (The Rust renderer, Browser export: the full contract),
`docs/CODEMAPS/renderer.md` (Hosts), `CHANGELOG.md` (Unreleased: Added browser export, Changed
Fast render removed). `bun run check:references` and `bun run check:version` pass.
