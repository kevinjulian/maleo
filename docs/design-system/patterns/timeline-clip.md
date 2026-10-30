# TimelineClip

**Status:** Feature-owned (OpenSpec audit-ui-system task 10.6). This is the contract `apps/web/src/components/timeline/` keeps for its own tracks and clips; it is not a shared component and no export is planned, because track and clip geometry, time and gestures belong to `@maleo/vui`. Examples are semantic pseudocode.

## Purpose

Represent one editable time interval with consistent selection, content and action affordances.

## Use when

- Visual/audio/overlay clips positioned within a TimelineTrack.

## Do not use for

- Asset preview cards
- free-form range controls
- replacing VUI drag/resize/snap logic with local handlers.

## Structure

```text
TimelineClip
├── TimeGeometry + SelectionBoundary
├── ContentSummary / Preview
├── Optional ResizeHandles
└── ContextActions
```

## Allowed controls and composition

- Public VUI clip/range/gesture APIs
- approved menu/action controls
- owned thumbnail/waveform presentation.

## Rules

- Position/duration are model geometry, not arbitrary chrome values to round to the spacing scale.
- Selection, hover and focus are distinguishable; keep context actions named.
- Use public VUI gesture constraints, snap/trim and cancellation rather than local document listeners.
- Tiny clips retain reachable actions; an unreadable label does not justify hiding all access.
- Feature owns edit/undo authority and updates; presentation preserves clip identity across gestures.

## Variants, density and responsive behavior

Audio, visual and overlay content; selected/unselected and narrow clips share geometry and action rules. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

### Animation context actions

Entrance and Exit live only in the Animation inspector; clips carry no entrance/exit triggers or applied indicators. One Transition IconButton owns an adjacent same-track visual junction, outside the clip button, so opening the inspector never starts a trim or moves clips. Short and narrow clips retain Animation category access through the same inspector.

Existing docked inspector and phone properties sheet use ToggleGroup `layout="tiles"` preset tiles (canonical two-column grid, preserving roving focus and pressed state), InspectorSection and PropertyRow controls. Opening explicitly selects the clip or pair without editing the document. Separate Entrance and Exit InspectorSections show their own presets and duration together; no segmented edge selector. Junctions use Transition. Duration is the supported compound Slider/NumberField row. Replay uses the main production player; no animation dialog or duplicate preview. Sections start collapsed, with the current non-None effect beside the chevron only while collapsed. No Custom keys tile or Custom keyframes shortcut appears; ordinary property keys and lanes remain available. Selected keys show Curve easing beside their properties, with mixed state and one undo for multi-key edits. Clips retain independent movement: a committed move that breaks a junction removes its transition, with movement and cleanup sharing one undo step. Projected drag feedback announces removal on drop; cancellation makes no edit.

### Pending media badge

A clip whose asset is still importing (OpenSpec `use-media-while-uploading` D7) keeps its geometry, selection and gestures; only a compact badge is added, inside the clip content, never over its resize handles:

- Icon plus a 2px progress line along the clip foot: upload icon with the measured fraction while uploading, indeterminate line while processing, warning icon with no line when failed or interrupted.
- The badge is not interactive. Its accessible name, also the pointer tooltip, is the state: `Uploading 40%`, `Processing`, `Upload failed: <reason>`, `Upload interrupted`. Recovery actions live on the asset card and in the clip actions sheet, not on the clip.
- Narrow clips keep the icon and drop the line before the label; the icon and name stay.
- Phone clip bars show the same badge; the phone clip actions sheet shows the state as a status line above its actions.
- Completion changes the badge and the media in place; the clip is not moved, re-timed or re-created.

Story: `Patterns/Timeline/Pending clip badge`.

### Preview readiness badge

Preview readiness is independent of upload state. The same feature-owned badge
geometry exposes `Preview queued`, `Loading preview`, `Validating preview` or
`Preview failed: <reason>`. A ready clip shows no badge.

- Loading is a progress line along the clip's bottom edge, with no icon. It
  shows measured byte progress when total bytes are known; unknown totals,
  queued work and validation use an indeterminate line.
- Failure shows a warning icon without a line. Color alone never identifies the
  state: every badge keeps its accessible name.
- Narrow clips, too short for a readable line, show a small loader icon
  instead. The badge accepts no input and preserves selection, time geometry
  and trim handles.
- Phone clip actions show the full state and Retry for failed sources. Retry
  changes preview state only. It creates no document edit or undo entry.
- A clip with multiple sources reports the native aggregate state. Shared
  source updates reach every referencing clip, including muted and hidden clips.
- While upload is pending, its badge keeps its own upload label. Preview state
  remains available in clip actions. Completion does not imply preview readiness.

Story: `Patterns/Timeline/Preview clip badge`.

## Accessibility and states

Selected, focused, dragging/resizing, locked/unavailable and pending media where supported. Gesture cancellation restores valid geometry. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<TimelineClip clip={presentation} actions={authorizedClipActions} />
```

Bad — bypasses the semantic or behavior contract:

```tsx
<div onPointerMove={(e) => setClipDuration(e.clientX)} className="rounded-[7px]">
	Clip
</div>
```

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#timeline-clips-lanes-and-drag-geometry); [complete consumer inventory](../components.md). Target owner: `apps/web/src/design-system/patterns/timeline-clip/` if a shared implementation is justified; no target directory/API was created. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [ClipRange](../../../apps/web/src/components/timeline/clip-range.tsx) — current source candidate at line 67; not proof of target-pattern compliance.
- [TimelineLane](../../../apps/web/src/components/timeline/timeline-lane.tsx) — current source candidate at line 383; not proof of target-pattern compliance.

## Acceptance evidence

Check tiny/long clips, snapping/trim, cancel/undo, nested context menu, keyboard actions and touch targets with real timeline fixtures. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.
