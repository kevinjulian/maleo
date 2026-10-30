# Task 4.1 audio mix inputs and portable gain

The host-free `maleo_media::audio` contract owns source frame spans, source
in-points/rates, loop policy, gain modes, volume keys, fades and dialogue ducking.
Validation rejects malformed ranges, duplicate paths, invalid gains and invalid
keyframe metadata before mixing. Source loading/readiness remains independent,
so muted and hidden clips still load all dependencies.

`renderer::audio_requests::project` consumes the full production render
storyboard after the authoritative document mapping. It reuses the existing
scene/timeline/overlay placement functions. Embedded source audio retains exact
paths and extraction suppression. Valid derivative audio arrives at forward 1x
with the mapped source in-point. Missing processed URLs return named errors.
SourceVideo's selected endpoint mutes held base audio; overlay audio retains
direct-OffthreadVideo timing through its outgoing hold.

Reference generation uses existing `timelineAudioSources`, `timelineAudioGain`,
`sampleClipProperty`, `processedAudioSource`, legacy `duckEnvelope`, and
`buildRenderStoryboardFromDoc`. No draft export shape becomes the contract.

Verified reference cases:

- 111 gain cases / 1110 numeric samples across 24/30/60 fps, all five sound
  kinds, constant/keyed gain, six easings, retained ranges, edge fades, default
  and explicit duck depth, absent narration, narration gaps and source rates
  0.25/0.5/1/2/4. Native values agree within 1e-12.
- Eight document/render cases: all sources, muted tracks, hidden tracks,
  music-only isolation through effective mute flags, extracted native sound,
  zero static gain with positive keys, valid processed audio and missing
  processed audio. Fields match the existing TS source/mapping contract.
- Native tests verify music continues during the narration gap without
  shortening source/timeline time, inherited scene gain keys, selected-end mute
  versus overlay timing, and the existing legacy scene/audio/music branches.
- Invalid audio booleans, animation, volume and source metadata return errors
  rather than silently changing the mix.

Commands executed:

```sh
bun scripts/audio-mix-fixtures.ts
bun scripts/audio-mix-fixtures.ts --check
CARGO_INCREMENTAL=0 cargo test -p maleo-media
CARGO_INCREMENTAL=0 cargo test -p maleo-renderer --test audio
CARGO_INCREMENTAL=0 cargo clippy -p maleo-media -p maleo-renderer --all-targets -- -D warnings
bun run typecheck
```

All 24 portable media tests and four renderer audio tests passed. Clippy and
workspace typechecks passed. Incremental compilation was disabled for these
native checks to limit disposable cache growth on the nearly full host disk.
All 106 renderer unit tests also passed. Final `bun run check` passed formatting,
lint/type, version/reference checks and all 12 workspace typechecks. Both WASM
builds passed, followed by the quiet five-test editor/readiness gate. Editor WASM
is 716,650 raw bytes, below the approved 716,800-byte cap. Renderer WASM is
14,956,761 raw / 11,704,457 gzip bytes and remains compare-only.

This task proves projection and gain/timing contracts. PCM decoding, resampling,
block mixing, worklet output and output-clock synchronization remain later
tasks. No browser sound or full-phase acceptance is claimed here.
