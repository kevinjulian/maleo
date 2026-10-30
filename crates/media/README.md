# Portable media policy

`maleo-media` performs no IO. Hosts project authored dependencies through
`packages/shared/src/preview-media-dependencies.ts` before track filtering.
`readiness::Readiness` accepts that projection and returns source requests plus
per-clip readiness. The editor and preview must use this same reducer.

Source identity is project/workspace scoped. Managed sources use immutable media
IDs. Imported originals carry their imported revision. Unmanaged sources use
their authored stable URL and a host-supplied source generation. Signed fetch
URLs must not replace these identities. Every source declares its consumers and the union of required track kinds.
A file shared by video and audio clips must validate both kinds, independent of
clip order. Changing required kinds revalidates retained complete bytes.
Malformed projections leave current state intact.

Changing source bytes advances dependency generation. Complete sources with the
same revision remain ready. In-progress requests receive the new generation.
Changing only layout, mute, visibility or clip membership retains valid bytes.
Requests carry dependency generation, source identity, revision and Retry attempt.
Obsolete completions have no effect. Retry preserves successful siblings.
Explicit local-source invalidation uses the current request identity and increments
its attempt before marking it failed. Late failures cannot invalidate a later Retry.

The host must prove EOF, complete byte length when known, local readability,
track validation and initial decode before submitting Ready. Metadata and partial
reads cannot establish readiness. A later codec failure must be reported through
the playback runtime. Decoder leases and output clocks are separate from byte
readiness. The reducer does not fetch, decode, play or persist readiness.

```sh
cargo test -p maleo-media
cargo clippy -p maleo-media --all-targets -- -D warnings
```

## Source timing

`timing` owns source intervals, window slicing, retiming, source position,
scene-selected source duration, exclusive-endpoint frame holds and validated
reverse-derivative resolution. Editor-core forwards its existing timing API to
this module and preserves its public error type. Hosts pass typed source revision
and derivative metadata; an invalid reverse derivative never falls back to its
forward original.

`tests/fixtures/timing.json` is shared with
`packages/shared/src/media-timing-fixtures.test.ts`. It covers 115 production
TypeScript reference cases at 0.25x through 4x, nonzero in-points, splits, trims,
scene holds, reverse derivatives and stale/missing source rejection. Native
numeric comparison uses absolute error at most 1e-12 for these timing fixtures;
audio PCM has its separate tolerance. SourceVideo consumes the shared hold helper
so the browser reference and portable boundary retain the same final source frame.

## Decoder and visual resources

`decoder::Decoders` grants host-wide slots across owners: two video decoders and
two audio decoders. Transparent video requests both video slots atomically.
Requests queue fairly within each kind, including requests for both slots.
`should_yield` tells persistent adapters that another owner is waiting; they
finish their active request, close codecs and return the grant before requeuing.
Returning another
owner's lease has no effect. Close an owner only after its codec instances close
or its worker terminates. The editor WASM exposes this broker for normal probes
and adapter routing; normal mode does not load renderer WASM.

`visual_pool::VisualPool` separately tracks decoded CPU RGBA and in-flight
reservations against 256 MiB. It grants at most two active video requests, with
one active and one replaceable latest request per logical placement. Frame keys
include source revision and selection window. Optional `presentation` retains
the original decoded sample interval; image frames omit it. Video supply and
binding require it. Identity validation rejects non-finite or reversed windows
and sample intervals. Production adapters use nearest timestamp selection with
later-frame ties, preserving the stream time base and nonzero first timestamp.
Overlapping placements can
read independent positions in one source. Image reservations use the same byte
budget without consuming a video codec slot.
At most two image jobs run concurrently, including dimension discovery, so tiny
initial reservations cannot admit an unbounded batch of opaque bitmap decodes.

The host retains current/next frame handles and discards returned eviction IDs.
The pool evicts least-recently-used unretained frames. Reserve actual dimensions
before allocating or copying RGBA; resolution changes use `resize`. Its optional
byte reservation also covers temporary copies and must be at least one RGBA frame.
Completion converts that reservation to one cached frame only after temporary
copies are released. Oversize
minimum working sets fail by name. Decoder failures, obsolete results and cancel
release reservations only after host cleanup. `clear` removes cached handles but
keeps active reservations until the host returns their leases.

`MediaPool` in the existing renderer WASM exposes this policy as JSON without
requiring GPU initialization. Browser frame adapters still own codec instances
and buffers. Portable accounting excludes codec/GPU internal allocations, which
need separate process-memory measurements.

## Audio mix inputs and gain

`audio::Mix` is the portable, serializable input to audio mixing. A source names
its render path, URL, frame span, rounded source in-point, effective playback
rate, loop policy, embedded-track status and gain curve. `validate` rejects
duplicate paths, invalid spans, malformed gains and unsupported keyframe values
before sampling. Zero-gain sources contribute no samples. Source loading remains
the separate full-dependency readiness contract, including muted and hidden media.

`crates/renderer/src/audio_requests.rs` projects the production render storyboard.
It reuses existing placement rules and preserves SourceVideo's muted endpoint
hold, direct overlay audio timing, source-extraction suppression and resolved
derivative URLs. Legacy scene, voiceover and music branches retain production
timing. The projection does not decode media or create an output device.

Gain follows `timelineAudioGain`: frame-quantized edge fades, ambient level,
dialogue ducking, volume keys and retained easing ranges. Native gain omits
overlay ducking. Legacy music uses its existing envelope. Narration gaps remain
timeline time, while music gain and source position continue through them.

`bun scripts/audio-mix-fixtures.ts --check` verifies the shared references.
Native tests compare 111 gain cases / 1110 samples and eight document/render
projection cases. The source helpers and production mapping generate these
references; the Rust implementation does not generate its own expected values.

## PCM mixing and working set

`pcm::mix_into` consumes bounded interleaved float windows at their original
sample rates and writes mono/stereo device-rate output. It interpolates between
adjacent source samples, including samples in separate windows. Mono duplicates
to stereo. Stereo averages to mono. Unsupported rates/layouts fail explicitly.
Source timing stays continuous while gain follows composition frames. Music
loops retain the trimmed in-point and Remotion's whole-composition-frame loop
period. Missing required samples return a named buffering error. Muted sources,
leading silence, completed sources and timeline end contribute zero samples.

Float mixing retains headroom above unity. Clipping belongs at final device
output, matching the browser's float graph. This keeps one loud intermediate
source from changing the sum of overlapping sources. The caller must discard
partial output after any error.

`pcm::Budget` accounts for 16 MiB across retained windows, transfer/WASM copies,
mixed output and tempo state. Reserve before allocation. Shrink only
after copies are detached or released. Release follows worker termination or
consumer disposal. Output blocks cannot exceed two seconds. Native block
validation additionally rejects inputs plus output exceeding 16 MiB.

Renderer WASM exposes `PcmBudget` and `mix_audio` without GPU initialization.
Hosts reserve retained/flattened/WASM input copies before supplying PCM and
separately reserve output copies. `mix_audio` runs at 1x timeline rate. D6's
approved upstream pitch-preserving processor runs downstream. Output activation,
ownership and clock integration remain host responsibilities.

`pcm::requests` plans exact local windows from the same continuous source-time
mapping as mixing. It includes interpolation neighbours, splits loop seams and
skips silent or completed intervals. Track metadata comes from complete-source
validation. The adapter checks every decoded window against that metadata.
Adjacent decoder windows may overlap by the interpolation sample; flattening
removes duplicate samples before passing ordered windows to Rust.

The compare worker owns one PCM budget, its source-window jobs and global tempo
processor. It caches the decoder script before accepting input, so later local
seeks do not fetch scripts. Transferred output retains its worker reservation
until acknowledgement. AudioWorklet reservations use that same budget through
typed requests. Closing output precedes worker/File disposal.

## Browser output adapter

The web host creates `createAudioOutput` only from Play activation. Its worklet
consumes stereo float frame pairs after Rust mixing and global tempo processing.
An accepted block transfers ownership. It retains its PCM reservation until a
consumed or flushed acknowledgement. A rejected block remains producer-owned.
Dispose waits for pending reservations and context closure before releasing the
remaining leases. No native decoder lease survives its owning decode worker.

The worklet reports `frames`, the consumed frame count in its current generation,
and `renderFrame`, the AudioContext render-frame endpoint of those samples.
Intentional silent PCM advances `frames`. Underflow silence does not. Flush
clears queued blocks, changes generation and resets `frames`. `renderFrame`
continues on the context's sample clock. Never use host elapsed time as proof
that samples were consumed.

The host's `timestamp()` reports a platform output timestamp pair and the
contemporaneous context/performance times. Missing or uninitialized pairs are
explicit `null`. Base/output latency estimates are separately reported or `null`.
For a valid pair, estimate audible context time at performance time `P` as:

```text
C = min(contextTime, output.contextTime + max(0, (P - output.performanceTime) / 1000))
audibleFrames = clamp(frames - max(0, renderFrame - C * sampleRate), 0, frames)
```

An adapter without that pair must use a calibrated platform latency estimate.
When both reported base/output latency estimates are available, its context-time
estimate is `max(0, contextTime - baseLatency - outputLatency)`. Missing latency
must remain unknown until calibration supplies it. Zero cannot stand for an
unknown device delay. Output and renderer scheduling may use host time, but
audible position cannot advance past consumed frames.

Global tempo priming is an input requirement, not device latency. Buffer that
input before output starts. The audio clock owner anchors audible output frames
to timeline position and applies global rate once through the preview session.
Product ownership controls and long-run synchronization remain separate gates. Digital worklet capture
verifies output samples and render-frame endpoints. It does not establish
physical sound or device latency accuracy.
