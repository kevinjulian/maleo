# Authored derivatives and global transport pitch

Task 4.3 follows the D6 refinement approved by the user on 2026-10-28. Authored
processing remains the existing server implementation. Global playback uses the
upstream time-stretch stage. There is no new pitch control or custom algorithm.

## Dependency and boundaries

`@soundtouchjs/core` is pinned to 2.1.1 in the web package and lockfile. The
published tarball, types, Stretch implementation and allocation paths were read
before integration. Its license is MPL-2.0. The unmodified upstream implementation
is available from [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS).
Only `Stretch` and its FIFO are used. The pitch-control engine is not used.

The upstream FIFO may grow beyond its constructor maximum. The adapter rejects
growth before allocation and preallocates two fixed stereo FIFOs. The native
PCM budget reserves both capacities, the upstream three 8 ms overlap arrays
rounded upward, and a 256-frame zero-padding block. Consumer input/output copies
retain their separate reservations. At 48 kHz the processor reservation is
1,547,648 bytes. One global rate applies after Rust's 1x timeline mixing.

At 1x the adapter copies queued PCM without time stretching. Other rates use
the upstream stage. Backpressure bounds pending output-equivalent frames to
two seconds. Reset clears all queues and overlap history before changing rate.
Finish supplies bounded zero padding and trims returned output to the exact
rounded input-frame count divided by rate. Disposal detaches FIFO/padding
buffers and returns the reservation. Priming input counts are not presented as
measured device latency.

## Executed proof

- Three tempo unit tests pass. Their parameter matrix covers 44.1/48 kHz and
  rates 0.25/0.5/1/2/4. Steady-tone pitch stays within the existing five-Hz
  processing tolerance. Output lengths match exactly, 1x output is identical,
  backpressure is bounded, and reset removes old audio. Invalid settings,
  unavailable budget, non-finite input and disposal are covered.
- Four audio decode adapter tests pass alongside those tests.
- Shared derivative/dependency and existing processed-audio suites: two files,
  14 tests pass. Nine authored rate/direction combinations verify contained
  trim offsets and derivative-only render URLs without double-applying rate.
  Stale revisions, wrong source URLs, changed pitch settings and insufficient
  derivative intervals block readiness instead of loading stale output.
- Existing `packages/media/src/processing/audio.bun.test.ts`: two pass,
  72 assertions, 9.97 seconds. Real FFmpeg processing covers sixteen
  rate/pitch/direction combinations and a reversed speech-like chunk seam.
  Existing five-Hz pitch and 100 ms duration tolerances remain unchanged.
- `preview-audio-tempo.spec.ts`: two pass including warmup, 4.9 seconds.
  A real main-thread Play gesture creates/resumes AudioContext. Actual renderer
  WASM mixes float tone blocks, then upstream tempo produces captured output.
  Each 0.5x/1x/2x observation measures 439.453125 Hz from a 440 Hz input. Output
  counts are 96000/48000/24000 at 48 kHz. Reset exposes zero old frames.
  Peak portable reservation is 3,671,936 bytes and every run returns to zero.
  FFT signal detection uses the reference probe's -50 dB floor. Frequency bounds
  remain 430–450 Hz at its 2.9296875-Hz FFT-bin spacing.
- Frozen lockfile installation passes. Existing dependency versions were retained.
- `bun run check`: version/reference gates, formatting, lint, static types and
  all twelve workspace typechecks pass.

Raw browser observations: `audio-tempo.json`. This is digital pre-device browser
capture through AudioBufferSourceNode. Production AudioWorklet output, latency
mapping, long-run synchronization and physical sound remain later acceptance.
