# Delayed media after readiness

Task 7.2, 2026-10-29. Desktop Chromium, macOS arm64; compare uses WebGPU / ANGLE
Metal. Same generated 640x360, 30 fps H.264/AAC source as `baseline.md`.

```sh
bun run --cwd apps/web perf video-clip-stall.spec.ts --workers=1
```

Final result: nine passed, including warmup, trusted gesture, normal desktop,
phone emulation, Rust audio compare, delayed decoder startup and bounded recovery.

| Path                                           | Response delay | Readiness wait | Longest accepted-playback stall | Decoded frames      |
| ---------------------------------------------- | -------------- | -------------- | ------------------------------- | ------------------- |
| Normal desktop                                 | 800 ms         | 1320 ms        | 78 ms                           | 94                  |
| Phone emulation                                | 1500 ms        | 1832 ms        | 151 ms                          | 98 and 100          |
| Rust compare                                   | 800 ms         | 1313 ms        | 156 ms                          | 94 reference frames |
| Rust compare, 600 ms decoder startup injection | 800 ms         | 1315 ms        | 123 ms                          | 94 reference frames |

`stall-*.json` retain final reports. Readiness wait starts when timeline becomes
visible and ends when shared Play gate enables. It includes validation and
fixture preparation beyond response delay. It is separate from playback stalls. The phone row uses a longer 1500 ms delay than
the desktop 800 ms requirement; it is a stricter extra check, not the
requirement's measurement.
Normal/reference video counts use actual video quality counters, mapped back
from complete-File object URLs, excluding thumbnail tags. Compare stalls use
native composition-frame progress; fractional clock jitter cannot reset the
timer. Native output reaches 5.91/5.95 seconds with empty final coverage. Its
audio owner is asserted during playback; final host ownership follows pause/end.
Reference frame counts alone do not prove Rust video parity; separate production
pixel and frame-identity probes provide that proof.

An initial compare run measured 766 ms at the three-second video boundary. Two
later isolated runs measured 165/157 ms, but this did not resolve cold startup.
Rust now prefetches the first video within two seconds during image/gap spans,
using the existing source mapping, budgets and non-binding prefetch path.
Six native media-request tests pass, including later overlay and scene-local
video starts. The controlled browser case delays the first video worker init
by 600 ms and confirms it begins at timeline position 0.980, before the video
starts at three seconds. No playback or parity threshold changed.

Recovery probes now freeze output timestamps after complete-source readiness.
Holding network until after Play is incompatible with the new gate. Both desktop
and phone exercise initial Play plus exactly two automatic restarts, then paused
notice and explicit fresh Play after releasing the injected fault. The existing
single-restart audio recovery case also passes. These are injected clock faults,
not reports of naturally failing source bytes.

The authored source URL is unchanged. Task 7.1 and projection tests separately
verify offline seek and unchanged production/draft export mapping. Phone results
are Chromium emulation, not physical iPhone acceptance. This short probe does
not establish sustained 1080p performance or audiovisual synchronization.
