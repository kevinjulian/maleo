# Audiovisual synchronization (task 7.4)

Status on 2026-10-29: **offset targets pass; settling does not.** Every 1x and
2x transition settles within 250 ms. Starts at 0.5x and the first Play of a
session do not. No threshold changed.

## Run

Named desktop acceptance machine: MacBookPro18,3, Apple M1 Pro, 16 GiB, macOS
26.5.2, Chromium 151.0.7922.34 headless, WebGPU through ANGLE Metal.
AudioContext 48000 Hz, outputLatency 16 ms, baseLatency 5.33 ms.

```sh
bun run --cwd apps/web playwright test perf/preview-media-sync.spec.ts --project=perf
```

Fixture: `scripts/media-playback-sync-fixtures.ts` generates a 600-second
320x180 30 fps H.264 video with burned-in frame numbers, and a 600-second AAC
track with a 0.9-amplitude 3 ms click every 0.5 s over a 0.05-amplitude 220 Hz
tone. Commands and hashes: `sync-fixture-manifest.json`. Sources load as
complete local bytes; the network goes offline before the first Play.

Path: compare mode with Rust audio as the clock owner, the only path where
consumed output samples drive video (D7, D8).

## Method

- Output capture: a processor wrapper after the production worklet scans the
  samples it writes. A click is the first sample above 0.5 at least 100 ms after
  the previous one; an onset is the first block above 0.02 after four quiet
  blocks.
- Audible time: the sample's context time mapped through
  `AudioContext.getOutputTimestamp()`, so it includes graph and device latency.
- Video time: epoch time when the renderer worker finished drawing each frame.
  Compositor and display latency after the draw is not measured; on a 60 Hz
  display it adds up to one refresh (about 17 ms) of video lateness.
- Offset: audible click time minus the time the video reached that click's
  marker frame, interpolated at the current rate. Negative means audio early.
- Settling: from each command to the later of the first draw at the commanded
  time and the first output onset (or click) after it. Offsets count only after
  settling. The report records which side bounded it.
- Analysis: `apps/web/perf/sync-analysis.ts`, unit check
  `sync-analysis.test.ts`.

Time-stretching cannot keep every click: WSOLA drops input segments at 2x and
repeats them below 1x. Offsets use the clicks that survive.

The plan covers play, pause, seeks while paused and while playing, and rate
changes in place at 0.5x, 1x and 2x across the 10-minute fixture. Final summary:
`sync-chromium.json`.

## Results

| Rate | Clicks | p50 offset | p95 abs | Max abs |
| ---- | -----: | ---------: | ------: | ------: |
| All  |    358 |          — |   33 ms |   67 ms |
| 0.5x |     45 |     −22 ms |   61 ms |   67 ms |
| 1x   |    195 |     −15 ms |   17 ms |   18 ms |
| 2x   |    118 |      −8 ms |   28 ms |   35 ms |

Target: p95 at most 50 ms, maximum at most 100 ms. Both pass overall; 0.5x alone
has p95 61 ms from WSOLA's transient spread (below).

| Transition         | Settling | Bound by      |
| ------------------ | -------: | ------------- |
| play 1x from 0     |  2192 ms | audio (click) |
| rate 2x in place   |   122 ms | video         |
| play 0.5x from 300 |   491 ms | audio         |
| seek 500 at 0.5x   |   477 ms | audio         |
| rate 1x in place   |    86 ms | video         |
| seek 100 at 1x     |    47 ms | audio         |
| rate 2x in place   |    86 ms | audio         |
| seek 550 at 2x     |    91 ms | audio         |

Target: 250 ms.

## Fixes this run depends on

1. **Time-stretch lead.** WSOLA output led its input (0.5x: audio 143 ms early).
   An offline probe measured the mean lead per rate; `AudioTempo.leadSeconds`
   now feeds the mixer from `position − lead` and trims the lead from the end
   (`finish(trimFrames)`). `audio-tempo.test.ts` re-measures it through the real
   processor and fails if an upstream change moves it more than 15 ms.
2. **AAC window seams.** Each 0.25 s window decoded from a cold decoder, whose
   first frame is wrong, so clicks on seams lost amplitude or vanished at 1x.
   Windows now decode from 100 ms earlier and keep only the requested interval.
3. **Video decoder sharing.** A placement and its prefetch now share one decoder
   (see `acceptance.md`, 7.3). Before this, every pause or slow-rate seek
   cold-started a prefetch worker, and video buffered for 400–900 ms.
4. **Stale reservations.** A refused reservation for a superseded request is now
   a cancellation. It used to count as a failure and closed the shared decoder.

## Open findings

1. **First Play varies from 0.2 to 2.2 s** across runs. The trace shows the
   session playing at 450 ms, then the audio clock holding for about 1.7 s.
   Device activation measured separately: `new AudioContext` 129 ms, `resume`
   0 ms, worklet `addModule` 10 ms. The rest is the first audio windows of the
   600 s AAC source decoding cold while the video decoder also starts. Each
   window spawns a decode worker and parses the file (D6, one codec lifetime per
   job), and those decodes have 600–800 ms outliers.
2. **Starts at 0.5x take about 480 ms.** Audio bounds them: the first audible
   output follows a brief buffering report after the restart.
3. **0.5x transient spread.** WSOLA repeats each click about 45 ms apart below
   1x, so the measured offset moves by up to the sequence window (0.5x p95
   61 ms against a 50 ms per-rate reading; the overall target passes).

Authored source rates 0.25x and 4x (D10) play processed derivatives, not the
transport stretch, and are not exercised by this run.
