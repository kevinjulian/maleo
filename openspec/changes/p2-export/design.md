# Design

## Context

See `proposal.md` for the reason for this change. The current state that shapes the approach:

- `crates/renderer` draws one frame of the render storyboard with vello on wgpu. `coverage::report(storyboard, frame, fps, has_media)` reads the storyboard for one frame on the CPU. The renderer does no IO. The host supplies images and decoded video frames.
- `crates/renderer-wasm` exports the preview session to the preview worker. The session has `seek`, `tick`, `video_requests`, `put_video` and `cache_video_frame`. It also has GPU-free entry points: `project_audio`, `audio_requests` and `mix_audio`. These produce the production audio mix as device-rate float blocks.
- The browser already decodes video through MediaBunny 1.45.0 in `apps/web/src/services/preview-media/video-worker.ts`. A bounded decoder pool and a 256 MiB decoded-frame budget are in place.
- `apps/web/src/models/render/export.ts` is a canvas 2D draft. It draws images with camera motion and plain captions, mixes audio in an `OfflineAudioContext`, and muxes through MediaBunny.
- `apps/render-worker` is a Bun/Hono server over a SQLite job queue. `runJob` validates, materializes managed inputs (`managed-inputs.ts`), prepares raw storyboards (TTS, images, caption alignment), then renders with Remotion locally or on Lambda. It stores the output in S3 and extracts a poster. Statuses are `queued`, `running`, `done`, `done_with_fallback`, `error` and `cancelled`.
- `apps/api/src/lib/render-media-preflight.ts` blocks server export on `pending` or `failed` manifest entries.
- The golden gate already runs the native renderer on Mesa lavapipe in CI (`WGPU_BACKEND=vulkan`).
- The runtime image is `oven/bun:1.3.1`. Rust stages exist only for WASM builds (`editor-engine` and `renderer-engine` in `Dockerfile`).

## Goals / Non-Goals

**Goals:**

- One drawing path for export: the browser and the server call the same `maleo-renderer` frame function and the same `audio_requests::project` mix.
- Deterministic export: frame `n` is drawn at time `n / fps` after every media item for that frame is supplied. Wall-clock time has no effect on the output.
- A server path that needs no GPU and no Chromium, and that keeps the existing job contract.
- Evidence that is recorded before authority moves, and a rollback that is one setting.

**Non-Goals:**

- Faster-than-Remotion server renders. The phase measures throughput and records it, but speed is not an acceptance gate.
- Changing storyboard preparation (TTS, image generation, caption alignment). The Rust path starts after preparation and uses its output unchanged.
- Remotion Lambda parity for Rust. A job that asks for `lambda` renders on Remotion while Remotion exists.

## Decisions

### E1. Whole-project coverage is a CPU walk over every frame

A new `coverage::project(storyboard, fps, duration_frames)` calls `coverage::inspect` for each frame index. It returns the first problem for each unsupported element with its first time. Media presence is not part of eligibility: the walk passes `has_media = true`, and preflight owns availability. The walk runs on the CPU and needs no GPU. Two hosts expose it:

- renderer-wasm, as a GPU-free export like `project_audio`. The editor loads the renderer module when the export menu opens. A normal editor load still does not fetch it.
- the native host, as `maleo-render coverage`.

Rejected: sample frames (for example one per second). A one-frame effect between samples would pass. The roadmap requires an empty report for every frame.

Rejected: a coverage flag stored on the project. The storyboard changes with every edit, and a stored flag goes stale.

### E2. Browser export is a paused-session export loop in the preview worker

The export runs in a dedicated export worker with its own `OffscreenCanvas` and its own renderer session at output size. The live preview session is not reused. For each frame index:

1. `seek(n / fps)`.
2. Read `video_requests`. Decode the requested frames through the existing MediaBunny video worker code and supply them with `cache_video_frame` and `bind_video`.
3. Repeat step 2 until the requests are empty.
4. `tick`, then wait for the GPU to finish.
5. Wrap the canvas in a `VideoFrame` with timestamp `n / fps`. Pass it to a MediaBunny `VideoSampleSource` with H.264.

Audio comes from `project_audio` and `mix_audio` in blocks at 48 kHz stereo. Source windows come from `audio_requests` and are decoded through the existing audio worker code. The blocks go to a MediaBunny `AudioSampleSource` with AAC. The output is `Mp4OutputFormat` into a `BufferTarget`. Preflight refuses an export whose estimated file is larger than 512 MiB and offers server export instead (task 2.4).

AAC encoders prepend priming samples, and neither WebCodecs nor MediaBunny reports or signals them. Without a signal, every player starts the audio that late (44 ms with the macOS encoder). The export worker measures the priming once per export: it sends one impulse through the same encoder configuration and back through the decoder. After finalize, the worker inserts an `edts/elst` into the sound track whose media time skips the priming. This is the signal that FFmpeg writes. Found during task 2.2.

Rejected: drop the first priming samples of the mix. This also aligns later audio, but it deletes the first tens of milliseconds of authored audio.

The export captures the storyboard JSON at start (spec: editing during export). Encoder support is checked with `VideoEncoder.isConfigSupported` and `AudioEncoder.isConfigSupported` before preflight.

Rejected: reuse the live preview session. Export would fight the preview clock and the preview canvas size, and a seek in the editor would change the export.

Rejected: keep `OfflineAudioContext` mixing. It is a second mixer with different fade and ducking rules. `audio_requests::project` is already the production mix.

Rejected: an encoder in WASM (for example an x264 WASM build). It is a GPL dependency, it is slower than WebCodecs, and it bypasses hardware encoders.

### E3. The draft export is deleted, not kept as a fallback

`export.ts`, `draft-request.ts` and the "fast draft" menu entry are deleted. Ineligible projects and browsers without WebGPU use server export. This follows D16: no fallback renderer.

Rejected: keep the draft for ineligible projects. The draft is a third renderer with a disclosure burden (`render-option-parity`), and server export already serves these projects.

### E4. The native host is one Rust binary, driven over stdio

A new crate `crates/render-host` builds the binary `maleo-render`. The worker spawns it per job:

```text
maleo-render render --job job.json        job: storyboard, media URL->path map, width, height, fps, frames, out
maleo-render coverage --job job.json      whole-project coverage as JSON
stdout: JSON lines {"phase":"rendering","frame":n,"frames":N} ... {"done":true,"frames":N}
stderr: diagnostics      exit 0 ok, 1 failed, 2 refused (coverage), 143 cancelled
SIGTERM: stop within 5 s, remove partial output, exit 143
```

- GPU: `Gpu::new`, the golden test's device setup (`gpu.rs`). `WGPU_BACKEND=vulkan` selects Mesa lavapipe in the image; local runs use Metal. The host builds with its own `render-host` Cargo profile (opt-level 3), because the workspace `release` profile is size-optimized for WASM. The output size texture is read back to RGBA in row-padded buffers. Two readback buffers alternate, so drawing frame `n + 1` overlaps with the copy of frame `n`.
- Media: images decode in process through the `image` crate (already a dev dependency, promoted). Video decodes through an FFmpeg subprocess per source that writes raw RGBA at the requested times. The host keeps the nearest-PTS selection rules from `FrameIdentity` (`crates/renderer/AGENTS.md`). Audio sources decode to 48 kHz float PCM through FFmpeg, then mix through `maleo_media::audio` and `audio_requests::project`.
- Encode: one FFmpeg subprocess reads raw RGBA video on stdin and float PCM from a named pipe. It encodes with `libopenh264` and the native `aac` encoder, then muxes MP4 with `+faststart`.
- Media access: the worker already materializes managed inputs. The worker writes each source to a job directory and passes a URL-to-path map in the job JSON. The host never makes a network request.

Rejected: N-API or WASM inside Bun. A crash in the native renderer or the GPU driver would take down the worker process and its queue. A subprocess also makes cancellation a signal.

Rejected: FFmpeg linked as a library (`ffmpeg-next`). Dynamic linking ties the host build to the image's FFmpeg ABI. The subprocess boundary keeps the LGPL obligation clear and lets the FFmpeg pin change without a Rust rebuild.

### E5. FFmpeg is a pinned LGPL shared build with OpenH264

The render-worker image installs a pinned FFmpeg LGPL shared build. The configuration has no `--enable-gpl` and no `--enable-nonfree`, and has `--enable-libopenh264`. The image also installs Cisco's prebuilt OpenH264 binary of the matching version, because Cisco's binary carries Cisco's patent license. A build check runs `ffmpeg -buildconf` and fails the image build if GPL is on or OpenH264 is missing. Third-party notices name both. The default encode settings are a constant bitrate of 8 Mbit/s for 1080p (scaled by pixel count), a GOP of 2 s and the High profile where OpenH264 supports it. The comparison measures bitrate and quality against Remotion output.

Rejected: GPL FFmpeg with libx264. This was user-decided against: it conflicts with D13.

Rejected: Remotion's bundled FFmpeg. It leaves with Remotion in P6.

### E6. Job records carry `renderer`, and shadow jobs are separate rows

`render_jobs` gets two columns:

- `renderer` (`remotion` or `rust`), chosen when the job starts from `MALEO_EXPORT_RENDERER` and eligibility.
- `shadow_of` (nullable job ID).

A shadow job is a normal row with `shadow_of` set. Every operator-facing query (`/jobs`, `/jobs/query`, project status, Video collection and charges) excludes rows with `shadow_of` set. The queue leases a shadow job only when no job with `shadow_of IS NULL` is queued. A shadow job reads the authoritative job's prepare manifest and materialized inputs, so TTS and image generation do not run twice.

A shadow job runs the other renderer: Rust while authority is `remotion`, and Remotion while authority is `rust`. The second direction continues the comparison after the switch at no extra code cost. `MALEO_EXPORT_SHADOW=off` turns shadow runs off.

Rejected: run both renderers inside one job. The job status would mix two outcomes, and a slow shadow would delay the operator's output.

### E7. Comparison runs in the worker and stores one row per pair

After a shadow job ends, the worker runs a comparison and writes a `render_comparisons` row. The row holds the job pair, the configuration version, pass or fail, per-criterion scores, the artifact paths and the explanation fields (`cause`, `resolution`, `explained_by`, `explained_at`). The comparison does this:

1. It probes both files with `ffprobe` for size, frame rate, frame count and duration.
2. It extracts the sampled frames through FFmpeg as PNG at the sample times from the prepared storyboard: scene starts, transition midpoints and each whole second.
3. It scores full-frame SSIM with the scorer the golden test uses, exposed by `maleo-render compare-frames`.
4. It decodes both audio tracks to 48 kHz mono float. It compares loudness per 100 ms window and the onset of each audio clip from `audio_requests::project`.

The configuration is `apps/render-worker/comparison.json`, versioned, with a `lowered` list in the format of the corpus manifest. The initial thresholds:

| Criterion           | Initial value                                                             |
| ------------------- | ------------------------------------------------------------------------- |
| frame SSIM          | the corpus `thresholds.frame` minus an encoding allowance set by task 4.2 |
| durations           | equal within one frame                                                    |
| loudness per window | within 1.5 dB where the reference is above −50 dBFS                       |
| clip onset          | within one frame                                                          |

Task 4.2 sets the encoding allowance from a calibration. The calibration measures Remotion against a Remotion re-encode of its own output. The allowance is that measured loss plus a margin, recorded with its reason. Artifacts of failed comparisons go to the worker's `out/comparisons/<id>/`, which is kept for 30 days. Passing comparisons keep only their scores.

An authenticated worker route `GET /comparisons/report` returns the window report: start, job count, pass and fail counts, unexplained divergences, and the ineligible share with its reasons. `POST /comparisons/:id/explain` records an explanation. The API exposes both to instance administrators.

Rejected: compare in CI only. CI has only synthetic media. The roadmap asks for production jobs.

### E8. Authority setting and window bookkeeping

`MALEO_EXPORT_RENDERER` is read when a job starts. The window start is the later of two times: the first comparison, and the deployment of the latest Rust fix that resolved a divergence. That deployment is recorded when the explanation names a `rust-fix` resolution and its commit. The report computes the window from that start. The operator switches by changing the env value and redeploying. The switch decision and the report are recorded in the phase evidence. The setting is not enforced in code: the report states whether the switch is allowed, and the operator acts on it.

Rejected: an automatic switch when the window closes. Authority is an operator decision with a rollback, and an automatic flip removes the review step.

### E9. Preflight is shared and runs before encoding

Browser preflight runs in this order: encoder support, eligibility (E1), manifest blockers, then a fetch of every used `ready` and `external` entry. The fetch reuses the preview's complete-source loader (`p2-media-playback` group 2), which already holds complete local bytes in session OPFS files. Each `ready` entry is checked against its manifest size and SHA-256 with `crypto.subtle.digest`, one file at a time, so peak memory is the largest single source. The loaded files then serve decoding, so media is fetched once. No new hash library is added. Server preflight keeps `renderMediaBlockers`. The worker then checks the SHA-256 of each materialized input before the Rust host runs.

## Risks / Trade-offs

- [lavapipe is slow at 1080p for long videos] → Measure frames per second on the production host in task 3.5 and record it beside the Remotion render time. Readback double-buffering keeps the CPU busy. If the measured time exceeds the job timeout, the timeout scales with frame count. A hardware GPU stays a later option behind the same host.
- [OpenH264 quality per bitrate is below x264] → Fixed bitrate scaled by pixel count. The comparison reports bitrate and SSIM. The encoding allowance is calibrated, not guessed.
- [WebCodecs H.264 encode is missing on some browsers, for example Firefox on Linux] → Probe with `isConfigSupported` and offer server export. Do not add a WASM encoder (E2).
- [Browser memory on long exports] → `BufferTarget` with a size estimate, and a refusal above 512 MiB that offers server export instead. A `StreamTarget` over the File System Access API was planned and dropped in task 2.4, for two reasons. The audio edit list rewrites the finished file, which a stream cannot do. The save picker also needs the click's user gesture, but the gesture has expired once preflight finishes. At 8 Mbit/s, the limit allows about 8 minutes of 1080p.
- [Shadow renders double the worker load] → Shadow jobs run only on an idle queue, and `MALEO_EXPORT_SHADOW=off` stops them without a deploy rollback.
- [Encoded comparisons hide small renderer drift] → The golden gate stays the precise check. Production comparison finds integration faults: media timing, audio mix and encode settings.
- [Image size grows with Mesa and FFmpeg] → One extra layer in the render-worker image only. The API and web images are unchanged.

## Migration Plan

1. Land eligibility, browser export and the native host behind the default `MALEO_EXPORT_RENDERER=remotion`. Browser export replaces the draft for eligible projects at once, because it produces no server job and has no authority effect.
2. Deploy the render-worker image with Mesa, FFmpeg LGPL, OpenH264 and `maleo-render`. Turn on shadow runs.
3. Observe for at least 14 days and 50 compared jobs. Explain every divergence.
4. When the report allows the switch, set `MALEO_EXPORT_RENDERER=rust` and redeploy. Record the report and the decision.
5. Rollback: set `MALEO_EXPORT_RENDERER=remotion` and redeploy. No data changes. Browser export rollback is a revert of the web change. The draft is not restored. Server export serves every project.

Self-hosted deployments keep `remotion` until their operator switches. `docs/self-hosting.md` documents the setting, the image requirements and the report.

## Open Questions

- Default output bitrate tiers beyond 1080p (for example 4K). They are tuned with the first comparisons, inside E5's scaling rule. The specs and tasks do not change.
- Retention of comparison artifacts beyond 30 days. The value can change in configuration without a spec change.
