# Integrated source readiness

Task 7.1, 2026-10-29. Production editor, desktop Chromium on macOS arm64.
Compare uses Chromium WebGPU with ANGLE Metal. API responses use fixture replay;
media routes serve real generated PNG, H.264 VFR MP4 and 48 kHz PCM WAV files.

```sh
bun run --cwd apps/web visual --project=visual preview-readiness-acceptance.spec.ts --workers=1
```

Result: three passed, including warmup. `readiness-normal.json` and
`readiness-compare.json` retain reports from this run.

The test releases initial image, later video, audible audio, separate muted
audio and hidden video independently. Each remaining dependency blocks Play,
Space and K. No AudioContext resumes before accepted Play. Hidden video fails
with HTTP 503; its real clip menu Retry repairs it. Unplaced unavailable library
media receives no fetch and cannot block readiness. Explicit lane groups keep
fixture visibility independent of legacy lane migration.

Measured readiness wait was 660 ms normal and 828 ms compare. These intervals
include controlled release, failure and Retry. They are not download-throughput
measurements or accepted-playback stalls. Completion enables Play without
autoplay. After network blocking, fresh Play crosses into later video. Normal
preview checks blob-backed video time and decoded-frame progress. Rust checks
audio clock ownership and progress beyond 3.3 seconds. Both pause, seek through
the real ruler to four seconds and resume with no additional source fetches.
Compare finishes with empty coverage and no error. Both have no page errors.
Observed persistence requests retain authored URLs, with no blob/data-image
substitution. Separate projection tests cover production/draft export mapping.

Each image/video source has one complete preview fetch; failed hidden source has
two attempts. Each WAV has one preview fetch and one existing main-thread
waveform fetch, identified separately. This does not claim tab-wide deduplication
of waveform or thumbnail work.

The probe found a runtime defect: compare fetched its video decoder script only
when a later video became active. Offline playback then stalled at that boundary.
Compare startup now awaits script preparation before reporting its initial
state. The final test keeps the first video in the future and disables network
before Play, so cached early video playback cannot conceal this defect.

This run does not measure cache eviction, sustained stress, speaker latency or
physical iPhone output. Those remain later acceptance tasks.
