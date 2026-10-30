# Portable audio clock authority

Task 5.1 adds `crates/preview/src/audio_clock.rs` and connects it to the existing
Clock and Session. Hosts attach an activated output anchor and publish consumed
frame counts, their render-frame endpoints and platform output timestamps.
The portable model applies the documented latency mapping before global rate.
Without an output timestamp it requires a calibrated latency estimate.

An audio owner holds position without observations, including during priming
or underrun. Silent valid PCM advances exactly like audible material. Host time
cannot advance an attached output. Seeking or a new Play retains ownership but
invalidates prior observations until a fresh generation is attached. Generations
must increase even after explicit detach. Detach preserves position and anchors
the host clock there. Timeline end remains clamped by the existing session.

Outdated observations return false. Malformed observations fail before mutation.
Sample position never exceeds consumed frames, and platform-estimate jitter
cannot move accepted position backwards. `Session::play_audio` validates its
anchor and host time before atomically changing playback. Normal session host
playback remains covered by existing tests. Position reports do not force a
redraw when the composition frame is unchanged.

## Proof

Native tests use fake output observations for host/audio disagreement, silent
gaps and stalls, 0.5x/1x/2x rate application, latency fallback, timestamp clamping,
stale and malformed data, generation invalidation, pause, timeline end and
ownership release. Session tests verify atomic rejection and no redundant redraw.
`cargo test -p maleo-preview` passes 34 tests and strict clippy passes. Renderer
WASM builds at 15,021,075 raw bytes / 11,724,306 gzip bytes. Repository check
passes version/reference, formatting, lint, static types and all twelve
workspace typechecks.
No source gain or mute flag can switch clock ownership: only explicit attach or
detach does so. Actual browser clock routing is the following protocol/ownership
tasks, and long-run physical synchronization remains group 7 acceptance.
