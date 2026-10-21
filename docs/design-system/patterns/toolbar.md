# Toolbar

**Status:** Implemented and in production (OpenSpec audit-ui-system task 10.1, done): the timeline toolbar and the Content, Library, Images and Speech collection strips. Earlier sections are the intent; [Implementation](#implementation) records the shipped contract where it is more specific.

## Purpose

Arrange actions and controls for one clearly identified work region.

## Use when

- Library collection actions/filters, timeline editing actions or script density/export controls.

## Do not use for

- Route navigation disguised as tools
- whole forms
- unrelated global and selection commands in one undifferentiated strip.

## Structure

```text
Toolbar
├── ToolbarGroup(s)
├── Optional FlexibleSpace
└── Optional OverflowActions
```

## Allowed controls and composition

- ToolbarGroup
- ToolbarAction
- Input/Select for relevant search/filter/density
- DropdownMenu
- Separator.

## Rules

- Separate command, selection and query groups by meaning; establish one action hierarchy.
- Choose one density for the group; do not fix wrapping with local button heights/gaps.
- Keep essential actions reachable at narrow widths; use a reviewed wrap/overflow recipe.
- Route destinations remain navigation; tabs remain local panel selection.
- Use role=toolbar only when the matching keyboard contract is implemented; a visual strip alone does not imply roving focus.

## Variants, density and responsive behavior

Command, collection-query and transport contexts share grammar but retain distinct semantics. Compact/default density and narrow reflow belong to the recipe. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

No selection, selected object, busy/disabled actions, filtering and overflow open. Keyboard focus remains on a reachable item when actions change. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<Toolbar label="Timeline">
	<ToolbarGroup>
		<ToolbarAction label="Split clip" />
	</ToolbarGroup>
</Toolbar>
```

Bad — bypasses the semantic or behavior contract:

```tsx
<div className="flex gap-[7px]">
	<Button>Split</Button>
	<Button>Settings</Button>
	<Button>Billing</Button>
</div>
```

## Implementation

`Toolbar` in [toolbar.tsx](../../../apps/web/src/design-system/patterns/toolbar.tsx), styled by [toolbar.css](../../../apps/web/src/design-system/patterns/toolbar.css); stories under `Patterns/Toolbar`.

```tsx
<Toolbar label="Search and filter content">
  <SearchField … />
  <ToolbarGroup label="Filter content by type">…</ToolbarGroup>
</Toolbar>
```

- `label` is required and names the region. The element is `role="group"`, not `role="toolbar"`: these strips hold sliders, search fields and popover triggers that need the arrow keys, so every action stays a tab stop and no roving focus is promised.
- Lays its children in a row that wraps, in source order. Its layout has zero specificity, so a surface that owns geometry keeps it: the timeline's three-track strip (`TimelineToolbarFrame`, which centres the transport on every editor surface) is that surface's own frame and holds `ToolbarGroup`s directly.
- No overflow menu. The timeline's phone composition moves whole groups into its More sheet, composed by the feature from the same group elements.
- Also used by the script view's density and file strip, the storyboard's plan-approval controls and the elements panel's type filter and search.

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#timeline-template-and-motion-toolbars); [complete consumer inventory](../components.md). Owner: `apps/web/src/design-system/patterns/toolbar.tsx`. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [TimelineToolbar](../../../apps/web/src/components/timeline/timeline-toolbar.tsx) — consumer.
- [LibraryToolbar](../../../apps/web/src/components/catalog/library-toolbar.tsx) — consumer.

## Acceptance evidence

Drive Content/Library, timeline and all script density modes at 320px/desktop; verify overflow, search/filter/reset and keyboard action access. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.
