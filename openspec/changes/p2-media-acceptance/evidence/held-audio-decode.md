# Held audio decode (tasks 1.1-1.5)

Date: 2026-11-06. Machine: the local development Mac (darwin 25.5.0).

## Interpretation

Task 1.1 says that "an out-of-order window" is refused. Design D1 says that windows can go
backward in timeline order after a seek, and that the pre-roll rule handles this. Thus
"out of order" means protocol order: the host sends a window while another window is in
flight. The worker refuses that window. Timeline order is not restricted.

## 1.1 Worker: one parse per source revision

`audio-worker.ts` binds to the first request's source and revision and keeps the parsed
`Input`. Each window decodes from 100 ms before its start and returns only its interval. The
codec and every `AudioData` close after each window.

`bunx playwright test visual/preview-audio-decode.spec.ts --project=visual`: PASS (2), FAIL (0).
From `audio-decode.json`:

- `heldWorkers: 1`: three consecutive AAC windows (0.1-0.35, 0.35-0.6, 0.6-0.85 s from
  `cfr-av.mp4`) used one worker, so the container was parsed once.
- `heldMatches: [true, true, true]`: each held window equals the one-shot window
  (a new client for each window) sample for sample (`Object.is`).
- `refusals`: `"Audio window requested out of order"` and `"Audio source revision mismatch"`.
- `codecs: { active: 0, max: 2 }`, `remainingBytes: 0`, `maximumBytes: 1478424`.

## 1.2 Client

`bun run --cwd apps/web test src/services/preview-media/audio-client.test.ts`: 5 passed.
The tests cover these items:

- Three windows use one worker and one grant. PCM is released only by the consumer.
- Three sources share a two-slot fake broker. The holder yields only after its window in
  flight (no termination while both are mid-window). The maximum number of held leases is 2.
- Abort after the reservation releases the PCM at once. The late reply is dropped. A window
  cancelled before its reservation is refused (`accepted: false`) and the worker stays held.
- The idle stop terminates the worker at 2000 ms (not at 1999 ms) and returns the grant.
  The next window starts a new worker.
- Revision mismatch, worker refusal and disposal terminate the worker. They leave no PCM
  reservation or grant. Termination ends the codec, the `AudioData` and the `Input` with the
  thread.

## 1.3 Migration

`audio-media.ts` keeps one client for each bound source URL. Seek and reconfiguration keep the
client. A new revision replaces the client, and a source that is no longer bound disposes its
client. `decodeLocalAudio` is removed (`git grep decodeLocalAudio`: no matches).

- `bunx vp run --filter @maleo/web typecheck`: pass.
- `bun run --cwd apps/web test src/services/preview-media src/preview-worker src/models/timeline`:
  80 files, 544 tests passed. The audio output, tempo, worklet and session suites are unchanged.

## 1.4 Warm block

`bun run --cwd apps/web test src/preview-worker/audio-media.test.ts`: 2 passed.

- A warm block at 2 s serves the first feed after Play. There is one decode, and the mixed
  input starts at sample 96000 exactly. The warm block reserves budget bytes until the first
  feed, and the budget is 0 after the feed.
- A paused seek to 5 s replaces the block and does not add a second block. A new source
  revision decodes again under `r2`. `discardWarm()` returns the budget to 0.
- Mutation check: with warm serving disabled, the first test fails
  (`expected [ …(2) ] to have a length of 1 but got 2`).

## 1.5 Docs

`docs/development.md` (the `audio-client.ts` paragraph and a new warm-block paragraph).
`bun run check:references`: `ok, no stale references in live guidance docs`.

## Observation for section 2

`--repeat-each=3` of `preview-readiness-acceptance.spec.ts` and `preview-audio-decode.spec.ts`
with 4 parallel workers timed out at 120 s in some readiness runs. On the baseline (these
changes stashed), the same command gave PASS (8), FAIL (2): both readiness modes timed out
once. Each mode passed when it ran alone, with and without these changes. Task 2.1
investigates this.
