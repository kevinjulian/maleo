# Tasks

## 1. Centred playhead

- [x] 1.1 Add `use-centred-playhead.ts`: half-width padding, pin on playhead and zoom changes, seek on operator scroll, pause on touch. Use it on the phone editor timeline instead of `useFollowPlayhead`.
  - Proof: `visual/mobile-editor.spec.ts` "the playhead holds the centre while playing and scrolling seeks" passes: the playhead is within 4 px of the centre at start, during playback and after a scroll to 0, and the timecode reads `00:00` after that scroll.
- [x] 1.2 Anchor zoom on the centre for a centred scroller, and stop fit-to-width writing `scrollLeft = 0` there.
  - Proof: `bun run typecheck` clean; `mobile-editor.spec.ts` pinch and zoom cases pass.
- [x] 1.3 Seek only on operator input, ignore seek echoes for 250 ms, and do not pin under a held pointer.
  - Proof: `media-import.spec.ts` "media usages select and seek" at 320 px seeks to `00:08:00` (was `00:07:56`). `preview-transform`, `timeline-bookmarks` and `canvas-pinch` at phone width pass after `scrollIntoViewIfNeeded` and a tap.

## 2. Kernel lead

- [x] 2.1 Add `leadPx` to the kernel viewport and the resize event; map scroll offsets through it and let the start go to `-leadPx`.
  - Proof: `model.test.ts` "a scroller's lead maps offsets to times and lets the view start before zero" passes; `bun run test` in `apps/web`: 2584 passed.
- [x] 2.2 Send the scroller's leading padding to the kernel from `use-content-timeline.ts`.
  - Proof: at 320 px the kernel geometry for `video:98` is within 0.0004 px of the clip's DOM box (`leftPx` 159.9996 against 160); `mobile-editor.spec.ts` "dragging a selected clip to the right edge scrolls the timeline" passes.

## 3. Verification

- [x] 3.1 Update the specs whose coordinates or baselines the padding changes.
  - Proof: `media-import.spec.ts` clicks the ruler at the viewport-relative x that kernel geometry reports. Six phone baselines updated; the 320 px editor screenshot shows the playhead at the centre with time 0 on it.
- [x] 3.2 Run the full gate.
  - Proof: `bun run typecheck` 0 errors; `bunx vp check` no findings; `bun run visual` 821 passed, 1 skipped.

## 4. Fixed line and Motion Studio

- [x] 4.1 Draw the line on the scroller's parent at the scroller centre and hide the in-content playhead; skip paused pins under half a frame.
  - Proof: `mobile-editor.spec.ts` "the playhead holds the centre while playing and scrolling seeks" asserts the in-content playhead has opacity 0 and the drawn line is within 2 px of the scroller centre.
- [x] 4.2 Hold the Motion Studio playhead at the centre at phone width.
  - Proof: `mobile-editor.spec.ts` "Motion Studio keeps preview, layer timeline, inspector and close reachable on phone" asserts the centred line and that a scroll of 72 px seeks to 1 s; `vui-motion-phone.png` baseline updated.
