# Native render host (group 3)

Recorded on macOS (Apple Silicon, Metal backend), local checkout.

## 3.1 `crates/render-host` and `maleo-render`

Files: `crates/render-host/src/{job,frames,progress,main,lib}.rs`, `tests/host_frames.rs`. Workspace:
member `crates/render-host`, profile `render-host` (opt-level 3, thin LTO), dev opt-level 3 for the
crate. The CLI takes a job file instead of the flags in the first design draft. Design E4 is updated.

- Job: storyboard, media URL to local path map, even sides 16–4096, fps in (0, 120], frames ≥ 1.
  Unknown fields are refused. Every media path must be a file.
- Frame path: `render_frames` draws `0..frames` in order with `Renderer::draw`. Two readback
  slots alternate, so frame `n + 1` is composed while frame `n` is copied. Zero-alpha colour is
  cleared as `Gpu::render` does. A non-empty coverage report stops the run before the sink.
  `VideoSupply` supplies video frames (FFmpeg in task 3.2).
- `render` refuses any storyboard whose `coverage::project` is not empty, with exit 2, before it
  creates the GPU or any output. Output is written to `<out>.partial` and renamed on success.

| Command                                                                               | Result                             |
| ------------------------------------------------------------------------------------- | ---------------------------------- |
| `cargo test -p maleo-render-host` (first run, crate unoptimized)                      | 12 passed, 1214.6 s.               |
| same, with `[profile.dev.package.maleo-render-host] opt-level = 3`                    | 12 passed, 138.9 s (148.3 s wall). |
| `cargo clippy -p maleo-render-host --all-targets -- -D warnings`, `cargo fmt --check` | Clean.                             |

The tests:

- `host_frames_meet_the_corpus_thresholds`: 17 cases (backgrounds, captions, camera, transitions,
  effects, mask, blend, reveal, decoration, two video cases, composition, shapes, combined
  project). Every frame from 0 to the last compared frame goes through `render_frames` in order.
  Compared frames meet the manifest's frame and region thresholds, with no lowered values.
- An uncovered frame reaches no sink. Cancellation stops within one frame.
- The binary refuses a `lower-third` storyboard with exit 2,
  `"refused":"frame 15 cannot be exported: textOverlays[0] \`lower-third\` preset"`, and no output
  or partial file.
- The binary writes 12 raw frames (12 x 32 x 32 x 4 bytes) and reports `loading`, 12 `rendering`
  lines, then `{"done":true,"frames":12}`. A bad job exits 1 with stage `job`.

Not yet exercised: the lavapipe backend. The host uses `Gpu::new`, which honours `WGPU_BACKEND`.
The run on lavapipe in the render-worker image is task 3.3.

## 3.2 FFmpeg decode and encode

Files: `crates/render-host/src/{ffmpeg,video,audio,encode,cancel}.rs`, `main.rs` (MP4 is the
default format), `tests/host_ffmpeg.rs`. New dependency: `signal-hook =0.3.18` (SIGTERM and SIGINT
as a flag). `maleo-media` moved from dev-dependencies to dependencies.

- Video: one FFmpeg process per placement writes every frame as raw RGBA in presentation order.
  `ffprobe` packet times give the timestamps, and rotation swaps the display size. A request takes
  the nearest presentation time, with ties going to the later frame. A backward request starts
  a new process with an accurate input seek.
- Audio: `audio_requests::project` gives the mix. Each source decodes once to 48 kHz stereo f32.
  For each one-second block, only the windows `pcm::requests` names are passed to
  `pcm::mix_into`, so the 16 MiB working set holds. Windows that overlap at a loop seam are merged.
  The mix is written as f32le beside the output.
- Encode: one FFmpeg process. Video arrives as RGB, premultiplied over black. Settings:
  `-c:v $MALEO_RENDER_H264_ENCODER` (default `libopenh264`), 8 Mbit/s per 1080p, GOP 2 s,
  `yuv420p`, AAC 192 kbit/s, `-t frames/fps`, `+faststart`. FFmpeg's muxer writes the AAC priming
  as the edit list. The host fails at stage `encoder` before it draws a frame if the encoder is
  missing.
- Scratch: `<out>.partial` and `<out>.audio.f32` are removed unless the run succeeds. SIGTERM
  is checked between frames and mix blocks. Child processes are killed when their owners drop.

| Command                                                                               | Result                                        |
| ------------------------------------------------------------------------------------- | --------------------------------------------- |
| `cargo test -p maleo-render-host --test host_ffmpeg -- --nocapture`                   | 4 passed.                                     |
| `cargo test -p maleo-render-host`                                                     | 20 passed (8 unit, 4 FFmpeg, 8 frame/binary). |
| `cargo clippy -p maleo-render-host --all-targets -- -D warnings`, `cargo fmt --check` | Clean.                                        |

Measurements (local FFmpeg 8.1, a GPL build without `libopenh264`, so the tests used `libx264`):

- Real media export, 3 s at 30 fps, 320x192. The storyboard places a 12 fps video with embedded
  AAC impulses at 0.5 s and an impulse WAV sound effect at 2.2 s. Result: 90 decoded video frames,
  video stream 3.000 s, audio onsets `[0.5, 1.5, 2.2]` s (exact at 48 kHz). Phases: `loading`,
  `mixing`, 90 `rendering` lines, `finishing`.
- SIGTERM during a 3000-frame 1080x1920 run: exit 143 after 48.5 ms, a `cancelled` event, and no
  output, partial or audio file.
- A video URL that maps to a non-video file: exit 1, stage `media`, the message names
  `media/broken.mp4`, and no output.
- `MALEO_RENDER_H264_ENCODER=no-such-encoder`: exit 1 at stage `encoder` before any `rendering`
  line.

Open: `libopenh264` itself has not been exercised. The render-worker image (task 3.3) carries it and
must run the same checks.

## 3.3 Render-worker image layer

Files: `Dockerfile` (stages `render-host`, `ffmpeg-lgpl`, `runtime-base`; `runtime` now builds
`FROM runtime-base`), `scripts/check-ffmpeg-lgpl.sh`, `THIRD_PARTY_NOTICES.md` (Render host
media libraries). Docker Desktop 29.8.1, linux/arm64, 2 CPUs, 2 GB, started with the user's
approval on 2026-11-07. The full `runtime` stage (workspace install, Chromium) was not built on
this machine. `runtime-base` holds everything 3.3 adds.

- `render-host`: `rust:1.98.1-slim-bookworm` (the runtime base is bookworm, glibc 2.36;
  `rust:1.98.1-slim` is trixie, glibc 2.41). `cargo build --profile render-host`: 3 m 38 s.
- `ffmpeg-lgpl`: OpenH264 v2.4.1 built from the tagged source (SHA-256 `8ffbe944…`) for linking.
  FFmpeg 7.1.1 (SHA-256 `733984395e…`) configured `--enable-shared --disable-static
  --enable-libopenh264`, without `--enable-gpl` or `--enable-nonfree`, with zlib. The library is
  then replaced by Cisco's prebuilt `libopenh264-2.4.1` for `TARGETARCH` (amd64 `ca413853…`,
  arm64 `cf37063a…`). Compile time is about 5.5 min.
- Gate: `check-ffmpeg-lgpl /opt/ffmpeg-lgpl/bin/ffmpeg` passes and prints `ok, ... is LGPL with
  libopenh264`. A PNG decoder must also exist.
- `runtime-base`: Mesa lavapipe from bookworm-backports (25.0.7-2~bpo12+1), `/opt/ffmpeg-lgpl`,
  `/usr/local/bin/maleo-render`, and environment `MALEO_RENDER_HOST`, `MALEO_FFMPEG`,
  `MALEO_FFPROBE`, `MALEO_RENDER_H264_ENCODER=libopenh264`, `WGPU_BACKEND=vulkan`. A build step
  checks that the binary loads and reports a missing job as exit 1. The API and media worker keep
  Debian's `ffmpeg`.

Defects found and fixed while getting this to pass:

1. Bookworm's Mesa 22.3 lavapipe refused vello's shaders:
   `Shader requires capability Capabilities(SHADER_FLOAT16_IN_FLOAT32)`. Mesa now comes from
   bookworm-backports. CI uses Ubuntu's newer Mesa, so the golden gate did not show this.
2. The first LGPL build had no zlib, so it had no PNG encoder or decoder. `zlib1g-dev` is added
   and the gate checks the PNG decoder.
3. The first sanity step `a && b; test $? -eq 1` passed even when `a` failed. The step is
   rewritten so the grep can fail the build.

Gate failure (an actual image build that installs Debian's GPL `ffmpeg` and runs the same check):

```text
check-ffmpeg-lgpl: /usr/bin/ffmpeg is built with --enable-gpl
check-ffmpeg-lgpl: /usr/bin/ffmpeg is built without --enable-libopenh264
check-ffmpeg-lgpl: /usr/bin/ffmpeg has no libopenh264 encoder
check-ffmpeg-lgpl: /usr/bin/ffmpeg does not report the LGPL
ERROR: process "/bin/sh -c check-ffmpeg-lgpl /usr/bin/ffmpeg" did not complete successfully: exit code: 1
```

The same script also refuses the local Homebrew FFmpeg 8.1 for the same four reasons. The image
build was not repeated with GPL turned on in the `ffmpeg-lgpl` stage itself, which would cost
another FFmpeg compile. Both the gate and the stage use the same script.

`maleo-render` in the image on a corpus case (lavapipe, `libopenh264`). The corpus is mounted
read-only and media paths come from the case. Frames are extracted with the local FFmpeg and
scored with the golden metric against the Remotion references:

| Case                                                      | Exit | Output                                                            | Wall time | Frame SSIM vs reference                     |
| --------------------------------------------------------- | ---- | ----------------------------------------------------------------- | --------- | ------------------------------------------- |
| `combined-project` (121 frames, 1080x1920)                | 0    | h264 Constrained Baseline, yuv420p, 121 frames; AAC 48 kHz stereo | 159 s     | 0.9887, 0.9889, 0.9897 (frames 45, 30, 120) |
| `video-scene-transition` (41 frames, FFmpeg video decode) | 0    | h264 Constrained Baseline, 41 frames; AAC 48 kHz stereo           | 4 s       | 0.9983–0.9991 (8 frames)                    |

The job uses the last compared frame + 1 as its length. The worker passes the composition length
(task 3.4). Server video scores 0.998–0.999 where browser export scored 0.9905 on the same case
(task 2.5), so the browser gap in 2.5 lies in browser decoding, not in H.264 encoding.

## 3.4 Render-worker integration

Files: `apps/render-worker/src/{rust-export,rust-host,rust-inputs}.ts`, `worker.ts` (renderer
choice before the backend branch, the Rust path, non-retryable refusal in `tick`), `db.ts`
(`renderer`, `renderer_note`, `shadow_of`; old rows backfilled to `remotion`),
`managed-inputs.ts` (streaming SHA-256 check), `fixtures/render-job.json` (regenerated),
`apps/api/src/routes/internal-media.ts` (`x-maleo-sha256` header), host command
`maleo-render media`. Tests: `src/rust-inputs.bun.test.ts`, `src/rust-host.bun.test.ts`,
`tests/rust-export.isolated.ts` (own process), `tests/fixtures/fake-render-host.ts`, API
`src/routes/internal-media.bun.test.ts`, two new cases in `managed-inputs.bun.test.ts`.

Choice: with `MALEO_EXPORT_RENDERER=rust`, a `storyboard-*` job on the local backend renders
through Rust when `maleo-render coverage` is empty. Otherwise it renders on Remotion and
`renderer_note` says why: product preset, Lambda, the coverage reason, or an unavailable host.
Output size comes from the composition aspect. Frames are
`max(1, ceil(storyboardSeconds * 30))`, as Remotion's `calculateMetadata` computes them.

| Check                                                               | Result                                                                                                                                                                                             |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completion (fake host, real ffmpeg poster, local storage)           | `done`, `renderer: rust`, progress 1, output and poster stored. The host received local files for the public-base image and voiceover, and 1080x1920 at 30 fps for 30 frames. No job file is left. |
| Host failure (`maxAttempts` 1)                                      | `error`, `render host failed at encode: encoder stopped reading`, no output.                                                                                                                       |
| Coverage refusal                                                    | `error` after one attempt (`attempts` 1 of 3); the message names `` `lower-third` preset``.                                                                                                        |
| Cancellation while frames are rendering                             | Status `cancelled` well inside 5 s, nothing stored.                                                                                                                                                |
| Managed input with the wrong SHA-256                                | `error`, `managed render input … failed its SHA-256 check (expected ff…, got 0390…)`. The host never ran.                                                                                          |
| Real `maleo-render` (debug build, local `libx264`) through `tick()` | `done`, `renderer: rust`, poster stored.                                                                                                                                                           |
| `chooseRenderer`                                                    | remotion by default; rust when covered; notes for Lambda, product preset, coverage (`frame 45: textOverlays[0] …`) and a missing host.                                                             |
| Internal media route                                                | `x-maleo-sha256` equals `row.hash`, which equals the SHA-256 of the bytes.                                                                                                                         |

| Command                                                                                                   | Result                                                    |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `bun run --cwd apps/render-worker test:bun`                                                               | 41 pass, 1 skip (MinIO), then 7 pass in the isolated run. |
| `bun test --preload ../../scripts/test-db-guard.ts src/routes/internal-media.bun.test.ts` (in `apps/api`) | 1 pass.                                                   |
| render-worker and API typecheck, `bunx vp check`, `bun run check:references`                              | Clean.                                                    |

Two defects were found while writing the tests. `Bun.spawn` did not pass environment changes made
after process start, so the host now gets `env: { ...process.env }`. URL parsing normalized
`public/../x` before the containment check, so the normalized path is now checked against the
base. The isolated suite exists because `db.ts` opens its database at import, and another
`.bun.test` file in the same process deletes that database.
