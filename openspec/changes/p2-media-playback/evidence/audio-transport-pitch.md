# Reference transport pitch and proposed D6 refinement

Status: measured reference behavior. The user approved this refinement on 2026-10-28.
Tasks 4.2 and 4.3 remain open. No tempo dependency or runtime processor was added.

## Measurement

`apps/web/visual/preview-reference-pitch.spec.ts` mounts the installed Remotion
Player and Audio components with a generated 440 Hz, 48 kHz WAV. A real button
activates playback. An AudioContext analyser reads the actual media element's
output before the device. This is digital browser capture, not physical-device
sound verification.

| Global transport rate | preservesPitch | Measured peak, Hz |
| --------------------- | -------------- | ----------------- |
| 0.5                   | true           | 439.453125        |
| 1                     | true           | 439.453125        |
| 2                     | true           | 439.453125        |
| 2, control            | false          | 878.90625         |

The FFT uses 16384 samples. At 48 kHz its frequency-bin spacing is 2.9296875 Hz.
The test checks active playback, actual element rate, pitch preservation and
frequency bounds. Raw observations are in `reference-audio-pitch.json`.

Verification on 2026-10-28:

- `bun run --cwd apps/web visual --project=visual preview-reference-pitch.spec.ts`:
  two passed, including warmup, in 7.3 seconds.
- `bun run check`: version/reference gates passed, formatting and static checks
  passed with no findings, all 12 workspace typechecks passed.
- `openspec validate p2-media-playback --strict`: valid.
- `git diff --check`: passed.

## Design conflict

D6 requires existing global transport pitch behavior. Task 4.3 prohibits new
processing algorithms and relies on existing processed derivatives. Those
derivatives express authored clip edits. They do not express arbitrary global
transport changes during playback. Plain source resampling would violate the
measured reference behavior.

Existing server processing in `packages/media/src/processing/audio.ts` uses
FFmpeg `atempo` for pitch-preserved authored rates. Reprocessing sources on every
global speed change would introduce server work and new readiness delays into
the local playback path.

## Proposed refinement for approval

Allow an upstream streaming time-stretch processor solely for global transport
pitch preservation. Keep authored rate/reverse edits on validated derivatives.
Keep Rust source mapping and gain mixing authoritative. At 1x, bypass tempo
processing. Apply global rate exactly once. Include processor buffers in the
16 MiB PCM budget and the two-second lookahead. Flush processor state on seek,
rate change, generation change and disposal. Account for processor latency in
consumed output position.

SoundTouchJS is an upstream candidate, not an accepted dependency. Its official
[worklet documentation](https://github.com/cutterbl/SoundTouchJS/blob/master/packages/audio-worklet/README.md)
describes playback-rate compensation for pitch preservation. Before integration,
pin and inspect the selected release, verify licensing and bounded streaming,
and measure captured pitch, latency, reset behavior and memory at 0.5x/1x/2x.
Reject a candidate that cannot meet existing acceptance thresholds. No pitch UI,
custom time-stretch algorithm or acceptance relaxation is proposed.

D6 and task 4.3 now permit this narrow runtime processor. Neither task is marked
complete by this approval.
