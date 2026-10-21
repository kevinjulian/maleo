# Proposal

## Why

The editor preview stops when the playhead reaches a video clip. On desktop
production, playback stops for a short time at the start of the clip and then
continues. On iPhone production, playback stops permanently: the frame does not
move and the transport button continues to show "Pause". Operators cannot
preview a project that contains a generated video clip on a phone.

The likely cause is that each video element starts to load only at the frame
where its clip starts. Before that frame, the element does not exist. Generated
videos make this worse: the API stores the provider file without changes, so
the file can have its index at the end, and the API makes no poster image for
it. The timeline then shows a live first-frame decode as the thumbnail, which
iOS Safari did not paint until commit `484c28fc`.

## What Changes

- The preview loads each video clip before the playhead reaches it. The
  composition mounts video sequences a fixed time early (premount), so the media
  element has data when the clip starts.
- The preview recovers from a stall. When the player reports that it plays but
  the frame does not move for a set time, the editor restarts playback from the
  same frame. This change does not hide a real failure: the editor shows a
  notice when the recovery does not help.
- The media worker prepares each generated video for playback before the API
  publishes it. It writes an H.264 MP4 with the index at the start of the file
  (faststart) and a poster image of the first frame. Uploaded media already gets
  this treatment from the import pipeline.
- The API returns the poster with the generated video. The timeline and the
  media browser show the poster as the thumbnail. The live first-frame decode
  stays as the fallback for clips that have no poster.
- A repeatable measurement shows the longest playback stall at a video clip
  start, before and after the change.

## Capabilities

### New Capabilities

- `preview-media-readiness`: The preview loads media before its clip starts,
  recovers from a stalled frame clock, and has a measured stall budget at clip
  boundaries.

### Modified Capabilities

- `image-to-video-generation`: "Animation returns actual source metadata"
  changes. A generated video is published as a faststart H.264 MP4 with a poster
  image of its first frame, and the thumbnail rule uses that poster.

## Impact

- `packages/video/src/compositions/StoryboardReel.tsx` and
  `packages/video/src/scenes/StoryboardScene.tsx`: video sequences get a premount
  window.
- `apps/web/src/hooks/timeline/use-remotion-playhead.ts`: stall detection and
  recovery.
- `packages/media/src/generation/impl.ts` and
  `packages/media/src/providers/video-output.ts`: faststart conversion and poster
  for generated video.
- `packages/shared/src/video-generation.ts`, `apps/api/src/lib/generation/video-generator.ts`:
  the generated-video result carries an optional poster URL.
- `apps/web/src/models/timeline/media-seeds.ts`,
  `apps/web/src/hooks/timeline/use-scene-generation.ts`,
  `apps/web/src/components/timeline/timeline-lane.tsx`: the poster becomes the
  thumbnail.
- `apps/web/perf/`: a new measurement suite for clip-boundary stalls.
- No new dependency. The media worker image already contains `ffmpeg` and
  `ffprobe`.
- Generated videos that exist before this change keep their original file and
  have no poster. They get the premount and the stall recovery, and they keep
  the live first-frame thumbnail.
