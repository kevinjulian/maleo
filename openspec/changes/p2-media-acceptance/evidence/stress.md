# Stress and seek latency (task 3.3)

## Machine

- MacBookPro18,3, Apple M1 Pro, 16 GiB (17179869184 bytes)
- macOS 26.5.2
- Chromium 151.0.7922.34, WebGPU on ANGLE Metal

## What the spec records

`apps/web/perf/preview-media-stress.spec.ts` (entry `preview-media-stress-entry.ts`) keeps all
existing phases and assertions: 60 s of dual 1080p30 playback offline, then the 100-seek burst
during playback (one seek every 10 ms, with a synthetic decode delay of up to 240 ms on each video
frame), then disposal.

Each drawn frame is now stamped with the page time its report arrives on the main thread, and each
burst seek with its request time.

- **Burst.** A seek counts as presented when a fully covered draw (no missing layer) at or past
  its target arrives before the next seek replaces it. The burst coalesces seeks, so the
  expected result is that no seek before the last one presents.
- **Paced phase (decision 2026-11-06).** The burst cannot give a latency for each seek, so a second
  phase follows it while paused: the same 100 targets, one at a time. The synthetic decode delay
  stays on. The latency of a seek is the time from the request to the first fully covered draw at
  the target frame or up to 6 frames past it. Each seek waits at most 2 s.

A first version counted draws that had missing layers (placeholder draws) and gave a p50 of about
7 ms. That result was wrong and is not used.

## Results (three runs)

| Run | Paced p50 | Paced p95 | Paced max | Timed out | Burst presented | Dropped | Elapsed   | Peak RSS (browser tree) |
| --- | --------- | --------- | --------- | --------- | --------------- | ------- | --------- | ----------------------- |
| 1   | 532 ms    | 700 ms    | 1012 ms   | 0 / 100   | 0 / 100         | 0.89 %  | 60 677 ms | 865.5 MiB               |
| 2   | 531 ms    | 699 ms    | 1191 ms   | 0 / 100   | 0 / 100         | 0.78 %  | 61 066 ms | 854.9 MiB               |
| 3   | 530 ms    | 923 ms    | 1091 ms   | 0 / 100   | 0 / 100         | 0.67 %  | 60 601 ms | 851.9 MiB               |

Existing assertions, all three runs:

| Check                              | Limit       | Runs 1–3                  |
| ---------------------------------- | ----------- | ------------------------- |
| Dropped frames                     | ≤ 1 %       | 0.89 %, 0.78 %, 0.67 %    |
| Elapsed for 60 s                   | ≤ 61 500 ms | 60 677, 61 066, 60 601 ms |
| Visual cache peak                  | ≤ 256 MiB   | 253.1 MiB (265 420 800 B) |
| PCM peak                           | ≤ 16 MiB    | 2.38 MiB (2 499 576 B)    |
| Video decoder slots                | ≤ 2         | 2                         |
| PCM and visual bytes after dispose | 0           | 0 and 0                   |
| Frame time p50 / p95               | (recorded)  | 4.8–5.3 ms / 6.4–6.9 ms   |

All three runs passed (`2 passed`, warmup included).

## Notes

- The paced latency includes the synthetic decode delay of the spec (0–240 ms on each decoded
  video frame). It is the stress case, not the latency of the normal decode path.
- After the last burst seek (to 55 s), the spec waits for position ≥ 55 s, which is true at once,
  and pauses. A covered frame for that seek therefore does not always arrive before the pause
  (`burstLastMs` was `null` in these runs and 600 ms in an earlier run). This is not asserted.
- An earlier trial run (before the three runs above) dropped exactly 1.0 % of frames, which is at
  the limit.

## Command

```bash
npx playwright test perf/preview-media-stress.spec.ts --project=perf
```
