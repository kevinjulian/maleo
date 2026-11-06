# Synchronization acceptance (task 4.1)

Status: **targets not met. Paused for a decision under D3.** No constant was changed.

## Setup

- MacBookPro18,3, Apple M1 Pro, 16 GiB, macOS 26.5.2, Chromium 151.0.7922.34 (headless, WebGPU on
  ANGLE Metal). Output: 48 kHz, base latency 5.3 ms, output latency 16 ms.
- `apps/web/perf/preview-media-sync.spec.ts`, unchanged plan: Play 1x from 0 (the first Play),
  rate 2x in place, pause, Play 0.5x from 300 s, seek 500 s at 0.5x, rate 1x, seek 100 s at 1x,
  rate 2x, seek 550 s at 2x. Held audio decode (D1) and the warm block (D2) are active.
- Targets: p95 |offset| ≤ 50 ms, max |offset| ≤ 100 ms after settling, settling ≤ 250 ms
  including the first Play and the 0.5x start.

```bash
npx playwright test perf/preview-media-sync.spec.ts --project=perf
```

## Offsets after settling

| Run | Overall p95 | Overall max  | 0.5x p50 / p95 / max      | 1x p95 / max | 2x p95 / max |
| --- | ----------- | ------------ | ------------------------- | ------------ | ------------ |
| 1   | 33.4 ms     | **109.9 ms** | −19 / **67** / **110** ms | 17 / 20 ms   | 22 / 26 ms   |
| 2   | 35.0 ms     | **108.4 ms** | −24 / **62** / **108** ms | 18 / 19 ms   | 27 / 35 ms   |
| 3   | 34.5 ms     | **106.9 ms** | −23 / **64** / **107** ms | 13 / 20 ms   | 26 / 32 ms   |

1x and 2x meet the targets in every run. Every offset above the targets is at 0.5x.

## Settling (ms)

| Segment            | Run 1      | Run 2   | Run 3   |
| ------------------ | ---------- | ------- | ------- |
| play 1x from 0     | **391**    | **604** | **365** |
| rate 2x in place   | 103        | 113     | 113     |
| play 0.5x from 300 | 67         | **562** | 74      |
| seek 500 at 0.5x   | 64         | 67      | **506** |
| rate 1x in place   | 87         | 81      | 81      |
| seek 100 at 1x     | 40         | 41      | 44      |
| rate 2x in place   | 110        | 114     | 109     |
| seek 550 at 2x     | **2763** ¹ | 90      | 87      |

¹ Measured by the click fallback, not an output onset: no onset occurred in the 1 s window, so the
analysis used the next click. Runs 2 and 3 measured 87–90 ms by onset. This is a limit of the
measurement, not a 2.7 s stall.

The video side settled in 6–110 ms in every segment. The audio side sets every settling time
above.

## Breakdown of each start (runs 2 and 3, ms)

Measured on the main thread from the audio messages of the preview worker (spec field
`breakdown`):

- **activation**: command to `audio-configure` sent. This is output creation, `resume()`, silence
  and the paused position.
- **first decode**: `audio-configure` to the first `audio-block`. This includes the decode and the
  tempo work for the first block. They cannot be separated from the main thread.
- **tempo fill**: first block to `audio-play` sent (the queue is filled to 0.25 s).
- **worklet fill**: `audio-play` to the first audible onset.

| Segment            | Activation    | First decode | Tempo fill | Worklet fill |
| ------------------ | ------------- | ------------ | ---------- | ------------ |
| play 1x from 0     | **455 / 297** | 32 / 29      | 2 / 2      | 59 / 36      |
| rate 2x in place   | 1 / 1         | 25 / 23      | 49 / 45    | 15 / 16      |
| play 0.5x from 300 | 1 / 2         | 27 / 30      | 26 / 25    | **507** / 16 |
| seek 500 at 0.5x   | 1 / 1         | 26 / 23      | 25 / 23    | 14 / **457** |
| rate 1x in place   | 1 / 1         | 22 / 26      | 1 / 1      | 15 / 17      |
| seek 100 at 1x     | 1 / 1         | 25 / 24      | 0 / 0      | 14 / 17      |
| rate 2x in place   | 1 / 1         | 23 / 22      | 47 / 43    | 18 / 15      |
| seek 550 at 2x     | 2 / 1         | 24 / 25      | 49 / 46    | 14 / 14      |

## Findings

1. **First Play: activation is the critical path.** Activation takes 297–455 ms and is above the
   250 ms target alone. The first decode (29–32 ms) and the tempo fill (2 ms) are small after D1
   and D2. The archived figure for device activation was about 129 ms. This run is headless
   Chromium, which can differ from a headed browser.
2. **0.5x start: an intermittent 450–510 ms in the worklet fill.** It occurs in one 0.5x start in
   each run (a different segment each time), and the other 0.5x starts take 14–16 ms. Decode and
   tempo fill are normal in those starts. The cause is not known. One possible cause is the onset
   measurement: at 0.5x the clicks are twice as far apart in real time, so a start that falls
   between clicks can be heard only at the next click.
3. **0.5x steady offset.** At 0.5x the p50 is −19 to −24 ms and the p95 is 62–68 ms, with a max
   of 107–110 ms. This agrees with the tempo processor content lead (+61 ms at 0.5x) noted in D3.
4. **2x seek settling** meets the target when measured by onset (87–90 ms).

## Open decision (D3)

Per D3, no constant is tuned. The next step needs a decision on:

- the first-Play activation (start output creation earlier, for example when the session becomes
  ready, or accept the activation cost and change the target scope);
- the 0.5x offset (compensate the tempo content lead in the audio clock);
- the intermittent 0.5x start (instrument the worklet and the onset analysis first).
