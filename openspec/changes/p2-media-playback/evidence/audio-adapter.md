# Audio adapter completion, position and cleanup

Task 4.5 documents the adapter in `crates/media/README.md` and
`docs/development.md`. It specifies transferred/retained block ownership,
acknowledged release, decoder-worker lifetime, bounded queue capacity, tempo
priming, consumed stereo frame counters, absolute render-frame endpoints,
generation resets, platform timestamps and calibrated latency fallback.

`audio-output.ts::timestamp` explicitly reports unavailable or uninitialized
output timestamps and unavailable latencies as `null`. It includes a
contemporaneous performance time. No guessed device delay is inserted.
The documented formula maps the worklet endpoint back to audible sample frames
and clamps it to consumed output. Timeline clock authority remains task 5.1.

Verification uses the running real worklet, not inferred host-clock movement:

- The positive/silent/negative browser fixture consumes 12288 frame pairs.
  The worklet's reported `renderFrame` equals the absolute endpoint of the last
  negative sample captured from its actual output array.
- Native PCM and browser capture retain the full 4096-frame silent gap.
  Underflow leaves the consumed sample counter fixed. Fresh generation output
  has its own sample counter and never includes queued pre-seek/pre-suspension
  sound.
- Browser evidence records actual context time, output timestamp and reported
  base/output latencies. These are platform estimates, not an acoustic latency
  measurement. Output-time accuracy and long-run A/V synchronization remain
  group 7 acceptance.
- A focused output test verifies the initialized platform pair, explicit missing
  method, zero/uninitialized pair and non-finite latency handling. All five
  output-client tests pass.
- Disposal checks cover pending reservation completion, worklet flush,
  context closure and zero remaining PCM reservations.
- Current four audio suites: thirteen tests pass. The latest real worklet probe
  passes with warmup in 5.7 seconds and verifies captured/render endpoints.
- `bun run check`: version/reference, formatting, lint, static types and all
  twelve workspace typechecks pass.

Raw browser proof is `audio-output.json`. Full editor ownership, browser/device
matrix and physical sound remain unfinished acceptance work.
