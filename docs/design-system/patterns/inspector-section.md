# InspectorSection

**Status:** Implemented and in production (OpenSpec audit-ui-system task 4.4, done), wherever PropertyRow is used. Earlier sections are the intent; [Implementation](#implementation) records the shipped contract where it is more specific.

## Purpose

Group related properties of the current selection or project-local editor configuration under one named inspector section.

## Use when

- Transform, appearance, audio or animation properties belonging to the selected object.
- Project-local Output, Audio, Style and Caption properties, plus template/render configuration in editor tool panels; whole application settings remain excluded.

## Do not use for

- Whole application settings pages
- unrelated properties grouped only to fill space
- modal workflow steps.

## Structure

```text
InspectorSection
├── Heading + optional Disclosure
├── Optional SectionAction
└── PropertyRows or reviewed compound editor
```

## Allowed controls and composition

- PropertyRow
- Separator
- Button/IconButton for a section-specific action
- reviewed compound controls.

## Rules

- Group by property meaning, not input type.
- Use shared section spacing and heading hierarchy; nested sections need a semantic reason.
- Disclosure uses a named button with expanded state; collapsing must not strand focus.
- Section actions affect this section and do not silently reset the whole object.
- Never import selection hooks or persist edits here; the feature supplies values and commands.

## Variants, density and responsive behavior

Open or collapsible sections; compact/narrow variants preserve heading and order. Avoid arbitrary nested accordion depth. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Expanded/collapsed, unavailable selection, disabled and partially invalid. Do not hide invalid input by automatically collapsing. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<InspectorSection title="Transform">
	<PropertyRow label="Rotation">
		<NumberInput />
	</PropertyRow>
</InspectorSection>
```

Bad — bypasses the semantic or behavior contract:

```tsx
<InspectorSection title="Other">
	<SettingsForm />
	<DeleteProjectButton />
</InspectorSection>
```

## Implementation

`InspectorSection` in [inspector.tsx](../../../apps/web/src/design-system/patterns/inspector.tsx), styled by [inspector.css](../../../apps/web/src/design-system/patterns/inspector.css); stories under `Patterns/Inspector/InspectorSection` and `Patterns/Inspector/Examples` ([source](../../../apps/web/stories/patterns/inspector/)). Project Settings uses these sections with inline controls and compound voice selection. Style retains complex detail editors within semantic groups. Captions exposes sections only while enabled; Templates places its panel header above Render override and Templates sections.

```tsx
<InspectorSection title="Position & Size" collapsible defaultOpen action={<IconButton size="xs" aria-label="Reset Position & Size">…</IconButton>}>
  <PropertyRow …/>
</InspectorSection>
```

- `title`, `children`, optional `collapsible`, `defaultOpen`, `summary` and `action`. Open state is uncontrolled; no production section drives it from outside.
- `<section aria-labelledby>` around an `h3`. Collapsible sections put a full-width disclosure button inside the `h3` (`aria-expanded`, `aria-controls`) with a trailing chevron that turns; the body is `hidden`, not unmounted, so `aria-controls` always resolves and focus stays on the toggle.
- `summary` is a non-interactive current value between the title and chevron, shown only while collapsed. Features omit it for None. Section names stay tied to the title, regardless of summary. Entrance and Exit animation sections use this slot and start collapsed; `CollapsedValue` demonstrates disclosure.
- `action` renders beside the heading, outside the toggle. The package `AccordionSection` is not reused because its `right` slot sits inside the toggle button, which would nest an interactive control in a button.
- Header height 44px with `--section-header-h` minimum, inline padding `--s-3`, body gap `--s-1` with `--s-3` below the last row, a `--border` rule between sections and no other container; title is the caption role at `--weight-strong`, ellipsized; a 12px `--muted` chevron.

Not implemented: a collapsed-section indicator for invalid content inside it, and a heading-level prop (the inspector's panel header is the level above).

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#panel-hierarchy-and-disclosure); [complete consumer inventory](../components.md). Current owner: `apps/web/src/design-system/patterns/inspector.tsx` until the M18 boundary move to `apps/web/src/design-system/patterns/inspector-section/`. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [AccordionSection](../../../apps/web/src/components/timeline/inspector-section.tsx) — current source candidate at line 22; not proof of target-pattern compliance.
- [Section](../../../apps/web/src/design-system/components/panel.tsx) — current source candidate at line 56; not proof of target-pattern compliance.

## Acceptance evidence

Exercise transform/audio sections with keyboard disclosure, focus while selection changes, invalid fields and phone inspector sheets. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.
