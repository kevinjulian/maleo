# Tasks

Read `proposal.md`, `design.md`, and both files under `specs/` before you start.
Read `AGENTS.md` at the repository root, `apps/web/AGENTS.md`,
`packages/video/AGENTS.md`, and `packages/media/AGENTS.md`.

Rules for every task:

- Do the tasks in order. Group 1 must pass before you change any behaviour.
- Write the test first. Run it and see it fail. Then write the code.
- Tick a box only when its proof passes. Paste the proof (command and the
  relevant output lines) under the task as an indented note.
- When a proof fails and you cannot see why, stop and ask. Do not change a
  threshold in the spec to make a test pass.
- Run `bun run typecheck` after each group. Run `bunx vp check` before each
  commit. Commit each group as its own `fix:`, `feat:`, `perf:`, or `test:`
  commit on `main`.

## 1. Measure the stall before any fix

- [x] 1.1 Create `apps/web/perf/video-clip-stall.spec.ts`. Copy the setup from
      `apps/web/perf/playback-cost.spec.ts`: `replayApi(context, HAR)`, the
      `addInitScript` fetch wrapper that edits
      `detail.storyboards[0].storyboard_json`, and `page.goto(\`/content/${FIXTURE_PROJECT_ID}\`)`.
  In the fetch wrapper, append one clip to `clips`:
  `{ id: "video:900", type: "video", startSec: 3, durationSec: 3, track: 0, video: { id: 900, kind: "video", start: 3, dur: 3, track: 0, url: location.origin + "/stall-probe.mp4", sourceDurationSec: 5, volume: 1 } }`.
  Proof: the test opens the editor and a video clip shows on the timeline in the
  Playwright trace (`bunx playwright test --project=perf -g "video clip stall" --trace on`).
  - Proof (2026-10-18): `bun run --cwd apps/web perf -- -g "video clip stall" --trace on`
    exited 0, `2 passed (17.1s)` (warmup plus expected budget failure).
    Trace: `apps/web/visual/.output/video-clip-stall-video-clip-stall-perf/trace.zip`.
- [x] 1.2 In the same file, add a `test.beforeAll` that writes a 5-second MP4
      with `ffmpeg -f lavfi -i testsrc=size=640x360:rate=30 -f lavfi -i sine=frequency=440 -t 5 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart <outputDir>/stall-probe.mp4`
      (use `node:child_process` `execFileSync`, and `testInfo.outputPath`). Call
      `test.skip(true, "ffmpeg is required")` when `ffmpeg` is not on `PATH`. Serve
      the file with `context.route("**/stall-probe.mp4*", ...)`. Wait
      `Number(process.env.STALL_PROBE_DELAY_MS ?? 800)` milliseconds before
      `route.fulfill` with `content-type: video/mp4`.
      Proof: the test log shows one request for `stall-probe.mp4` and the delay.
  - Proof: runtime ffmpeg fixture generated successfully. Log:
    `STALL_REQUEST {"delayMs":800,"url":"http://127.0.0.1:3031/stall-probe.mp4"}`.
    Chromium issued three requests for this URL during the run.
- [x] 1.3 Measure. Click `.tl2-timeline [data-transport='play']`. On each
      animation frame for 7 seconds, read the playhead
      `[data-vui-slot='playhead']` `translateX` value and the time. Compute the
      longest interval where the value does not change. Print one line
      `STALL {"worstMs":...,"atPx":...,"transport":"<aria-label of the play button>"}`.
      Add `expect(worstMs).toBeLessThanOrEqual(250)` and mark that assertion
      `test.fail()` for now, with a comment that task 2.4 removes the mark.
      Proof: `bun run --cwd apps/web perf -- -g "video clip stall"` prints a `STALL`
      line. Record the value here as the baseline.
  - Baseline (same command, diagnostics removed):
    `STALL {"worstMs":1002,"atPx":108,"transport":"Pause","moved":true,"decodedFrames":94}`.
    The movement and decoded-frame assertions passed. Only the 250 ms budget
    assertion is an expected failure, as required before task 2.4.
- [x] 1.4 Find which Player wait is active (design.md, Context, items 1 and 2).
      Add a temporary `page.addInitScript` that wraps `AudioContext.prototype.resume`
      and logs each call with `performance.now()`. Run the probe once with the wrap
      and read the log around the stall. Remove the wrap after the run. Write one
      paragraph in this task's note that names the wait you saw, with the log lines.
      Proof: the note exists and quotes the log lines.
  - Proof: temporary wrappers of `AudioContext.resume` and `suspend` recorded
    `{"action":"suspend","at":7294.799999952316,"state":"running","time":3.072}`
    with stack `Object.suspend -> queueNextFrame -> callback`, followed by
    `{"at":8109.599999964237,"state":"suspended","time":3.072}` at resume.
    This run reported `STALL {"worstMs":992,"atPx":108,"transport":"Pause","moved":true}`.
    The installed Player calls suspend from queueNextFrame's buffering branch.
    Thus the desktop reproduction entered the buffering wait. This does not
    identify the production iPhone cause. Both temporary wrappers were removed.
  - Design issue: installed Remotion 4.0.462 `OffthreadVideo` passes
    `pauseWhenBuffering: pauseWhenBuffering ?? true`. Design Context assumes
    neither media element enables buffering. D3 also assumes pause/play clears
    both waits, without a reproduction proving this. Resolve before behavior changes.
- [x] 1.5 Commit as `test(web): measure playback stall at a video clip start`.
      Proof: `git log -1 --oneline` shows the commit and `bunx vp check` passes.
  - Proof: `bunx vp check` passes: all 4120 files formatted, no warnings,
    lint errors, or type errors in 2263 files. Formatting fixes are limited to
    change artifacts and one table-padding space in `apps/api/docs/ENV.md`.
    Probe lint (`bunx vp lint apps/web/perf/video-clip-stall.spec.ts`),
    `bun run typecheck`, `bun run check:version`, `bun run check:references`,
    and `openspec validate smooth-video-clip-playback --strict` passed.
    Application behavior is unchanged. Commit: `5c10ba76` with the specified subject.
    On 2026-10-18, the user selected premounting only for the next pass.
    Groups 3 and 4 remain pending. The desktop buffering diagnosis is now
    corrected in design.md, and D3 remains unverified.

## 2. Load video before its clip starts (premount)

- [x] 2.1 In `packages/video/src/components/SourceVideo.tsx`, export
      `VIDEO_PREMOUNT_SEC = 2` and a function
      `videoPremountFrames(fps: number): number` that returns
      `Math.round(VIDEO_PREMOUNT_SEC * fps)`. Add a Vitest test next to the file for
      30 fps (60 frames) and 24 fps (48 frames).
      Proof: `bun run --cwd packages/video test src/components/SourceVideo.test.ts` passes.
  - Proof: the command failed first with `videoPremountFrames is not a function`,
    then passed (1 test) after the helper was implemented.
- [x] 2.2 Add `premountFor` to the three video sequences listed in design.md
      (search for `vt-`, `vov-`, and the scene visual `Sequence` in
      `StoryboardScene.tsx`). Pass `videoPremountFrames(fps)` only when the clip is a
      video (`v.kind === "video"`, `ov.kind === "video"`, `clip.kind === "video"`).
      Pass `undefined` for images. Do not change any other prop.
      Proof: `bun run typecheck` passes, and
      `git diff --stat` shows changes only in these two files and `SourceVideo.tsx`.
  - Proof: `bun run ci` completed `bun run typecheck` successfully across all 12
    workspaces before proceeding to Rust checks. Production playback edits are
    limited to these three files. Test, measurement and changelog changes are
    recorded separately in this group. Existing sequence timing and media props
    are unchanged.
- [x] 2.3 Add a test that renders `StoryboardReel` with one video overlay that
      starts at frame 90, at frame 40 (inside the premount window), in a Remotion
      test harness or with `renderToStaticMarkup` on a `<Thumbnail>`. Assert that a
      `<video>` element exists and is hidden. Check the existing tests in
      `packages/video/src` for a harness before you write a new one.
      Proof: the new test passes and fails when you remove `premountFor`.
  - Proof: `bun run --cwd apps/web test src/components/timeline/video-premount.test.tsx`
    passes (3 tests: overlay, visual timeline, inner scene visual). Each renders
    the real composition through Thumbnail at frame 40. The video is present,
    muted and inside an opacity-zero container. Before the implementation, the
    overlay assertion failed because no video element existed. The harness
    belongs in web, which already depends on Player, rather than adding a
    Player dependency to the video package.
- [x] 2.4 Run the probe from group 1. Remove the `test.fail()` mark.
      Proof: `bun run --cwd apps/web perf -- -g "video clip stall"` passes with
      `worstMs <= 250`. Record the new `STALL` line next to the baseline.
  - Proof: `bun run --cwd apps/web perf -- -g "video clip stall" --trace on`
    exits 0, `3 passed (29.9s)` (warmup, desktop, phone).
    Desktop: `STALL {"worstMs":133,"atPx":0,"transport":"Play","moved":true,"decodedFrames":{"900":93}}`.
    Baseline: 1002 ms at 108 px with 800 ms delay (task 1.3).
    The sampler now excludes paused/ended playback, which otherwise incorrectly
    counted time after the timeline ended. The baseline's stall was during
    playback at 108 px. The expected-failure mark is removed.
- [x] 2.5 Decision point. If 2.4 does not pass, stop. Do not tune
      `VIDEO_PREMOUNT_SEC`. Write the baseline, the new value, and the result of task
      1.4 in this note, and ask the reviewer. Proof: either 2.4 passed, or the note
      exists and the reviewer answered.
  - Proof: task 2.4 passed at 133 ms. The premount window remains 2 seconds.
- [x] 2.6 Check the phone layout. Run the probe again with
      `STALL_PROBE_DELAY_MS=1500` and the iPhone 15 device descriptor
      (`test.use({ ...devices["iPhone 15"], defaultBrowserType: "chromium" })` in a
      second `test.describe`). Add a second video clip that starts 0.5 seconds after
      the first one ends.
      Proof: both clips play and `worstMs <= 250`. Record the line.
  - Proof: the same command runs the phone describe with iPhone 15's viewport,
    user agent, touch, mobile and scale settings on perf's Chromium engine.
    Playwright prohibits overriding worker-scoped defaultBrowserType inside
    describe, so the engine is inherited from the project. Request logs show
    1500 ms delay for both URLs. The second clip starts at 6.5 seconds.
    Phone: `STALL {"worstMs":165,"atPx":108,"transport":"Play","moved":true,"decodedFrames":{"900":97,"901":100}}`.
- [x] 2.7 Check that the export does not change. Render the fixture storyboard
      with one video clip before and after the change through the render worker
      (`bun run render-worker`, then the render request that
      `apps/render-worker/AGENTS.md` documents). Compare frame 0, the first frame of
      the clip, and the last frame with `ffmpeg -i a.mp4 -i b.mp4 -lavfi psnr -f null -`.
      Proof: PSNR is `inf` or above 50 dB for each compared frame. Paste the output.
  - Proof: `bun /tmp/maleo-premount-proof.ts before` and `after` submitted
    the same six-second fixture to isolated render workers at :18091 through
    `POST /render`, preset `storyboard-wide`, local backend. The fixture contains
    a three-second video at 3 seconds. Both jobs reached `done`.
    Baseline job: `e54903e0-bedf-4bef-a04e-e0b02632bf64`.
    Updated job: `d92b6322-f6c7-42dc-b10b-a90e371d80bf`.
    The file endpoint returned an error because output_path was null, so the
    generated MP4s were read from each isolated local managed store instead.
    Copies: `/tmp/maleo-premount-proof/before.mp4` and `after.mp4`.
    ffmpeg select + psnr output for frames 0, 90 and 179, independently:
    `PSNR y:inf u:inf v:inf average:inf min:inf max:inf` for every frame.
    Workers and the temporary source server stopped after rendering. No real
    workspace database or storage was used.
- [x] 2.8 Add a `CHANGELOG.md` entry under `Unreleased`: "Preview playback no
      longer pauses at the start of a video clip. The preview loads each video 2
      seconds before its clip starts." Commit as
      `fix(video): load video clips before the playhead reaches them`.
      Proof: `bunx vp check` passes and `git log -1 --oneline` shows the commit.
  - Changelog describes loading 2 seconds early to reduce clip-boundary pauses.
    It does not claim the unverified production iPhone freeze is fixed.
    Full-CI status and the isolated browser rerun are recorded under 5.1.
  - Proof: `bunx vp check` passes (4122 formatted files, no warnings, lint or
    type errors in 2265 files). Version, reference and strict change validation
    also pass. Commit uses the specified subject on main, without a push.

## 3. Recover a stalled preview

- [x] 3.1 In `apps/web/src/hooks/timeline/use-remotion-playhead.test.tsx`, add
      tests with the existing `fakePlayer`. Give the fake a way to emit
      `frameupdate` with a frame number. Use fake timers (`vi.useFakeTimers`) and
      mock `performance.now`. Cover each case:
  1. playing, frame unchanged for 1500 ms: the player gets `pause` then `play`.
  2. after two recoveries on the same frame: the player gets `pause` and
     `stalled` is `true`.
  3. the frame changes after a recovery: `stalled` stays `false` and the counter
     resets.
  4. paused for 5000 ms: no call and `stalled` is `false`.
  5. a `seek` during playback resets the timer.
  6. no `frameupdate` yet: no call.
  7. the frame is the last frame: no call.
     Proof: `bun run --cwd apps/web test src/hooks/timeline/use-remotion-playhead.test.tsx`
     shows the new tests failing.
  - Proof: the command initially reported `7 failed | 3 passed (10)` before
    implementation. It now passes 13 hook tests, including exact 1500 ms timing
    and clearing a reported stall on play, seek and frame progress.
- [x] 3.2 Implement the watchdog in
      `apps/web/src/hooks/timeline/use-remotion-playhead.ts` as design.md D3
      describes. Put `STALL_MS = 1500`, `STALL_CHECK_MS = 250`, and
      `MAX_RECOVERIES = 2` as named constants at the top of the file. Add
      `stalled: boolean` to the `RemotionPlayhead` interface. Clear the interval in
      the effect cleanup.
      Proof: the tests from 3.1 pass, and the existing tests in the file still pass.
  - Proof: the hook suite passes. Attempts survive internal pause/play events,
    intervals and pending animation frames are cleaned up, and a user seek or
    play cancels a pending restart. A real audio-clock test exposed a pause
    commit race, fixed with `flushSync` before the next-frame resume.
- [x] 3.3 Return `stalled` from `usePreviewComposition`
      (`apps/web/src/hooks/timeline/use-preview-composition.ts`) and show the notice
      in `apps/web/src/components/timeline/timeline-stage.tsx`: an element with
      `role="status"` and the text from design.md D3, above the preview. Style it
      with existing design-system tokens (see `apps/web/AGENTS.md`), no new colours.
      Add a happy-dom test that renders the stage with `stalled: true` and finds the
      status text, and one with `stalled: false` that does not find it.
      Proof: the new test passes and `bun run typecheck` passes.
  - Proof: `bun run --cwd apps/web test src/hooks/timeline/use-remotion-playhead.test.tsx src/components/timeline/timeline-stage.test.tsx`
    passes 15 tests. Notice test failed first for stalled=true, then both
    states passed. The real TimelineStage renders the canonical Note component
    with error tone and role=status above the preview row. No feature CSS or
    new visual tokens were added. `bun run typecheck` passes all workspaces.
- [x] 3.4 Drive it in the app. Run `bun run dev`. In the browser devtools,
      throttle the network to "Slow 4G" and block the request for the clip's media
      URL. Play across the clip.
      Proof: the preview restarts twice, then stops and shows the notice. Unblock the
      URL, press Play, and playback continues. Paste a screenshot path from the
      scratch directory.
  - Proof: the Playwright HAR harness serves the actual web app with isolated
    fixture data instead of editing a real project through the development
    stack. It holds the video response until release, exercising unavailable
    media without a live API. Desktop and 320 px touch-device runs record
    `RECOVERY {"labels":["Pause","Play","Pause","Play","Pause","Play"]}`
    (variant omitted here), show the notice, and prove frame movement resumes
    after release and Play. Desktop retry uses keyboard Space, phone retry
    uses the transport button. Notice sits above the canvas with no horizontal
    overflow. Reviewed screenshots: `/tmp/maleo-preview-recovery/desktop.png`
    and `/tmp/maleo-preview-recovery/phone.png`.
    `bun run --cwd apps/web perf -- -g "preview stall recovery" --trace on`
    reports `4 passed (37.8s)` including warmup and a synthetic audio-clock wait.
    The latter freezes AudioContext output timestamps until the next resume and
    confirms automatic recovery. Its repeated run reported `4 passed (28.2s)`
    (three repetitions plus warmup). This is not a production iPhone test.
    Budget regression run also passed: desktop 79 ms, phone 171 ms.
- [x] 3.5 Add a `CHANGELOG.md` entry: "The preview restarts playback when its
      frame stops moving, and shows a notice when it cannot recover." Commit as
      `fix(web): recover preview playback when the frame stops moving`.
      Proof: `bunx vp check` passes and the commit exists.
  - Proof: `bunx vp check` passes: 4123 formatted files, no warnings, lint or
    type errors in 2266 files. Workspace typechecks, focused tests, layer and
    census checks pass. Changelog updated. Commit uses the specified subject
    on main. Full integration gate remains task 5.1.

## 4. Prepare generated video for playback (faststart and poster)

- [x] 4.1 Write `packages/media/src/providers/video-output.bun.test.ts` (Bun,
      because the code under test uses `Bun.which` and `Bun.file`). Make input files
      with `ffmpeg` in a temporary directory:
  1. H.264 with `moov` at the end (no `-movflags +faststart`).
  2. VP9 in MP4 (`-c:v libvpx-vp9`).
  3. a valid video with a directory at the poster output path to force JPEG write failure.
     For each, call `prepareGeneratedVideo` and assert: the output `moov` box comes
     before `mdat` (read the top-level box types from the file bytes), the codec is
     `h264` (`ffprobe -show_streams`), the duration matches within 0.1 s, and the
     poster is a JPEG whose larger side is at most 640 px. For case 3, assert
     `poster: null` and no throw. Add a case where the output duration differs and
     assert that the function throws. Separately assert that zero-frame video is
     rejected. Cancellation must throw, including during poster extraction.
     Proof: `bun test packages/media/src/providers/video-output.bun.test.ts` fails
     because the function does not exist.
  - Proof: initial run failed with `prepareGeneratedVideo is not a function`.
    User approved replacing the zero-frame poster fixture with valid video plus
    a blocked JPEG output path. Zero-frame rejection remains a separate test.
- [x] 4.2 Implement `prepareGeneratedVideo` in
      `packages/media/src/providers/video-output.ts` as design.md D4 describes. Use
      `runMediaCommand` and `MEDIA_INPUT_OPTIONS` from
      `packages/media/src/processing/probe.ts` for every command. Copy the
      transcode arguments from `packages/media/src/processing/run.ts` (search for
      `libx264`). Do not use a shell.
      Proof: the tests from 4.1 pass.
  - Proof: 7 tests pass with real FFmpeg H.264/VP9 conversion and JPEG extraction.
    A scoped probe spy injects output duration mismatch. Cancellation propagates.
- [x] 4.3 Call it from `persist` in `packages/media/src/generation/impl.ts` for
      `.mp4` output. Store the prepared video with the existing `putMedia` call.
      Store the poster with `putMedia({ workspace, kind: "image", body, contentType: "image/jpeg", filename: "poster.jpg" })`.
      Remove the temporary files in a `finally` block.
      Proof: `bun test packages/media/src/generation/video-roundtrip.bun.test.ts`
      passes, and a new assertion in that file checks that the stored video has
      `moov` before `mdat`.
  - Proof: worker roundtrip passes with 18 assertions, including stored MP4 box
    order, poster ownership/type/size, authenticated polling and invalid output rejection.
- [x] 4.4 Carry the poster through the job (design.md D5):
      `packages/media/src/generation/store.ts` (four `poster_storage_*` columns
      with the existing `ALTER TABLE` pattern, and `poster` in the `markDone`
      meta), `packages/media/src/worker.ts` (return the columns),
      `packages/media/src/api/client.ts` and `packages/media/src/api/types.ts`
      (map to `MediaJob.poster`). Add a test case to
      `packages/media/src/api/client.test.ts` for a job with and without poster
      columns.
      Proof: `bun run --cwd packages/media test` and
      `bun run --cwd packages/media test:bun` pass.
  - Proof: portable media tests: 237 passed, 1 skipped. Bun media tests:
    194 passed, 1 skipped. Includes poster-present and poster-absent client mapping.
- [x] 4.5 In `apps/api/src/lib/generation/video-generator.ts`, validate and
      register the poster and return `posterUrl` (design.md D5). Add
      `posterUrl: z.string().min(1).optional()` to `generatedVideoSchema` in
      `packages/shared/src/video-generation.ts`. Add cases to
      `apps/api/src/lib/generation/video-generator.bun.test.ts`: a job with a valid
      poster returns `posterUrl`. A job without a poster returns no `posterUrl`. A
      poster key outside `workspaces/<workspace>/image/` throws.
      Proof: `bun run --cwd apps/api test:bun src/lib/generation/video-generator.bun.test.ts` passes.
  - Proof: command runs the whole API Bun suite: 1481 passed, 5 skipped. Added
    cases cover poster registration, absence, foreign owner, wrong type and changed size.
- [x] 4.6 Web. Add `poster?: string` to `MediaAsset` in
      `packages/shared/src/editor/scope.ts` with a one-line comment: "Server-made
      first frame of this video. Never the input image." Add `poster` to
      `seedForGeneratedVideo` in `apps/web/src/models/timeline/media-seeds.ts`.
      Pass `result.posterUrl` in `animateScene`
      (`apps/web/src/hooks/timeline/use-scene-generation.ts`). In
      `apps/web/src/components/timeline/timeline-lane.tsx`, show `asset.poster`
      for a generated video when it exists. In
      `apps/web/src/components/timeline/media/media-browser.tsx`, use `poster` when
      `thumb` is absent. Add unit tests for the seed and for the lane's thumbnail
      choice (with poster, without poster, agent clip with a scene-image `thumb`).
      Proof: `bun run --cwd apps/web test` passes for the new and changed files, and
      `cargo test` passes (the Rust engine must accept the new field).
  - Proof: focused web tests: 24 passed. Cargo tests pass. Browser production
    Animate at 1440px and 320px: 3 passed including warmup. A server poster
    survives autosave/reload; older and agent scene-image thumbs use live decoding.
    Source replacement clears stale poster and exact undo restores it.
    Reviewed screenshots: `/tmp/maleo-poster-browser-proof/desktop.png` and `phone.png`.
    Fresh CI screenshots (2026-10-19), reviewed and retained under
    `data/verification/smooth-video-clip-playback-2026-10-19/`:
    `poster-desktop.png` and `poster-phone.png`.
- [x] 4.7 Drive it in the app. Select the sandbox video provider (Settings,
      video provider). Animate a scene in the editor.
      Proof: the timeline clip shows the poster image (devtools: the strip has a
      `background-image` with `/api/media/`, not a `<video>` element). Run
      `curl -s <video url> -H "Cookie: ..." | head -c 64 | xxd` to show `ftyp` then
      `moov` in the first boxes. Paste both.
  - Proof: `/tmp/maleo-poster-live.ts` starts isolated web/API/worker/storage and
    drives Settings Video Sandbox selection, then production Animate. API returns
    a four-second sandbox video plus poster. The proof executes the queued worker
    runtime directly, without testing Inngest dispatch. Auth uses the existing test
    caller seam, not a production cookie. Project bootstrap and autosave use HAR.
    Strip result: `SPAN`, background image
    `/api/media/8a3eaf5a-5f71-4f31-a1ad-4561b7d59423`, with no video element.
    Header fetched through the real media route:
    `000000206674797069736f6d0000020069736f6d69736f32617663316d703431000005146d6f6f760000006c6d766864000000000000000000000000000003e8`.
    First boxes: `ftyp` at byte 4, `moov` at byte 36. Screenshot:
    `/tmp/maleo-poster-live/editor.png`. No developer runtime records changed.
- [x] 4.8 Update `packages/media/AGENTS.md`: one sentence under the generation
      section: the worker remuxes generated MP4 output to faststart (or transcodes it
      when it is not H.264) and writes a JPEG poster. Add a `CHANGELOG.md` entry:
      "Generated videos start faster in the browser and show a server-made
      thumbnail." Commit as
      `feat(media): publish generated video as faststart mp4 with a poster`.
      Proof: `bun run check:references` and `bunx vp check` pass.
  - Proof: references, layers and census pass. `bunx vp check` passes all 4125
    formatted files, with no lint/type findings in 2268 source files. Generation
    contract and changelog updated. Group commit uses the specified subject.

## 5. Integration checks

- [x] 5.1 Run the full gate.
      Proof: `bun run ci` passes. Paste the summary lines.
  - Premount-only pass (2026-10-18): `bun run ci` exited 1. Log:
    `/tmp/maleo-premount-ci.log`. Static checks, all workspace typechecks,
    Rust checks, deploy/release checks, all 4338 portable tests (1 skipped),
    all Bun runtime suites, layer checks and census passed. Browser CI started
    781 tests but terminated during the run with `Error: write EPIPE`,
    `error: script "ci" exited with code 1`, and
    `rtk: No space left on device (os error 28)`. Two editor tests also timed
    out during beforeEach, displaying only `loading…` before the editor mounted.
    Both passed in isolation with
    `bun run --cwd apps/web visual -- -g "VUI template and Motion Studio adapters|VUI template desktop flow" --workers=1`:
    `3 passed (9.7s)` including warmup. This does not establish full CI green.
    Removed 386 MiB of owned render-proof browser caches. Only about 655 MiB
    free remains on the volume. No unrelated files were removed.
  - Verification repair (2026-10-19): completed-chat browser check read saved
    running state before resumed-job loading settled. A read-only browser probe
    with a 300 ms chat response delay reproduced running-to-done in 3/3 runs.
    Added an explicit wait for no running chat rows before checking terminal
    styling. Production chat behavior and the styling assertion are unchanged.
    Initial full run passed 4357 portable tests (1 skipped) and runtime suites,
    then exposed this readiness race. Stopped that known-failing browser run
    to rerun the full gate after the test repair. Log:
    `data/verification/smooth-video-clip-playback-ci-2026-10-19.log`.
  - Final proof (2026-10-19): exact `bun run ci` exits 0. Static checks,
    all workspace typechecks, Rust, deploy/release, runtime suites, layers and
    census pass. Portable summary: `463 passed | 1 skipped (464)` files,
    `4357 passed | 1 skipped (4358)` tests. Browser summary:
    `781 passed (11.6m)`. Full log:
    `data/verification/smooth-video-clip-playback-ci-2026-10-19-final.log`.
    Completed-chat readiness repair also passes five focused repetitions plus
    warmup: `6 passed (11.2s)`.
- [ ] 5.2 Check on a real iPhone after deploy. Open a project with a generated
      video clip that you made after group 4. Play from 0 across the clip. Then open
      a project with a generated clip made before this change and do the same.
      Proof: write in this note, for both projects: the iOS version, whether the
      thumbnail showed, whether playback crossed the clip, and whether the notice
      appeared. If playback froze, attach the Safari Web Inspector console output.
  - Pending: matching deployment and physical iPhone were unavailable during
    this session. Record both old/new clip results on a real device after deploy.
  - User report after deployment (2026-10-19): latest Chrome on iOS, newly
    generated clip, thumbnail visible, stall notice shown, manual Play fails.
    iOS version and old-clip result are missing. Updated Play event handling
    in group 6 still needs a check on this device.
- [x] 5.3 Check the change with the OpenSpec validator.
      Proof: `openspec validate smooth-video-clip-playback --strict` passes.
  - Proof (2026-10-19): validator reports
    `Change 'smooth-video-clip-playback' is valid`. Task 5.2 remains open.

## 6. iOS report follow-up

- [x] 6.1 Reproduce the missing user-gesture event on the shared Play control.
  - User reports the stall notice in latest Chrome on iOS with a clip generated
    after deployment. Thumbnail appears. Manual Play does not resume playback.
    iOS version and direct-video playback result are still unknown. This is a
    failed physical-device check, not proof of the specific cause. Task 5.2
    remains open.
  - Installed Remotion 4.0.462 warms its shared audio tags only when `play(e)`
    receives an event. The hook discarded the event. New regression through
    real TransportControls fails first: expected native click, received undefined.
- [x] 6.2 Forward the Play click during capture, test shared audio-tag warm-up
      in the browser, and rerun relevant playback/studio checks and typechecks.
      Keep timed recovery gesture-free. Do not claim the iOS issue fixed until
      the user verifies the updated build on the failing device.
  - Proof (2026-10-19): hook/keyboard/transport suites pass `23 passed`.
    Whole web unit suite passes `272 passed (272)` files and
    `2404 passed (2404)` tests. `bun run typecheck` passes all 12 workspaces.
  - `bun run --cwd apps/web perf -- video-clip-stall.spec.ts --workers=1`
    passes `7 passed (1.0m)`, including warmup. Real Play click starts all five
    shared audio tags while `navigator.userActivation.isActive` is true.
    Worst frame pauses: desktop 138 ms, phone emulation 163 ms. Both generated
    clips decode. Bounded media retries and AudioContext clock recovery pass.
  - Studio controls pass:
    `bun run --cwd apps/web visual -- -g "VUI template and Motion Studio adapters|VUI template desktop flow" --workers=1`:
    `3 passed (8.2s)` including warmup.
  - `bunx vp check`, version/reference gates and strict OpenSpec validation
    pass. Full repository CI is the earlier group-5 result; it was not rerun
    for this web-only follow-up. Real iPhone verification remains open.
  - Optional WebKit 26.5 probe did not reach playback. Fixture project requests
    returned `503: api_unreachable`; warmup timed out after 120 seconds waiting
    for `.tl2-timeline`. An isolated probe also failed before the Play control
    mounted. This provides no WebKit playback result. Temporary probes and
    error context remain under ignored `data/verification/`.
