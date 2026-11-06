# Tasks

Do the tasks in order. Record each command and its actual result under `evidence/`. Do not change any threshold. The archived baseline is `archive/2026-11-01-p2-media-playback/evidence/`.

## 1. Held audio decode per source (D1, D2)

- [x] 1.1 Change `audio-worker.ts` to accept a sequence of window requests over one parsed `Input` for each source revision, keeping 100 ms pre-roll and exact-interval output. Verify with worker/client tests: three consecutive windows parse once and match the samples of the one-shot path exactly; an out-of-order window and a revision mismatch are refused.
- [x] 1.2 Add `createAudioSourceClient` beside `video-client.ts`: one grant held across requests, yield on broker request when idle, a 2 s idle stop, and release on revision change or disposal. Verify with tests using fake leases: two decoders at most with three sources, yield after the window in flight, abort releases PCM reservations, and no codec or `AudioData` survives the stop.
- [x] 1.3 Route `preview-worker/audio-media.ts` through one client per bound source, and remove `decodeLocalAudio` once the callers are migrated. Verify that the existing audio adapter, tempo, worklet and session tests pass unchanged, and that `bun run typecheck` passes.
- [x] 1.4 Warm the first lookahead block at the playhead while paused and ready, and after a paused seek. Discard it by generation. Verify with tests: a warm block serves Play without a new decode; a seek or a source change discards it; the PCM budget includes it.
- [x] 1.5 Update the audio decoder lifetime section of `docs/development.md` (the `audio-client.ts` paragraph) to describe the held worker, yield, idle stop and warm window. Verify that `bun run check:references` passes.

## 2. Seek then Play reset (D4)

- [x] 2.1 Add counters for position writes and generations in a ring buffer that costs little and does not change timing, and dump it when `visual/preview-readiness-acceptance.spec.ts` fails. Repeat the normal-mode spec until it fails, and record the writer and the order of events in `evidence/seek-play-reset.md`.
- [x] 2.2 Fix the cause recorded in 2.1. The traces found no application writer: the spec's ruler click hit the paused playhead handle (decision 2026-11-06: 2.2 is narrowed to the spec fix). Move the click off the playhead, and add a check in the spec that fails when the click target is under the playhead handle. Verify 20 consecutive passes of the normal and compare spec (`--repeat-each=20`), then remove the counters.

## 3. Readiness geometry and seek latency (D5)

- [x] 3.1 Assert that the boxes of the ruler, the first lane and one clip are equal before and after readiness, at 1440 px and 320 px, in the delayed-media visual spec. If they differ, fix the toolbar row height without adding a row and update `docs/design-system/patterns/timeline-clip.md` or the transport contract. Verify that the spec passes, and record the boxes in `evidence/readiness-geometry.md`.
- [x] 3.2 Remove the readiness settle wait from the `timeline-chrome` "a clip dragged across lanes" spec. Verify 10 consecutive passes.
- [x] 3.3 Record the latency of each of the 100 seeks (request to presented frame: p50, p95, max) in `perf/preview-media-stress.spec.ts`. Verify three runs on the named machine that keep all existing assertions (dropped frames ≤ 1%, budgets, disposal), and record the distribution and peak RSS in `evidence/stress.md`.

## 4. Synchronization acceptance (D3)

- [ ] 4.1 Run `perf/preview-media-sync.spec.ts` at 0.5x, 1x and 2x with pause, seek and rate changes, and with the first Play. Verify p95 ≤ 50 ms, max ≤ 100 ms after settling, and settling ≤ 250 ms including the first Play and the 0.5x start. Record the results in `evidence/synchronization.md`. If any target fails, record the breakdown into activation, first decode, tempo fill and worklet fill, and pause for a decision under D3.

## 5. Device proof and closeout

- [ ] 5.1 Record Play, sound, suspension and memory on a physical iPhone in `evidence/device.md`. This task is gated on a device: it stays unchecked without physical proof, and emulation cannot close it.
- [ ] 5.2 Run the Rust media/preview tests, the affected portable and browser suites, `bun run typecheck`, the version and reference gates, one complete `bun run ci` and `openspec validate p2-media-acceptance --strict`. Record the actual outputs in `evidence/acceptance.md`, and add a `CHANGELOG.md` Unreleased entry.
- [ ] 5.3 Tick grandplan milestones 5.1–5.5 only where the evidence here and in the archived phase is complete, with links to that evidence. Verify that every ticked milestone cites a passing result. Without 5.1, record the remaining gap.
