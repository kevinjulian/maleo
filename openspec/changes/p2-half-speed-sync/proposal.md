# Proposal

## Why

`p2-media-acceptance` task 4.1 measured two 0.5x failures that its own decisions cannot close
(decision 2026-11-06, see `archive/2026-11-06-p2-media-acceptance/evidence/synchronization.md`):

- **Video far seek.** On a seek far into the video at 0.5x, the audio is ready in about 50 ms, but
  the video frame at the target sometimes takes about 400 ms. Settling is then 455–562 ms against a
  250 ms target. A worker gate that held the audio start until the video was ready did not help.
  The cost is in the video seek decode.
- **WSOLA placement spread.** At 0.5x, the offsets of single clicks spread from −69 ms to +107 ms
  around a centre near −20 ms. The tempo lead is already subtracted. The max offset is 107–113 ms
  against a 100 ms target, and the p95 is 60–72 ms against 50 ms.

## What Changes

- Find why some far video seeks take about 400 ms (keyframe distance, decoder start, cache miss),
  and reduce that time, or prepare the frame earlier.
- Measure the WSOLA spread against the tempo processor parameters (sequence length, seek window,
  overlap) at 0.5x, and choose parameters or a 0.5x target with evidence.
- Run the `p2-media-acceptance` sync acceptance again at 0.5x.

## Capabilities

### New Capabilities

None yet. The design step decides this.

### Modified Capabilities

- `media-playback`: possibly the 0.5x synchronization targets, if the evidence shows that WSOLA
  cannot meet them. The design step decides this.

## Impact

- `apps/web/src/preview-worker/visual-media.ts`, `apps/web/src/services/preview-media/video-*.ts`
  (far-seek decode).
- `apps/web/src/services/preview-media/audio-tempo.ts` (tempo processor parameters).
- `apps/web/perf/preview-media-sync.spec.ts` (0.5x acceptance).
