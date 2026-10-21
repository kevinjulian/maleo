# ToolbarGroup

**Status:** Implemented and in production (OpenSpec audit-ui-system task 10.1, done): the timeline toolbar and the Content, Library, Images and Speech collection strips. Earlier sections are the intent; [Implementation](#implementation) records the shipped contract where it is more specific.

## Purpose

Keep related toolbar actions visually and behaviorally grouped.

## Use when

- Edit commands, zoom controls, collection filters or transport actions within a Toolbar.

## Do not use for

- An entire navigation system
- arbitrary containers
- unrelated commands grouped by available width.

## Structure

```text
ToolbarGroup
├── Optional GroupLabel
├── ToolbarActions / related controls
└── Optional BoundarySeparator
```

## Allowed controls and composition

- ToolbarAction
- Input/Select
- Separator at group boundaries
- reviewed toggle group where relevant.

## Rules

- Group by task and use shared internal gap/density.
- Do not add a separator between every button.
- Preserve order across responsive reflow and overflow.
- Keep toggle selection semantics distinct from one-shot commands.
- Do not introduce a second keyboard scope inside a toolbar without an explicit contract.

## Variants, density and responsive behavior

Command group or query/control group; a group can overflow as a unit when its actions remain reachable. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Enabled, partially disabled, selected toggles and overflow. Disabled controls must not block access to enabled group actions. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<ToolbarGroup label="Zoom">
	<ToolbarAction label="Zoom out" />
	<ToolbarAction label="Zoom in" />
</ToolbarGroup>
```

Bad — bypasses the semantic or behavior contract:

```tsx
<ToolbarGroup>
	<Button>Zoom</Button>
	<Button>Delete project</Button>
	<Button>Open account</Button>
</ToolbarGroup>
```

## Implementation

`ToolbarGroup` in [toolbar.tsx](../../../apps/web/src/design-system/patterns/toolbar.tsx).

```tsx
<ToolbarGroup label="Timeline zoom">
  <ToolbarAction label="Zoom out" … /><Slider … /><ToolbarAction label="Zoom in" … />
</ToolbarGroup>
```

- Optional `label`; with one the group is `role="group"` and announced, without one it is only visual.
- The rule between two adjacent groups is drawn by the group. Callers place no divider element, so there is none between every button and none left at an edge.
- Holds `ToolbarAction`s and the controls that belong with them (a Slider between zoom buttons, filter chips). A popover anchored to an action sits in the group beside its trigger.

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#timeline-template-and-motion-toolbars); [complete consumer inventory](../components.md). Owner: `apps/web/src/design-system/patterns/toolbar.tsx`. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [TimelineToolbar](../../../apps/web/src/components/timeline/timeline-toolbar.tsx) — consumer.

## Acceptance evidence

Check mixed enabled/disabled groups, selected controls, group overflow and keyboard traversal in Library and timeline toolbars. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.
