# ToolbarAction

**Status:** Implemented and in production (OpenSpec audit-ui-system task 10.1, done): the timeline toolbar and the Content, Library, Images and Speech collection strips. Earlier sections are the intent; [Implementation](#implementation) records the shipped contract where it is more specific.

## Purpose

Express one toolbar command with consistent priority, placement and feedback.

## Use when

- Split, duplicate, delete, zoom, export or another command in a work-region toolbar.

## Do not use for

- Navigation links
- field labels
- presenting an entire menu as an unnamed icon.

## Structure

```text
ToolbarAction
└── Button or IconButton
    ├── Label / Icon
    └── Optional Busy or ShortcutHint
```

## Allowed controls and composition

- Button
- IconButton
- Tooltip as supplemental explanation
- DropdownMenu trigger for action overflow.

## Rules

- Reuse component variants and toolbar density; do not style another local button.
- Every icon action has an accessible name; a tooltip alone is not its name.
- Feature supplies eligibility and command callback; pattern does not decide permissions.
- Destructive and toggle actions preserve their distinct meanings.
- Busy feedback prevents accidental duplicate command execution without removing useful context.

## Variants, density and responsive behavior

Labelled, icon-only or menu-trigger actions; command priority and selected toggle state are explicit, not inferred from icon shape. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Enabled, disabled, busy, focused and selected where toggle semantics apply. Explain unavailable actions when needed without relying solely on color. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<ToolbarAction label="Split clip" disabled={!canSplit} onAction={split} />
```

Bad — bypasses the semantic or behavior contract:

```tsx
<button className="rounded-[7px] p-[5px]" onClick={split}>
	✂
</button>
```

## Implementation

`ToolbarAction` in [toolbar.tsx](../../../apps/web/src/design-system/patterns/toolbar.tsx).

```tsx
<ToolbarAction label="Undo" hint="Undo (⌘Z)" icon={…} disabled={!canUndo} onAction={undo} />
<ToolbarAction label="Pacing insights" icon={…} on={insightsOn} onAction={toggle} />
<ToolbarAction label="Organize range" icon={…} onAction={organize}>Organize range</ToolbarAction>
```

- Icon-only (no children): the canonical `IconButton` at `xs`. `label` is its accessible name; `hint` is the pointer title where it says more (a shortcut, the reason it is unavailable).
- Labelled (children): the canonical `Button`, `ghost` at `xs` (24px, added to Button for this). Its text is its name; `hint` is the title.
- `on` given (true or false) makes it a toggle with `aria-pressed`; the selected look is the selection role for both forms. Omit it for a one-shot command.
- `busy` ignores presses and reports `aria-busy`; a labelled action shows the spinner and stays focusable. `danger` reddens an icon action on hover.
- The feature supplies `disabled` and `onAction`; the pattern decides nothing about eligibility.

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#timeline-template-and-motion-toolbars); [complete consumer inventory](../components.md). Owner: `apps/web/src/design-system/patterns/toolbar.tsx`. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [TimelineToolbar](../../../apps/web/src/components/timeline/timeline-toolbar.tsx) — consumer.

## Acceptance evidence

Check named icon actions, disabled/busy handling, command results, focus and narrow overflow in actual toolbar groups. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.
