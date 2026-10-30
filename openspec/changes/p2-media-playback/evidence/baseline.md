# Unchanged playback baseline

Task 1.2, run 2026-10-27. Preview loading code was unchanged.
Host: macOS arm64. Browser: Playwright desktop Chromium, default headless output.
Fixture: existing generated 640×360 H.264/AAC MP4, five seconds at 30 fps.
The inserted timeline video starts at three seconds.

```sh
bun run --cwd apps/web perf video-clip-stall.spec.ts --workers=1
```

Result: 7 passed, including warmup, gesture activation, desktop/phone playback,
desktop/phone bounded stall recovery and frozen audio-clock recovery.

| Path            | Response delay | Longest measured stall | Decoded frames |
| --------------- | -------------- | ---------------------- | -------------- |
| Desktop         | 800 ms         | 87 ms                  | 94             |
| Phone emulation | 1500 ms        | 145 ms                 | 97 and 101     |

Added diagnostic collection of AudioContext resume/suspend/close calls, without
changing playback. Repeated desktop measurement:

```sh
bun run --cwd apps/web perf video-clip-stall.spec.ts --workers=1 --grep 'desktop.*video clip stall'
```

Result: 2 passed including warmup. Longest stall: 78 ms. Decoded frames: 94.
Transport ended at Play after moving through the fixture.

Recorded AudioContext calls, in order:

| Call    | State before call | AudioContext time (seconds) |
| ------- | ----------------- | --------------------------- |
| suspend | running           | 0                           |
| resume  | suspended         | 0                           |
| suspend | running           | 6.037333333333334           |
| resume  | suspended         | 6.037333333333334           |

These are method-entry observations. They do not measure speaker output,
latency or successful completion of each call. The separate recovery test
passed after deliberately freezing output timestamps and resuming playback.

The baseline already passes the 250 ms stall limit through existing premounting.
It does not enforce complete-project readiness. This probe tracks playhead stalls
and decoded-frame counts. It does not prove audiovisual synchronization or
physical iPhone playback. Task 7.2 must report readiness wait separately.
