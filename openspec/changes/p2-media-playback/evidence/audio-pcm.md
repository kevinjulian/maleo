# Bounded audio decode and Rust block mixing

Task 4.2 implementation. Output activation and global time stretching remain
tasks 4.3–4.5. No claim of audible device playback is made here.

## Contracts

- `crates/media/src/pcm.rs` mixes original-rate interleaved float windows into
  mono/stereo device-rate blocks. Linear interpolation crosses window boundaries.
  Production gain stays frame-quantized. Source position stays continuous.
- Trimmed music loops use pinned Remotion `calculateMediaDuration`: floor the
  trimmed duration to composition frames, then restart at the source in-point.
  A loop shorter than one composition frame fails explicitly.
- Missing active PCM produces a named buffering error. Silence before a source,
  after a source or after timeline end remains silence. Muted sources need no
  decoded window, but retain their separate full-source readiness requirements.
- Float sums retain headroom above unity until final output. The browser probe
  compares an OfflineAudioContext sum of two 0.75 sources with Rust: both 1.5.
- Native `Budget` reserves a shared 16 MiB working set before allocation.
  The browser adapter reserves retained, flattened and WASM input copies.
  Consumers reserve output copies separately. Release detaches retained PCM.
  Output blocks and decoded windows cannot exceed two seconds.
- `PcmBudget` and `mix_audio` expose portable policy without GPU initialization.
  Native validation rejects malformed windows, unknown/duplicate paths, gaps,
  invalid rates/layouts, non-finite samples and input/output working-set excess.
- Browser workers decode complete Files only. Workers are created after native
  audio grants and terminated before grants return. Abort cancels queued grants
  or terminates active workers. Reserved metadata and source revision must match
  returned PCM. Unsupported sample rates/layouts fail explicitly.

## Executed proof

- Seven native PCM tests pass, including all 111 production gain fixtures,
  sample-rate conversion in both 44.1/48 kHz directions, chunk invariance,
  mono/stereo mapping, overlapping sources, loop trims, silence versus missing
  data, malformed values, exact budget limits and overflow rejection.
- Four focused browser-adapter unit tests pass, covering reservation order,
  consumer release/detachment, changed metadata/revision, Abort, allocation
  rejection and invalid intervals.
- `bun run --cwd apps/web visual --project=visual preview-audio-decode.spec.ts`:
  two passed including warmup, 6.9 seconds. Source network blocked after three
  complete Files loaded. Two impulse tracks decode locally and feed actual
  renderer WASM mixing. Maximum absolute numeric error is
  1.4915713109076023e-9 at 44.1 kHz and zero at 48 kHz, below 1e-5.
- Four concurrent AAC jobs create four actual AudioDecoders. Maximum concurrent
  count is two and final active count is zero. Peak accounted working set is
  1,478,424 bytes. All reservations return to zero. Codec-internal allocations
  are not counted as portable PCM.
- `cargo clippy -p maleo-media --all-targets -- -D warnings`: passed.
- `cargo test -p maleo-media`: 31 passed.
- `bun run check`: version/reference, formatting, lint, static types and all 12
  workspace typechecks passed. An unrelated OpenSpec document required formatting
  before the complete gate passed. No semantic changes were made to that document.
- Renderer WASM builds: 15,020,323 bytes raw, 11,723,939 bytes gzip.
- Editor WASM build and five existing readiness/budget script tests pass under
  the user-approved 700 KiB raw / 270 KiB gzip limits.

Raw browser measurements: `audio-pcm.json`. Full current repository CI and
physical-device sound remain group 7 acceptance work.
