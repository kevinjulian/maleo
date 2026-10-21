# Design

## Context

See `proposal.md` for the problem. This section records the baseline behavior
and subsequent measurements, so each decision can be checked against the source.

**Preview playback.** The editor preview is a Remotion `<Player>` (version
4.0.462) that `VuiRemotionPreview` mounts
(`apps/web/src/components/timeline/remotion-preview.tsx`). The hook
`useRemotionPlayhead` (`apps/web/src/hooks/timeline/use-remotion-playhead.ts`)
owns the transport: `playing`, `seek`, `togglePlay`, and the frame listeners.

**How the Player advances frames.** The Player loop is in
`node_modules/.bun/@remotion+player@4.0.462+*/node_modules/@remotion/player/dist/esm/index.mjs`,
function `usePlayback`, inner function `queueNextFrame`. The loop waits in two
places and does not change the `playing` state while it waits:

1. `context.buffering.current` is true. A media element sets it only when the
   element has `pauseWhenBuffering` (video, audio) or `pauseWhenLoading`
   (`<Img>`). The composition does not set these props explicitly. Installed
   Remotion 4.0.462 defaults `OffthreadVideo.pauseWhenBuffering` to `true`.
2. `sharedAudioContext.getIsResumingAudioContext()` returns a promise. The
   Player creates one shared `AudioContext` and always enables it
   (`audioEnabled: true` is hard-coded). The promise resolves only when
   `AudioContext.getOutputTimestamp()` moves forward. On iOS an `AudioContext`
   can stay "interrupted", and then the promise does not resolve.

A wait in the loop matches the reports: the transport shows "Pause" and the
frame does not move. Task group 1 reproduced the buffering wait on desktop.
The production iPhone cause remains unverified. On 2026-10-18, the user selected
premounting only for the first implementation pass. A subsequent apply request
resumed the remaining tasks. Recovery is tested against blocked media and an
injected audio-clock wait, rather than inferred from fake-player tests.

**How video clips mount.** The composition mounts video at three places. Each
place puts the video inside a Remotion `<Sequence>` whose `from` is the clip
start:

| File                                                 | Sequence                                              | Video element                     |
| ---------------------------------------------------- | ----------------------------------------------------- | --------------------------------- |
| `packages/video/src/compositions/StoryboardReel.tsx` | visual track, `key={\`vt-${i}\`}` (about line 488)    | `SourceVideo` (about line 446)    |
| `packages/video/src/compositions/StoryboardReel.tsx` | video overlays, `key={\`vov-${i}\`}` (about line 758) | `OffthreadVideo` (about line 699) |
| `packages/video/src/scenes/StoryboardScene.tsx`      | scene visual clips (about line 242)                   | `SourceVideo` (about line 187)    |

Line numbers move. Search for the `key` text to find each place.

Before group 2, no `<Sequence>` set `premountFor`, so the `<video>` element did not exist
before the clip's first frame. When it mounts, it requests
`/api/media/<id>`. In production that route answers `302` to a presigned S3 URL
with `cache-control: private, no-store` (`apps/api/src/routes/media.ts`). The
browser then makes range requests and decodes the first frame. All of this
happens after the playhead reaches the clip.

**How generated video is stored.** `persist` in
`packages/media/src/generation/impl.ts` measures the provider MP4 and stores the
file without changes (`putMedia`). It writes no poster. The import pipeline
(`packages/media/src/processing/run.ts`) is different. It converts uploads to
H.264 with `-movflags +faststart` and writes a 320 px PNG thumbnail. Generated
video does not go through the import pipeline.

**How the job result reaches the API.** The media worker records the stored
object in its SQLite job table (`packages/media/src/generation/store.ts`, columns
`storage_key`, `storage_hash`, `storage_size`, `storage_content_type`). The
worker HTTP response (`packages/media/src/worker.ts`) returns these columns. The
API client maps them to `MediaJob.stored`
(`packages/media/src/api/client.ts`, `packages/media/src/api/types.ts`).
`generateVideo` (`apps/api/src/lib/generation/video-generator.ts`) registers
the object with `registerMediaObject` and returns `generatedVideoSchema`
(`packages/shared/src/video-generation.ts`): `url`, `durationSec`,
`providerId`, `model`.

**How the thumbnail is chosen.** `MediaClipView` in
`apps/web/src/components/timeline/timeline-lane.tsx` ignores `asset.thumb` for a
generated video, because the spec requires the generated video's first frame,
not the input scene image. It then renders `VideoPoster`
(`apps/web/src/components/timeline/media/media-thumb.tsx`). Commit `484c28fc`
added a `#t=0.001` fragment to that element so iOS Safari paints the first
frame.

## Goals / Non-Goals

**Goals:**

- The playhead does not stop at the start of a video clip on desktop. The
  budget is in `specs/preview-media-readiness/spec.md`.
- Playback on iPhone does not freeze permanently at a video clip.
- New generated videos start quickly in a browser and have a server-made poster.
- An intern can prove each step with a command or a recorded measurement.

**Non-Goals:**

- Reprocessing generated videos that exist before this change. They keep the
  original file and the live first-frame thumbnail.
- Replacing Remotion `<Player>` with another preview engine.
- Changing the exported render. `premountFor` has no effect during a render.
- Caching presigned URLs across mounts. The `no-store` redirect adds one round
  trip for each mount. Premount hides that round trip. Revisit only if the
  measurement shows it still matters.
- A poster for clips that the chat agent places (`animate_scene` in
  `apps/api/src/modules/agents/core/tools/visual/animate-scene.ts`). Those
  clips travel as storyboard video overlays (`document.ts`), and a new field
  there changes the storyboard document contract. They still get the faststart
  file, premount, and stall recovery, and they keep the live first-frame
  thumbnail. Propose a separate change for the agent poster.
- Turning on `pauseWhenBuffering`. It makes the Player wait on purpose, and the
  goal is to not wait.

## Decisions

### D1. Measure first, with a committed probe

Write `apps/web/perf/video-clip-stall.spec.ts` in the existing `perf`
Playwright project. It reuses the HAR replay that
`apps/web/perf/playback-cost.spec.ts` uses, injects one video clip into the
fixture storyboard, serves the MP4 through `context.route` with a fixed delay,
and samples the playhead `transform` on each animation frame. It reports the
longest time the playhead does not move.

The test makes its MP4 at run time with `ffmpeg` (`testsrc` plus a sine tone,
5 seconds, `-movflags +faststart`) in the Playwright output directory. It skips
with a clear message when `ffmpeg` is not on `PATH`.

- Rejected: commit a binary MP4 fixture. The repository avoids committed media,
  and `ffmpeg` is already a development requirement for the media worker.
- Rejected: measure only by hand in a browser. The `timeline-render-budget`
  spec records why a number without a harness is lost at the next change.

### D2. Premount video sequences for 2 seconds

Add `premountFor={PREVIEW_PREMOUNT_FRAMES}` to the three `<Sequence>` elements in
the table above, only when the clip is a video. Define the constant once in
`packages/video/src/components/SourceVideo.tsx` as
`export const VIDEO_PREMOUNT_SEC = 2` and convert it with the composition `fps`
at each call site (`Math.round(VIDEO_PREMOUNT_SEC * fps)`).

Remotion premount mounts the sequence early, hides it, and calls `.load()` on
the media element (`useMediaBuffering` in `remotion/dist/esm/index.mjs`). The
media element then has data when the clip starts.

- Rejected: premount all sequences. Images and text are cheap and already
  appear on time. Premount of every sequence adds hidden DOM and decoders for
  no gain. Phones have few hardware decoders.
- Rejected: a hidden preload `<video>` pool outside Remotion. It duplicates
  what `premountFor` does, and Remotion would not reuse that element.
- Rejected: 1 second or 5 seconds. One second is shorter than a cold 302 +
  range + decode on a phone network. Five seconds keeps two or three videos
  mounted at the same time in a dense timeline. Two seconds is the starting
  value. Task 2.4 records the measurement that confirms it.

### D3. Stall recovery in `useRemotionPlayhead`

The hook already receives each `frameupdate`. Add a watchdog to the same effect:

- Keep the last frame and the time it changed (`performance.now()`).
- Every 250 ms, while `player.isPlaying()` is true, compare. When the frame did
  not change for `STALL_MS = 1500`, call `player.pause()` and then
  `player.play()` on the next animation frame. Count the attempt.
- After `MAX_RECOVERIES = 2` attempts on the same frame, call `player.pause()`
  and set a new returned value `stalled: true`. Clear it on the next `play`,
  `seek`, or frame change.
- Reset the timer on `play`, `seek`, and `pause`. Do not run before the first
  `frameupdate`. Do not run when the frame is the last frame.

Commit the pause with React's `flushSync` before scheduling the next-frame play.
Without that commit, the Player's pause effect can suspend audio after the
restart, leaving the clock stalled. `play()` retries the shared AudioContext
resume. A browser test freezes its output timestamp until the next resume and
asserts that the frame clock advances automatically. Pause/play does not make
unavailable media ready: a second browser test holds the media response, proves
the two-attempt limit and notice, then releases the response and resumes through
the transport. Production iPhone behavior still needs a real-device check.

Manual Play forwards its React click event to `player.play(event)` from the
shared transport's capture handler. Installed Remotion 4.0.462 uses this event
to start its shared audio tags during user interaction. Its documentation
recommends capture for Safari. Timed recovery calls `play()` without an event.
This corrects a missing integration step, but does not identify the cause of
the reported iOS failure. A working poster does not prove video decoding.

The timeline stage shows a notice when `stalled` is true. Put it in
`apps/web/src/components/timeline/timeline-stage.tsx` above the preview, as an
element with `role="status"`. Text: "Preview cannot play this clip. Press Play to
try again." The two studio surfaces that also use the hook
(`timeline-template-panel.tsx`, `motion-studio-modal.tsx`) get the recovery
without a notice. They read only the fields they use now.

- Rejected: a timeout inside Remotion through `patch-package`. A patch of a
  minified dependency breaks at each upgrade and nobody sees it.
- Rejected: reload the Player (`key` change). That loses the player state and
  re-fetches all media. That is the stall we want to remove.
- Rejected: hide the stall without a notice. When the media cannot play, the
  operator must know. Silent restarts would loop forever.

### D4. Faststart conversion and poster in the media worker

Add `prepareGeneratedVideo(input, directory, signal)` to
`packages/media/src/providers/video-output.ts`. It returns
`{ video: string; poster: string | null }`:

1. Run `ffprobe` through the existing `probeImportedMedia` result (already
   available from `measureGeneratedVideo`). When the video codec is `h264`, run
   `ffmpeg -i input -map 0 -c copy -movflags +faststart output.mp4`. This
   rewrites the container only and takes milliseconds. Otherwise transcode with
   the same video arguments that `processing/run.ts` uses (`libx264`,
   `-preset veryfast`, `-crf 20`, `-pix_fmt yuv420p`, `aac` audio,
   `-movflags +faststart`).
2. Run `ffmpeg -frames:v 1 -vf scale=640:640:force_original_aspect_ratio=decrease`
   to write `poster.jpg` (JPEG quality `-q:v 3`). Use 640 px, not 320 px: the
   preview stage shows the poster at full size before the video paints.
3. Measure the output again with `measureGeneratedVideo`. Refuse the result when
   the duration differs from the input by more than 0.1 seconds.
4. When step 2 fails, log the error and return `poster: null`. Cancellation
   always throws. Test poster failure with valid video and a blocked JPEG output
   path. Zero-frame input remains invalid and must fail validation. When step 1 or 3
   fails, throw. A video that does not play is worse than a late failure.

Use `runMediaCommand` and `MEDIA_INPUT_OPTIONS` from
`packages/media/src/processing/probe.ts` for every command. They fix the argv,
limit the input formats, and enforce the abort signal.

In `persist` (`packages/media/src/generation/impl.ts`), call
`prepareGeneratedVideo` for `.mp4` output, store the prepared video as now, and
store the poster with `putMedia({ kind: "image", contentType: "image/jpeg" })`.

- Rejected: always transcode. A provider H.264 file loses quality on a second
  encode and the worker spends seconds of CPU for each clip.
- Rejected: send generated video through the import pipeline. That pipeline
  downloads from the API and needs an import request and a project. Generation
  runs in the worker before a project media row exists.
- Rejected: make the poster in the browser and upload it. iOS does not decode
  the frame reliably, which is the problem this change removes.

### D5. Carry the poster through the job and the API

- `store.ts`: add four nullable columns `poster_storage_key`,
  `poster_storage_hash`, `poster_storage_size`, `poster_storage_content_type`.
  Use the `ALTER TABLE jobs ADD COLUMN` pattern that the file already uses for
  the `storage_*` columns. Add `poster?: StoredMedia` to the `markDone` meta.
- `worker.ts`: return the four columns in the job response, next to the
  `storage_*` columns.
- `api/client.ts` and `api/types.ts`: map them to `MediaJob.poster` with the same
  shape as `stored`.
- `video-generator.ts`: when `job.poster` exists, check that its key starts with
  `workspaces/<workspace>/image/` and its content type is `image/jpeg`. Register
  it with `registerMediaObject({ kind: "image" })`. Return
  `posterUrl: mediaObjectUrl(id)`. When the check fails, throw, as the code does
  now for `stored`.
- `video-generation.ts`: add `posterUrl: z.string().min(1).optional()`.
- Web: add an optional `poster?: string` field to `MediaAsset`
  (`packages/shared/src/editor/scope.ts`). The field holds only a server-made
  frame of this video. `seedForGeneratedVideo`
  (`apps/web/src/models/timeline/media-seeds.ts`) accepts `poster` and copies
  it to the asset. `animateScene` in
  `apps/web/src/hooks/timeline/use-scene-generation.ts` passes
  `result.posterUrl`. In `timeline-lane.tsx`, a generated video shows
  `asset.poster` when it exists. Otherwise it renders `VideoPoster`, as now.
  The media browser tile (`media-browser.tsx`) uses `poster` as the `<video>`
  `poster` attribute when `thumb` is absent.

  The Rust editor engine (`crates/editor-core/src/execute.rs`) stores media
  assets as untyped JSON values and reads only `id` and `url`. A new optional
  field passes through it without a Rust change.

- Rejected: put the poster in `thumb`. Agent-placed clips already store the
  input scene image in `thumb` (`apply-agent-job.ts` passes `v.thumb`). Both
  values are `/api/media/<uuid>` URLs, so the lane cannot tell a poster from a
  scene image. The existing spec forbids the scene image as the thumbnail.
- Rejected: a separate poster endpoint that the browser calls later. It adds a
  request per clip and a second ownership check. The poster is known when the
  job finishes.

## Risks / Trade-offs

- [The measured cause is not the mount-time load] → Task group 1 records the
  stall before any fix and checks which Player wait is active. If premount does
  not bring the stall under budget, task 2.5 tells the implementer to stop and
  report the measurement. Do not tune the constants until the numbers pass.
- [Premount keeps more decoders alive on phones] → Only video sequences
  premount, and only 2 seconds early. Task 2.6 checks a timeline with two
  adjacent video clips on the mobile project.
- [The watchdog restarts playback during a slow but healthy load] → It acts only
  after 1.5 seconds without a frame change, and at most two times. Healthy
  premounted playback does not reach that limit. The unit tests cover pause,
  seek, the last frame, and the first frame.
- [Remux changes the file the provider returned] → The duration check refuses a
  result that changed length. `-c copy` does not re-encode. The video codec
  check keeps the transcode path for non-H.264 output only.
- [Poster extraction adds worker time] → One frame decode, below 1 second for a
  short clip. A failure does not fail the generation.
- [Desktop WebKit is not iOS] → The probe runs on Chromium. The iPhone result
  needs a manual check on a real device. Task 5.2 records it.

## Migration Plan

1. Deploy the media worker and the API together. The new job columns are
   nullable, and an older API ignores them. A newer API with an older worker sees
   no poster and still returns a valid result.
2. Deploy the web app. It reads `posterUrl` when it exists and falls back
   otherwise.
3. Rollback: revert the web app first, then the worker and the API. The new
   columns can stay. They are unused after a revert.
4. No backfill. Existing generated videos keep their files.
