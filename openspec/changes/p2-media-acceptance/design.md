# Design

## Context

See proposal.md for the motivation. The facts below describe the current state.

- `preview-worker/audio-media.ts` `feed()` asks Rust for audio requests (`audio_requests`) and calls `decodeLocalAudio` once for each request. `services/preview-media/audio-client.ts` gets a broker grant, starts a new `preview-audio-worker`, and posts one request. The worker builds a MediaBunny `Input`, reads the track metadata, decodes the window with 100 ms pre-roll (D6 of the archived design), replies, and is terminated. The cost of each window is the worker start, the container parse and a cold codec. The archived evidence measured 600–800 ms outliers.
- `services/preview-media/video-client.ts` already holds a worker for each placement. It gets its grant once, serves a queue, and stops when the Rust broker asks it to yield (`decoder-leases.ts` `onYield`). The audio client copies this pattern.
- `codec-lifetime.ts` limits each worker to the codecs that its lease allows, and it closes every live codec and sample when it releases.
- The readiness status (`PreviewReadinessStatus`) already renders inside the toolbar row (`timeline-toolbar.tsx`, commit `1490e5f`). That commit came after the archived evidence. Nobody has measured whether the lanes still move.
- The seek/Play reset in normal mode reproduces in about 1 of 3 runs, and it does not reproduce with tracing on. Restoring synchronous session creation did not fix it. The cause is unknown.

## Goals / Non-Goals

**Goals:**

- Remove the cost of starting a worker, parsing the source and starting a cold codec for each window from steady playback and from the first Play.
- Close the archived tasks 7.3–7.6 with recorded evidence, without changing any threshold.

**Non-Goals:**

- Changing the Rust mixer, the tempo processor, the lookahead or the PCM budget.
- Changing the video decode path.
- Changing the visual design of the readiness status, unless the measurement shows that the geometry moves.

## Decisions

### D1. One held audio decode worker per source (revises archived D6)

Add `createAudioSourceClient(source, options)` next to `video-client.ts`. It holds one worker. That worker keeps the parsed `Input`, the primary track and its metadata for the source revision. The worker receives a sequence of window requests. Each request still decodes from `start − 100 ms` and returns only its interval, so window seams keep the archived pre-roll rule. The client gets one broker grant when it receives its first request. It keeps the grant while requests continue. It stops (closes codecs, disposes the `Input` and terminates the worker) when any of these happens:

- the broker asks it to yield, and no window is in flight;
- the source revision changes or the binding is removed;
- `reset()` or session disposal runs;
- no request arrives for an idle period (initial value 2 s, the existing lookahead horizon).

`audio-media.ts` keeps one client for each bound source in `bindings` and calls it in place of `decodeLocalAudio`. PCM reservation works the same way for each window (reserve, then accept, then transfer), so the 16 MiB budget accounting does not change.

Alternatives considered:

- Keep the AudioDecoder alive across windows and feed it packets continuously, with no pre-roll. Rejected for now. Windows can be out of order after seeks, and the pre-roll rule is proven. With a held `Input`, the remaining cost is about 100 ms of extra decode for each window. That is small next to the cost of the parse and the worker start.
- Use one shared audio worker for all sources. Rejected because a hang in one source would block the others, and because it breaks the rule that each codec has one owner per lease in `codec-lifetime.ts`.
- Use larger windows. Rejected because they increase the PCM per window and the latency of the first window.

### D2. Warm the first window while paused and ready

When the session is ready and paused, and after a paused seek, `audio-media.ts` requests the first lookahead block at the playhead. The decoded window is kept in the existing bound cache under its generation. A later Play then starts from decoded PCM, and only the activation of the device (about 129 ms measured) remains on the critical path. A seek or a source change discards the warm window, using the existing generation rule. This is necessary because the cost of the first worker start and the first parse would otherwise still fall on the first Play.

Alternative: warm the window when Play is pressed. Rejected because the first decode is then still on the critical path.

### D3. The 0.5x settling target is measured after D1 and D2 before any further change

At 0.5x, the tempo processor's content lead (+61 ms) and the slower use of samples change the critical path. After D1 and D2, run the sync spec again. If 0.5x still fails, record the breakdown (activation, first decode, tempo fill, worklet fill) in the evidence. Then pause and propose the next step. Do not tune constants until they pass.

### D4. Find the cause of the seek/Play reset before fixing it

Do not add a defensive guard first. Instrument the path with counters that cost little and do not change timing: session generation, position writes and their source (worker message, readiness change, transport). Store them in a ring buffer that the spec dumps when it fails, so that tracing does not hide the race. Fix the writer that resets the position, and add a unit or hook test that reproduces the order of events.

### D5. Measure the readiness geometry before changing it

Add a visual assertion to the delayed-media spec. It records the bounding boxes of the ruler, the first lane and one clip before and after readiness, at 1440 px and 320 px. Equal boxes close the item, and the `timeline-chrome` settle workaround is removed. If the boxes are not equal, fix the toolbar row so that it reserves its height (for example, a fixed row height). Do not add a new row.

## Risks / Trade-offs

- [Held workers keep memory while idle] → The idle timeout, yielding on contention and release on disposal limit this. The stress run records peak RSS against the archived 857 MiB value.
- [A warm window wastes decode work when the operator seeks often] → It is limited to one block for each paused seek and is cancelled by generation.
- [The reset cause may be in shared session code that compare mode also uses] → Repeat both the normal and the compare spec after the fix.
- [No physical iPhone is available] → Old task 7.5 stays open, and grandplan 5.x stays unchecked. This is stated in the evidence. It is not waived.

## Migration Plan

This change is web-only, in the preview runtime. It needs no data migration. To roll back, revert the commit. The one-shot `decodeLocalAudio` path is removed only after the new client passes its tests, so the revert restores it.
