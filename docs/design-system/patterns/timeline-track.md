# TimelineTrack

**Status:** Feature-owned (OpenSpec audit-ui-system task 10.6). This is the contract `apps/web/src/components/timeline/` keeps for its own tracks and clips; it is not a shared component and no export is planned, because track and clip geometry, time and gestures belong to `@maleo/vui`. Examples are semantic pseudocode.

## Purpose

Present one timeline lane with its identity, controls and clips in shared time geometry.

## Use when

- Audio, visual or overlay lanes in the editor timeline.

## Do not use for

- Media grids
- unrelated stacked cards
- a new implementation of VUI time/gesture machinery.

## Structure

```text
TimelineTrack
├── TrackHeader + ContextControls
└── TimeAlignedLane
    └── TimelineClip items
```

## Allowed controls and composition

- Public VUI lane/time/gesture contracts
- TimelineClip
- IconButton
- DropdownMenu
- track controls through approved components.

## Rules

- Track identity/order and clip placement come from the timeline model.
- All tracks share ruler/zoom/scroll geometry; visual spacing tokens must not alter time coordinates.
- Separate track commands from clip commands and give icon controls explicit names.
- Feature supplies edit eligibility; shared presentation does not persist timeline edits.
- Provide keyboard alternatives for supported pointer-only commands and preserve selection focus.

## Variants, density and responsive behavior

Audio/visual/overlay lane presentation; compact track header and phone workbench composition preserve the time model. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Empty lane, populated, selected/muted/locked where supported, drag preview and unavailable editing. Do not imply unsupported track states exist. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<TimelineTrack track={presentation}>
	<TimelineClip clip={clipPresentation} />
</TimelineTrack>
```

Bad — bypasses the semantic or behavior contract:

```tsx
<div style={{ gap: 7 }}>
	{clips.map((c) => (
		<div style={{ width: c.duration * 10 }}>{c.name}</div>
	))}
</div>
```

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#timeline-clips-lanes-and-drag-geometry); [complete consumer inventory](../components.md). Target owner: `apps/web/src/design-system/patterns/timeline-track/` if a shared implementation is justified; no target directory/API was created. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [TimelineLane](../../../apps/web/src/components/timeline/timeline-lane.tsx) — current source candidate at line 383; not proof of target-pattern compliance.
- [TimelineTracks](../../../apps/web/src/components/timeline/timeline-tracks.tsx) — current source candidate at line 212; not proof of target-pattern compliance.

## Acceptance evidence

Use actual timeline fixtures to verify cross-lane alignment, zoom/scroll, track/clip command scope, selection and keyboard/phone access. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.
