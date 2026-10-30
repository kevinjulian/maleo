# Local audio/video recovery

Task 5.3 connects real local audio windows, Rust mixing, bounded global tempo,
AudioWorklet output and the preview clock. The renderer worker owns one PCM
budget. Output reservations share it through typed messages. Play primes local
blocks and waits for native Play acceptance before starting the worklet.
Timestamp observations continue while another decode is pending.

Rust plans source windows from the same continuous source-time mapping as PCM
mixing. Planning includes interpolation neighbours and music loop seams. Complete
source validation supplies primary track metadata, checked again after decode.
Silent embedded video contributes no source. The window adapter drops duplicate
interpolation samples while flattening. Script blobs stay local for offline
replacement workers and seeks. Source removal drops cached File bindings before
acknowledging disposal.

Current-frame misses hold playback. The visual adapter prefetches the next
composition frame without replacing the current binding. Local stalls use the
existing 1.5-second threshold and at most two retries. GPU loss holds position
immediately. Recreation includes the first completed GPU draw within each
1.5-second attempt. Only installed devices can report loss, and generation fences
discard late devices and old draw completions. Current visual requests are
revalidated before Rust audio resumes. Pause cancels playback intent even while
device recreation continues. Source changes require fresh Play. Platform
suspension closes output and requires a fresh gesture.

The offline pixel regression exposed an earlier broker ordering race: yield can
arrive before the grant Promise callback. The video client now retains that
yield, serves one frame, terminates its codec worker and returns the slot. The
new focused regression checks this ordering. Original pixel assertions and
decoder ceilings remain unchanged.

## Verification

- Native media: 33 tests. Native preview: 39 tests. Strict clippy passed.
- Adapter, client and recovery tests: 17 files / 70 passing tests.
- `preview-audio-mix.spec.ts` uses actual validated Files and Rust source plans
  offline. Output lengths at 0.5x/1x/2x are 100800/50400/25200 frames. Maximum
  1x PCM error is 1.4915713109076023e-9. Peak reservations are 1,871,972 bytes,
  with zero retained after disposal.
- `preview-audio-session.spec.ts` uses real video and audio Files, native mixing,
  transferred worklet blocks, actual captured impulse samples and output-driven
  Rust position. It covers active/paused seeks, source invalidation without
  autoplay, GPU recovery, Pause during recovery, actual context suspension,
  fresh-gesture restart and injected decoder failure. The original failure plus
  two retries ends with closed contexts, paused position and a named error.
  Peak PCM is 2,234,892 bytes, with zero retained after disposal.
- `preview-media-state.spec.ts` delays one actual adapter request past timeout.
  The second attempt succeeds; the late first device returns false. It also
  checks two terminal GPU refusals. Input/position preservation checks remain.
- Offline rendered-media pixels and production compare keyboard controls pass
  without changing their expected frames or missing-media coverage.
- Latest combined session/state/video command passed five tests including
  warmup. `bun run check` passed version/reference, formatting, lint, static
  types and all twelve workspace typechecks. Renderer WASM is 15,125,370 raw
  bytes / 11,756,197 gzip bytes; its worker is 123,990 bytes.

These are software output and boundary measurements. Physical latency,
long-running audiovisual offset, desktop load/drop acceptance and physical
iPhone behavior remain group 7 gates. Product audio ownership controls belong
to task 5.4.
