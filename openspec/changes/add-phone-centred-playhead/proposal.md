# Proposal

## Why

On a phone, the editor timeline followed the playhead only during playback, and
only enough to keep it in view. The playhead moved across the lanes, panning the
lanes did not move it, and the operator had to find the playhead again after each
pan. Phone video editors keep the playhead at the centre of the timeline and move
the lanes under it. Then one gesture both pans and seeks, and the operator always
knows where the playhead is.

## What Changes

- At phone width (`PHONE_MAX_WIDTH`, 860 px), the editor timeline scroller gets
  leading and trailing padding equal to half its width. Time zero and the project
  end can then reach the centre line.
- The playhead stays at the centre. During playback the lanes scroll under it.
- A scroll of the lanes by the operator seeks. A finger drag, the momentum after
  it, a wheel and a clip drag's edge autoscroll all count. A touch pauses
  playback first.
- A ruler tap seeks. When the finger lifts, the lanes move to put that time at
  the centre.
- Zoom (pinch, toolbar, fit) keeps the playhead time at the centre.
- The VUI kernel viewport gets an optional `leadPx`: the scroller's leading
  padding. The kernel maps scroll offsets through it and lets the view start up
  to `leadPx` before time zero. The default is 0, so the studios do not change.
- Desktop and both studios keep the existing follow behaviour.

## Capabilities

### New Capabilities

### Modified Capabilities

- `timeline-touch-interaction`: the phone editor timeline holds the playhead at
  the centre, and a lane pan on that timeline moves the playhead.
- `vui-timeline-surface`: the follow requirement excludes a centred-playhead
  surface, and the viewport accounts for a scroller's lead.

## Impact

- `apps/web/src/hooks/timeline/use-centred-playhead.ts` (new).
- `apps/web/src/components/timeline/use-timeline-editor-actions.ts`.
- `apps/web/src/hooks/timeline/use-timeline-zoom.ts`.
- `apps/web/src/hooks/timeline/use-content-timeline.ts`.
- `apps/web/src/models/timeline-view/` (`types.ts`, `events.ts`, `viewport.ts`,
  `reducer.ts`, `model.test.ts`).
- `apps/web/visual/`: `mobile-editor.spec.ts`, `media-import.spec.ts`, and six
  phone baselines that show the half-width padding.
