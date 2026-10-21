# TransportControls

**Status:** Implemented and in production (OpenSpec audit-ui-system task 10.2, done): the content editor's timeline bar, Template Studio and Motion Studio. Earlier sections are the intent; [Implementation](#implementation) records the shipped contract where it is more specific.

## Purpose

Expose playback and time position with a consistent, accessible control group.

## Use when

- Timeline/editor preview playback, seeking and timecode display.

## Do not use for

- Generation progress
- collection toolbars with no playback
- a second independent clock for editor preview.

## Structure

```text
TransportControls
├── Play / Pause
├── Timecode / Position
└── Optional Seek / Step / LoopControls
```

## Allowed controls and composition

- Existing editor workspace transport/timecode contracts (`components/editor-workspace/primitives.tsx`)
- Button/IconButton
- Slider or owned seek control where appropriate.

## Rules

- Playback state and time derive from the actual renderer/transport owner.
- Play/pause accessible name reflects the action, not only icon shape.
- Use one time-format recipe and the current timebase; do not round display and model independently.
- Global playback shortcuts must not fire while a user edits text or interacts with a nested popup.
- Feature supplies readiness/seek policy; shared controls do not create their own timer.

## Variants, density and responsive behavior

Compact toolbar or expanded preview transport; additional step/loop controls appear only where supported by the feature. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Playing, paused, ended, buffering/not ready and seeking. Unavailable playback is explicit; displayed time remains meaningful. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<TransportControls transport={rendererTransport} />
```

Bad — bypasses the semantic or behavior contract:

```tsx
<button onClick={() => setInterval(() => setTime((t) => t + 1), 1000)}>Play</button>
```

## Implementation

`TransportControls` in [transport.tsx](../../../apps/web/src/design-system/patterns/transport.tsx); stories under `Patterns/TransportControls`.

```tsx
<TransportControls playing={playing} onTogglePlay={togglePlay} currentSec={playheadSec} durationSec={total} />
<TransportControls … before={<>{rate}{jumpStart}</>} after={jumpEnd} />
```

- Renders a `ToolbarGroup` named "Transport" holding the play control, then the timecode beside it.
- Play is the canonical `IconButton` (`sm`, round, in ink). Its accessible name is the action, "Play" or "Pause"; the title adds the shortcut. `disabled` says playback cannot start.
- Timecode is current / total through the one formatter (`fmtTC`), tabular, with a fixed minimum width so the strip does not shift as digits change.
- `before` and `after` place the surface's own actions either side of Play in the same group: the content editor's row is rate, jump to start, Play, jump to end.
- It owns no clock and no shortcut. The surface passes the playing state and the two times it already subscribes to; the renderer advances them.
- Tests and CSS find the parts by `data-transport="play"` and `data-transport="timecode"`.
- Not built: seek, step and loop controls, and an ended or buffering state. No surface has them yet.

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#transport-and-timecode); [complete consumer inventory](../components.md). Owner: `apps/web/src/design-system/patterns/transport.tsx`. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [VuiTransport](../../../apps/web/src/components/editor-workspace/primitives.tsx) — current source candidate at line 16; not proof of target-pattern compliance.

## Acceptance evidence

Drive renderer play/pause/end/seek and timecode edits; check focused inputs/popups, keyboard shortcuts, phone layout and actual playback sync. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.

Space toggles active editor transport, including focused editor buttons and options. Text inputs, composition and independent modal scopes retain Space. K also toggles playback; Enter activates focused controls, including native and shared checkboxes within the editor. Checkbox activation ignores repeated keydown and key release; disabled controls and independent dialogs retain their existing behavior.
