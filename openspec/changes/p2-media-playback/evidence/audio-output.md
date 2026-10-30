# Main-thread activation and bounded AudioWorklet output

Task 4.4 adds `audio-output.ts`, `audio-worklet.ts` and their typed protocol.
AudioContext is created only by the explicit activation function, which resumes
before any module-loading await. A failed activation closes the context.

Transferred stereo blocks share the native PCM budget. Main-thread credits and
worklet validation independently enforce at most two seconds of queued output.
The main-thread adapter waits for asynchronous reservations before transfer and
rechecks generation. Consumer acknowledgements release reservations only after
consumption or an acknowledged flush. Disposal waits for pending reservations,
closes the context and then releases retained blocks.

The worklet reports actual consumed frame pairs and their AudioContext render
frame. Valid silence advances position. An underrun produces silence without
advancing that position. Flush clears the queue and resets the generation's
sample counter. Platform suspension triggers a fresh generation. Resuming the
context does not issue Play. Processor failure retains a named error.

## Executed proof

- Five focused output/worklet tests pass. They cover activation rejection,
  two-second backpressure, stale generation rejection, delayed reservation
  disposal, suspension, named errors, exact samples, intentional silence and
  underrun counters.
- All four audio adapter suites pass: twelve tests total.
- `preview-audio-output.spec.ts`: two pass including warmup, 5.1 seconds.
  No AudioContext exists before the real Play button. Actual renderer WASM
  mixes a positive/silent/negative pattern, the tempo adapter passes it at 1x,
  and the real worklet consumes transferred buffers.
- A test-only wrapper captures the worklet's actual output. It observes 4096
  positive samples, 4096 silent samples, then 4096 negative samples. The output
  counter advances through all 12288 frames. All three accepted buffers detach.
- A paused two-second queue accepts exactly its capacity and refuses another
  frame. Seek flush removes the queued 0.9 signal. An actual AudioContext
  suspension flushes the queued 0.75 signal. Capture finds neither stale signal.
  Fresh Play after user-gesture Resume produces exactly 512 samples of 0.125.
- Peak accounted PCM is 2,315,648 bytes. Disposal returns it to zero and closes
  the real context. A forced resume rejection also closes its real context.
  This tests the rejection path, not every browser's autoplay-policy decision.
- `bun run check`: version/reference gates, formatting, lint, static types and
  all twelve workspace typechecks pass.

Raw results: `audio-output.json`. The capture wrapper loads a Blob of the real
bundled worklet with observation code. This permits Playwright interception of
the module text without changing production processor behavior. Capture storage
is test instrumentation and is outside portable PCM accounting. It records
digital graph output, not physical-device sound or end-to-end device latency.
