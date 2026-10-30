# Design

## Context

See `proposal.md` for motivation and scope. This phase owns platform-grandplan tasks 5.1–5.5.

Observed implementation:

- `crates/preview/src/session.rs` owns the clock, latest-frame scheduler and GPU states. It does not consume the placeholder decoder/audio traits in `adapters.rs`.
- `apps/web/src/preview-worker/worker.ts` loads images and calls renderer WASM. Its image-only supplied set has no full-source readiness or retry model.
- `use-rust-compare.ts` mirrors Remotion transport and measures drift. Normal preview and production export remain Remotion.
- `packages/shared/src/source-interval.ts`, `processed-audio.ts`, `timeline-audio.ts` and `audio-gain.ts` define existing source and sound semantics. The audio-source projection filters inaudible clips, so it cannot provide the full preload inventory.
- `apps/web/src/models/render/export.ts` already uses MediaBunny, pinned to 1.45.0 in the web manifest. Its draft audio graph omits parts of production playback semantics.
- `apps/web/src/api/media.ts` resolves authorized managed media. `services/upload-staging/upload-staging.ts` holds original pending files in OPFS or tab memory.
- TimelineClip is feature-owned. Its pending-upload badge, story and actions sheet provide the existing compact state idiom. Approved TransportControls already accepts `disabled`.

Two existing requirements change deliberately. `preview-runtime` currently derives position from host time alone. `preview-media-readiness` currently preloads video two seconds before its start. Their deltas replace those rules with audio timing and complete-project loading.

## Goals / Non-Goals

**Goals:** Separate complete compressed-source availability from bounded decoding. Keep IO in platform adapters and playback policy in host-free Rust. Make normal and compare preview consume one readiness result without loading renderer WASM in normal mode.

**Non-Goals:** This is not a persistent client store or offline-sync implementation. It does not promise every frame is decoded before Play. Codec checks and an initial sample establish readiness, while later corrupt packets remain runtime failures. It does not add live pitch shifting or arbitrary reverse decoding when existing validated derivatives already express those edits.

## Decisions

### D1. One portable media boundary

Add host-free `crates/media` for source-time requests, request generations, readiness reduction, decoder leases, byte reservations and block-based mixing. `crates/preview` consumes it. Expose the same readiness reducer through the existing editor WASM for normal preview; do not import renderer WASM or create a renderer worker there. Reuse existing ABI conventions and avoid a separate WASM package.

Platform adapters own network, byte storage, codec instances and audio devices. Rust grants decoder leases and byte reservations before adapters allocate or dispatch work. Completion carries source revision, request generation, presentation timestamp and duration. The core accepts or discards completion and releases reservations explicitly.

The editor's readiness reducer is authoritative for the current dependency generation. Compare preview receives that generation and source readiness snapshot; it also checks its own adapter availability before playback. Normal and compare share loading work and local source handles. They do not maintain competing download queues.

Rejected: implementing pool, clock and mixing policy in React or worker JavaScript. That would create another preview implementation for native clients.

The user accepted revised editor WASM size limits on 2026-10-27: 700 KiB raw and
270 KiB gzip. Initial shared-readiness build measured 709094 bytes raw and
267126 bytes gzip. Retain one editor module and enforce these limits in
`scripts/editor-engine.test.ts`. See `evidence/wasm-budget.md` for the original
failure and subsequent verification. Other performance thresholds stay unchanged.

### D2. Inventory comes before visibility and audio filtering

Add a pure shared dependency projection from the authoritative timeline document, its project media records and existing render inputs. Include every placed clip regardless of track visibility, mute or solo. Include narration, music, effects, video audio and current valid reverse/retimed derivatives. Include originals as well as required derivatives. Traverse scene visuals and timeline overlays. Media-free text, shapes and compositions are immediately ready; fonts remain bundled. Ignore unplaced library media and thumbnails that are not render sources.

Identify sources by workspace, project, stable asset identity and revision; unmanaged legacy references use their stable URL plus the current source generation. Never key readiness by an expiring signed URL. Map one source to all consuming clip IDs and the sorted union of required track kinds. A shared video/audio file must validate both kinds regardless of clip order. Changing kind requirements revalidates retained complete bytes. For a scene with several sources, report the least-ready dependency and aggregate progress only when every required total is known.

Source dependencies, not every document edit, determine the generation. Layout, selection and mute changes do not discard valid bytes. Source replacements and changed derivatives do. A processed source whose contract is stale remains a blocker using existing validation; do not generate another derivative automatically.

Rejected: using visible render elements or `timelineAudioSources()` alone. Both can omit sources the user explicitly requires to load.

### D3. Complete local bytes, with no streaming bypass

Start automatic loading when a project opens and when its source set changes. Use the current media resolver and credential rules. Stream complete responses to temporary OPFS files under a separate `preview-media/<session-id>/` namespace, then expose immutable File/Blob handles. Existing complete pending File handles can be leased without copying or deleting upload staging. Data URLs use their existing size validation. Do not persist blob URLs in documents.

Mark a source ready only after EOF, byte-length validation when trustworthy, container/track inspection, and an initial required-track decode. Successful video metadata or a poster is insufficient. Show indeterminate progress if response length is unavailable. Initial probes release decoders before probing the next source; all decoders need not remain open.

Use completed local files for both Rust media adapters and Remotion preview URL resolution. Keep authored URLs unchanged and scope replacement to preview, excluding production and draft export. After readiness, seeks and decoder-cache misses read local bytes. A byte-complete flag followed by continued remote playback is not acceptable.

OPFS stores derived temporary data, not a new durable project model. If OPFS is unavailable, permit a tab-memory backend with a 64 MiB total compressed-byte ceiling. Over-limit or quota failures stay visible and block Play; do not switch to partial streaming. Existing file handles do not count as duplicated memory. Revalidate local handles after reload; never restore readiness from a saved boolean.

Pin referenced bytes for the open session. Release unreferenced files and revoke associated object URLs after their last consumer finishes. Abort project-owned work on workspace/project change, sign-out and disposal. Use per-session storage ownership, so one tab cannot remove another tab's files. Reclaim abandoned session files after ownership is proven absent. Do not delete originals, staged uploads or authored data. Do not log signed URLs or credentials.

Rejected: browser HTTP cache as proof of full residency, downloading all media into arrays, and P3 cross-project persistent cache/deduplication.

### D4. Explicit budgets separate bytes from frames

Initial implementation limits are engineering targets, not measured results:

| Resource                            | Limit / policy                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| Complete-source downloads           | 4 concurrent                                                                                    |
| Video decoders                      | 2 active, excess work queued fairly                                                             |
| Audio decoders                      | 2 active, separate from video leases                                                            |
| Image decode jobs                   | 2 active, queued separately from video slots                                                    |
| Decoded visual bytes                | 256 MiB, including image/video cache and reserved in-flight outputs                             |
| Decoded PCM bytes                   | 16 MiB across decode, mix queue and output queue                                                |
| Scheduled audio lookahead           | At most 2 seconds, further limited by PCM budget                                                |
| Decode request per logical consumer | 1 replaceable latest request; a placement and its prefetch share 1 decoder, earliest time first |

Evict decoded samples by usefulness to current and next requested positions, retaining requested presentation intervals. A source URL alone is not a frame key. Include source revision and presentation interval; simultaneous clips can need different positions. Account for resolution changes and transition overlaps. Close discarded codec samples promptly. Distinguish portable allocations from codec/GPU internal memory in reports; record process-memory peaks separately.

Images use CPU RGBA copies, as D14 requires. Video frames do not: task 7.3 measured the CPU YUV-to-RGBA conversion (2D canvas readback or `VideoFrame.copyTo`) at 18–22 ms per 1080p frame, which capped two 1080p30 sources near 20 decoded frames per second. The user approved a GPU path on 2026-10-29: the video worker transfers each `VideoFrame`, the renderer copies it into an `Rgba8Unorm` texture with `copyExternalImageToTexture` and registers that texture with vello. A frame still reserves its `width × height × 4 × 2` bytes in the visual budget, so the budget and eviction are unchanged. Rotated sources keep the canvas readback, because a transferred frame carries no rotation. Native hosts and the golden corpus keep CPU RGBA. A replaced device loses texture frames; the renderer drops them and the page's pool forgets every cached frame on recovery. Reject an output whose minimum working set cannot fit with a named resource error. Do not silently reduce resolution, omit layers or relax limits. This makes oversize projects diagnosable while keeping frames bounded.

Task 3.4 also bounds image jobs before dimensions are known. Initial image leases
cannot bound opaque bitmap-decoder memory by their placeholder dimensions alone.
Two image jobs prevent an unbounded batch of bitmap decodes. Rust owns this
queue; images still share the existing visual-byte budget and use no video slots.

### D5. Existing source semantics feed video compositing

Use installed MediaBunny for demuxing and WebCodecs-backed sample decoding in a dedicated media worker. Normal mode needs this lightweight media worker, not the renderer worker. Feed complete local Files to sample readers. Use sequential decoding during playback and latest-generation random access after seeks. Source-frame selection must match the pinned production Remotion extractor, including CFR/VFR, nonzero track timestamps, rates, boundary ties and endpoint holds. Derive selection windows from actual sample presentation timestamps and the measured production rule. Keep original sample timestamps distinct from the windows in which those samples are selected. Verify the rule against production frame identifiers before changing adapter selection. Export behavior and all parity thresholds stay unchanged. The user approved this refinement after task 3.5 exposed different source-frame IDs under the former containing-interval policy.

Patch MediaBunny 1.45.0 in place (`patches/mediabunny@1.45.0.patch`, root `patchedDependencies`) instead of upgrading it. The CPU color/alpha merger, which runs only for video with a separate alpha stream, sized frames by padded coded dimensions while `copyTo` copies visible pixels, and it dropped the color frame's color space. Transparent fixtures showed shifted cells and changed colors. The patch uses visible dimensions and keeps `colorSpace` in the source, ESM and CJS entries. Upstream fixed the dimensions in 1.50.0; 1.63.0 still drops `colorSpace`. Export is unaffected: it decodes through Remotion `OffthreadVideo`, not MediaBunny, and the patch touches no other code path. Rejected: upgrading MediaBunny, which also moves the Remotion 4.0.462 studio and timeline-utils dependency and needs its own export proof. When MediaBunny is next upgraded, reduce the patch to the color-space change or drop it once upstream carries it.

A placement and its next-frame prefetch share one video worker and decoder lease. A separate prefetch worker competed for the two decoder slots, made the playing decoder yield and cold-started a worker (reopen, keyframe seek) after every pause or slow-rate seek. The shared client keeps each consumer's newest request, serves the earliest requested time first and cancels per consumer, so stopping a prefetch never closes the placement's decoder. A refused reservation for a superseded request is a cancellation, not a budget failure.

Port the existing `source-interval.ts` mapping to the portable boundary with shared fixtures. Preserve reverse playback through the validated `reverseMedia` source mapping. Preserve scene-held final frames and transition/outgoing timing from the production composition. A forward original must not replace a failed reverse derivative.

Extend renderer media supply from image URL lookup to typed source-frame identity. Pass requested decoded RGBA through the existing visual/compositing pipeline for every video placement. Change coverage only for supported, supplied frames. Unknown options and unsupported media remain reported independently. Add production-reference video cases without loosening current image/composition thresholds.

Rejected: substituting a video's first frame, treating `requestVideoFrameCallback` or poster visibility as WebCodecs proof, and decoding all frames in advance.

### D6. Shared mixing, platform output

Build mix inputs from the same authoritative document/render mapping as current production sound. Use existing pure source/gain helpers as the semantic reference, then port equivalent timing/gain rules to Rust with shared fixture parity. Do not use draft export's reduced clip shape as the contract. Preserve native-audio suppression, volume keyframes, fades, ducking, ambient levels and authored music loops.

Decode audio blocks in the media worker. Rust mixes bounded PCM blocks at the output device sample rate and channel layout. Resample decoded sources consistently before mixing. AudioWorklet consumes bounded transferred blocks with backpressure and reports consumed timeline sample position. Create/resume AudioContext on the main thread from the existing user Play gesture. Use transferable blocks first, avoiding a new cross-origin-isolation requirement. Keep encoding and whole-file offline mixing outside scope.

Lossy audio decoders need pre-roll: a decoder started at a window's first packet produces a wrong first frame (MDCT overlap; MP3 bit reservoir). Each window decodes from 100 ms earlier and keeps only the requested interval. Without this, clicks on 0.25 s window seams lost amplitude or vanished at 1x.

Retimed audio uses existing valid processed derivatives, which play forward at 1x under their source mapping. Distinguish authored source rate from global transport rate. Match existing transport-rate pitch behavior instead of inventing a new pitch control. The user approved an upstream streaming time-stretch processor solely for global transport pitch preservation on 2026-10-28, after the reference probe demonstrated pitch preservation at 0.5x/1x/2x. Bypass that processor at 1x, apply global rate exactly once, compensate its content lead (WSOLA output leads its input by a rate-dependent amount: about +61 ms of timeline at 0.5x and −25 ms at 2x, measured and pinned by `audio-tempo.test.ts`) by feeding the mixer from `position − lead` and trimming the same lead from the end, include all processor buffers in the 16 MiB PCM budget and two-second lookahead, and account for its latency in consumed output position. Flush processor state on seeks, rate changes, generation changes and disposal. Pin and verify the chosen upstream release before integration. Custom time-stretch algorithms and new pitch controls remain outside scope. Muted sources load and validate but contribute no samples. Silence advances the output sample counter, including narration gaps.

### D7. Audio position and media states

When Rust owns audio, derive timeline position from consumed samples and the platform's output-time/latency mapping. Use AudioContext output timestamps where available and a documented measured latency estimate otherwise. Host time schedules work; it cannot drive video ahead of output. Global rate changes, seeks and source changes flush obsolete blocks, advance generation and reanchor audio/video together. A session without audio output retains the existing host clock. Once audio owns the clock, silent gaps do not switch ownership.

Use these state transitions:

```text
loading --> ready --> playing --> paused
   |                     |
 failed              buffering --> playing
                         |
                       stalled --> paused with recovery notice
```

Media changes revoke readiness and pause both outputs. Completion enables Play without restarting. A decoder underrun from already-local bytes can resume automatically only while the same Play intent remains active. User Pause cancels that intent. A seek replaces its generation and preserves whether playback was active before the seek. Use the existing 1.5-second stall threshold and at most two recovery attempts. GPU loss also pauses audio; recovery redraws/revalidates before playback can resume under unchanged intent. Permanent failures require explicit Retry or existing media replacement/removal actions. No placeholder playback bypass exists.

### D8. One gate for every preview start path

Apply the readiness check in the common transport command, not only its disabled button. Cover Space/K, replay, play-from-selection, editor/studio transport consumers that accept media, and programmatic player starts. Pause remains available while playing. An attempted start during loading neither queues autoplay nor advances the playhead. Paused scrubbing can draw placeholders and request local frames.

Normal preview keeps Remotion's transport, consumes local byte URLs and shared readiness, and does not load renderer WASM. Compare mode defaults to reference audio. Add an explicit diagnostic audio-owner selection within the existing compare panel using canonical controls. Selecting Rust mutes reference audio first; only Rust's output drives its clock. Remotion stays a visual reference and a drift measurement. Dispose restores normal ownership and prevents duplicate sound.

### D9. Clip loading uses existing presentation owners

Screen/states: project timeline and media-bearing studio timelines, queued/loading/validating/ready/failed, plus unavailable Play. TimelineClip remains feature-owned. Extend its existing pending-media badge contract with distinct preview-download labels. Preserve import/upload state independently; show the earliest blocking phase without claiming upload progress means preview bytes are ready.

Use the current compact icon/progress-line geometry, semantic status/error roles and named icon steps. Show `Loading 40%`, `Checking media`, `Ready` or a named failure. Narrow bars keep an accessible icon when the line does not fit. Ready can use a compact check indicator rather than permanent text on every clip. Retry belongs in reachable clip actions and the phone actions sheet, not in a nested button on the draggable clip. Use existing approved Progress/Note/Button primitives where needed. Extend the existing clip badge story and documented contract before wiring production consumers. No shared TimelineClip wrapper or new UI pattern is required.

TransportControls uses its existing disabled prop. A nearby status explains remaining clips or failure; do not depend on a disabled control's tooltip. Preserve pane shares, minimum sizes, timeline gestures, selection, undo, focus and overlay ownership. Verify desktop and 320px with keyboard, pointer and coarse touch.

### D10. Proof separates availability, decoding and output timing

Keep checked evidence in this change's `evidence/` during apply. Planning creates no result files. Use deterministic generated media with visible frame IDs and known PCM impulses, recording fixture commands, hashes, browser/backend, device and output sample rate.

Required target measurements:

- Full-readiness fixture: later, hidden and muted sources delayed independently. No playback start or output before completion. Disable network after readiness; play, seek and revisit evicted decoded frames without source fetches.
- Existing delayed response: record 800 ms delay before/after. Report load wait separately; accepted playback retains the 250 ms maximum stall gate.
- A 60-second 1080p30 fixture with two video sources and narration/music: report readiness duration, decoded/presented frame counts, dropped frames, frame-time p50/p95, seek latency, decoder counts, source bytes, decoded reservations and process-memory peak. Target at most 1% dropped frames at 1x on the named desktop Chromium/WebGPU acceptance machine. Complex pre-existing renderer workloads retain separate limits.
- Latest-seek fixture: 100 rapid seeks with delayed out-of-order completions. No obsolete frame/audio after generation change; all portable budgets hold.
- Output timing: a 10-minute marker fixture at transport rates 0.5x, 1x and 2x, including pauses, seeks and rate changes. Absolute audiovisual offset target is p95 at most 50 ms and maximum 100 ms after each transition settles. Measure settling separately with a 250 ms target from local data. Test authored source rates 0.25x and 4x independently, so source rate is not confused with transport rate.
- Audio: compare portable PCM/gain fixtures against existing production semantics. Pin a numerical tolerance before accepting results and retain existing processed-audio pitch tolerances. Exercise output capture and actual user Play. Model clocks alone do not prove sound.

Run Chromium and supported WebKit/Safari adapter capability probes against actual codecs before claiming support. Physical iPhone play, sound, suspension and memory behavior require device evidence; emulation cannot establish them. If a required target fails, record the blocker and fix it or revise the change explicitly. Never loosen a threshold silently.

## Risks / Trade-offs

- [All muted/hidden sources block Play] -> This is the confirmed policy. Show the responsible clip and reachable Retry/removal/replacement actions.
- [Long projects need complete original files] -> Stream to OPFS, report byte progress and quota failures, and keep editing available. Do not mislabel the wait as a decoder stall.
- [Successful first sample misses later corruption] -> Report runtime source failures and coordinate audio/video recovery. Full predecode is deliberately excluded.
- [Browser codec/device differences] -> Probe actual tracks, record the tested matrix and keep unsupported sources blocked. No alternate renderer is added.
- [CPU copies or complex scenes miss performance targets] -> Measure copies and rendering separately before proposing zero-copy or quality changes.
- [Normal and compare ownership diverges] -> Share readiness generation and local handles, keep one audible owner, and test cancellation plus return to normal preview.
- [Temporary private media remains after a crash] -> Session-scoped files, explicit disposal/sign-out cleanup and safe orphan reclamation; preserve upload staging and other live tabs.

## Migration Plan

No authored schema or database migration is required. Land shared contracts and fixtures, local byte loading, video rendering, audio output, then transport/clip UI. Complete normal-preview and compare acceptance before declaring the phase done. Update owning docs and roadmap evidence during apply; do not mark export or preview-cutover milestones complete.

Rollback removes the runtime gate/adapters and restores previous preview code. Temporary preview cache is disposable and cannot be referenced from persisted documents. Keep Remotion production export unchanged throughout. No archive, commit, deployment or production mutation is part of proposal creation.
