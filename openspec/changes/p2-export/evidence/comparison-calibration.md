# Comparison and calibration (task 4.2)

## What the comparison does

`apps/render-worker/src/comparison.ts` compares a shadow output with its authoritative output. The criteria are in `apps/render-worker/comparison.json` (version 1).

1. Format: `ffprobe` gives size, frame rate, frame count (packets) and duration. Size, rate and count must be equal. Durations must be equal within `durationFrames` (1) frame.
2. Frames: `maleo-render plan` lists the sampled frames from the renderer's own timeline: each base visual start (`scene`), each transition midpoint (`transition`) and each whole second (`second`). FFmpeg extracts them as PNG. `maleo-render compare-frames` scores them with the golden corpus scorer. The host compiles `crates/renderer/tests/golden/compare.rs` itself (`#[path]`), so the scorer is the same code. A frame below the threshold fails, with its frame number, time, reason and score. The threshold is `corpusFrame` (0.98) minus `encodingAllowance`, or a `lowered` value for the project.
3. Loudness: both audio tracks decode to 48 kHz mono float. Each 100 ms window where the reference is above −50 dBFS must be within 1.5 dB.
4. Clip starts: for each audio clip in `plan` (from `audio_requests::project`), the onset is the first sample above a quarter of the local peak, from two frames before the clip start to 0.5 s after. A shadow onset more than `onsetFrames` (1) frame from the reference onset fails, with the clip path, URL and offset.

A failed comparison keeps `reference/`, `candidate/` and `difference/` PNGs and `scores.json` in `out/comparisons/<shadow id>/`. A passing comparison removes the directory.

## Tests

`apps/render-worker/src/comparison.bun.test.ts` (real FFmpeg and the built host):

- Identical outputs pass. Every sampled frame scores 1. No artifacts remain.
- Audio 50 ms (1.5 frames) late fails with `audioOverlays[0] (media/burst.wav) starts 50.0 ms off`. The frames still score 1. The spec fails a clip "more than one frame later", so the test shift is above one frame. A shift of exactly one frame is on the limit and is not a test case.
- A white box on every frame fails with `frame 0 (0.000 s, scene) SSIM ... below ...`. The reference, candidate and difference PNGs and `scores.json` are kept.

`crates/render-host/src/compare.rs` unit test: the plan samples two scene starts, the transition midpoint and each second, in order, and gives the clip start in frames.

## Calibration

`apps/render-worker/scripts/calibrate-comparison.ts`, one case per process (Bun 1.3.1 with Remotion 4.0.462 breaks the browser connection after the first render in one process).

For each case: Remotion renders the MP4 that the worker exports (composition preset, H.264, 6 Mbit/s for `StoryboardReel`). The `maleo-render-host:p2` image re-encodes it with the host settings: `libopenh264`, 8 Mbit/s at 1080x1920, GOP 60, AAC 192 kbit/s. The comparison scores the two files at the plan's sample frames.

Run on 2026-11-07, macOS host for Remotion, Docker image for OpenH264:

| Case                     | Frames | Min SSIM | Mean SSIM | Audio failures |
| ------------------------ | -----: | -------: | --------: | -------------- |
| combined-project         |     40 |   0.9891 |    0.9959 | none           |
| image-scene-full         |      4 |   0.9947 |    0.9956 | none           |
| reveal-texture-paper     |      2 |   0.9953 |    0.9976 | none           |
| camera-preset-ken-burns  |      4 |   0.9961 |    0.9964 | none           |
| video-overlay-mask-color |      2 |   0.9986 |    0.9989 | none           |
| video-scene-transition   |      3 |   0.9987 |    0.9993 | none           |
| caption-combined-a       |     10 |   0.9989 |    0.9992 | none           |
| transition-series-fade   |      8 |   0.9992 |    0.9997 | none           |
| text-plain-styled        |      4 |   0.9993 |    0.9996 | none           |
| decoration-grain-repeat  |      1 |   0.9997 |    0.9997 | none           |

The largest loss of one extra encode is 0.0109 (`combined-project`). A production pair holds two independent encodes (Remotion's x264 and the host's OpenH264), so the allowance is 2 x 0.0109 + 0.003 = 0.025. The frame threshold is 0.98 − 0.025 = 0.955. The reason is in `comparison.json`.

## Limits

- The cases are golden corpus storyboards, not production projects. No production media was available locally. The observation window (task 5.2) checks the allowance on production jobs. A change to the allowance bumps `version` and records its reason.
- The Remotion renders ran on macOS, not in the production image, so fonts can differ from production. The calibration measures encoding loss only: both files in a pair come from the same Remotion render, so fonts do not change the result.
- The corpus cases have short or no audio. The audio criteria passed on every case; the tests above prove their failures.
