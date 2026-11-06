# Seek then Play reset (tasks 2.1, 2.2)

## Instrumentation

- `apps/web/src/models/timeline/playhead-trace.ts` keeps a ring of the last 512 events in
  `globalThis.__playheadTrace`. Each event is one array push. There is no console output and no
  timer, so the trace does not change timing.
- `apps/web/src/hooks/timeline/use-remotion-playhead.ts` records every writer of the normal-mode
  position and every player event:
  - `player` (player attach, with a generation number), `bind`, `unbind`;
  - `ready` (change of the readiness gate);
  - `seek` (target, pause flag, last requested frame, player frame);
  - `toggle` (Play/Pause press: position, gate, player state, player frame);
  - `frame`, `play`, `pause`, `ended`, `seeked`, `recover` (stall recovery).
- `visual/preview-readiness-acceptance.spec.ts` dumps the ring, the timecode and the last worker
  states to `playhead-trace.json` in an `afterEach` hook when the test fails or times out.

## Reproduction

Command (normal mode, 2 workers):

```bash
npx playwright test visual/preview-readiness-acceptance.spec.ts --project=visual \
  -g "normal playback" --repeat-each=12 --workers=2
```

Result: 9 of 12 runs failed with `Test timeout of 120000ms exceeded`. An earlier batch failed 3
of 12 runs.

## Order of events in every failed run

The tails of all 9 traces were the same (times in ms from page start, one example):

```text
[2085,"ready",true,180]                 readiness opens the gate
[2472,"seek",0,true,180,180]            "Jump to start"
[2472,"seeked",0]
[2505,"toggle",0,true,false,0]          Play
[2506,"play",0]
...frame events 0..119...
[6572,"toggle",3.9667,true,true,119]    Pause, after the video-frame check passes
[6572,"pause",119]
                                        (no further event)
```

After the pause there is no `seek`, no `toggle` and no `frame` event. No writer reset the
position. The timecode at the timeout was `00:04:00` or `00:03:96`, the paused position.

With the ruler click limited to 15 s, the Playwright call log gave the cause:

```text
locator.click: Timeout 15000ms exceeded.
  - <div ... class="tl2-playhead" aria-label="Playhead" data-vui-slot="playhead"
    aria-valuenow="4" ...> intercepts pointer events
  - retrying click action
```

## Cause

The first Play is paused after the spec sees more than 3 decoded video frames. On this machine
that occurs at 3.97–4.00 s. The spec then clicks the ruler at the middle of clip `video:901`
(3–5 s), which is 4.0 s. The playhead handle is at that position and receives the pointer event.
Playwright waits for the click with no action timeout, so the test stops at the 120 s timeout.
The seek and the second Play never reach the application.

The writer was not in the application. No position write and no player event occurred after
the pause.

## Fix (spec, task 2.2)

Decision (2026-11-06): no application writer reset the position, so task 2.2 is narrowed to the
spec fix.

- The ruler click now targets 3/4 of the clip (4.5 s). The assertion `00:04:` and all other
  assertions are unchanged.
- A new check fails the spec when the click target is inside the box of the playhead grip
  (`.tl2-playhead-grip`, 10 px, the widest part of the playhead hit area). With the old target
  (clip middle) it fails as expected:

  ```text
  Error: seek target 273 is under the paused playhead {"x":273,"y":525.5,"width":2,"height":365.5}
  ```

  (This run used the 2 px line box. The check now uses the grip box, which is wider.)

- The counters are removed: `use-remotion-playhead.ts` is unchanged from `HEAD`, and
  `playhead-trace.ts` is deleted.

| Run                                    | Workers | Result                         |
| -------------------------------------- | ------- | ------------------------------ |
| `--repeat-each=12`                     | 2       | 12 passed                      |
| `--repeat-each=30`                     | 3       | 30 passed                      |
| normal and compare, `--repeat-each=20` | 2       | 40 passed (+ warmup), 0 failed |

The archived symptom ("the timecode returns to 0:00 and playback stops within 150 ms") did not
occur in any of the 82 runs above. Its archived description includes a wait on the Pause button
with no timeout, which agrees with the click interception found here. This is not proof that the
archived symptom had the same cause.
