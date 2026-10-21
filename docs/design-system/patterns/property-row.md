# PropertyRow

**Status:** Implemented and in production (OpenSpec audit-ui-system task 4.4, done): the clip inspector, the embedded item editor, the captions panel, the data callout style controls, the scene drawer and the motion keyframe editor. It replaced the `Control` primitive, which is retired. Earlier sections are the intent; [Implementation](#implementation) records the shipped contract where it is more specific.

## Purpose

Display one editable property of the selected object or project-local editor configuration inside an inspector.

## Use when

- Opacity, volume, rotation, font size or playback speed of a selected object.
- Project-local output format, render backend and narration preferences. Compound voice selection/audition keeps its own labelled controls; adjacent default actions use the actions slot. Provider ownership/status explanations belong beside rows in the section body.

## Do not use for

- Application settings
- large forms
- primary actions
- navigation.

## Structure

```text
PropertyRow
├── Label
├── Control
└── Optional ResetAction
```

## Allowed controls and composition

- Input
- NumberField (scrubbable short label, unit)
- Select
- Compound Slider/NumberField for clip Animation and Transition duration.
- Toggle using the reviewed switch/checkbox contract
- ColorInput using the reviewed color-control contract. These recipe names do not assert new primitive APIs exist.

## Rules

- Labels stack above values at every width; controls fill available width. Adjacent actions wrap instead of shrinking touch targets.
- Reset appears on hover and keyboard focus-within; remains discoverable on touch. Reserve its space to avoid shifting the control.
- Use pattern spacing; no custom vertical padding or explanatory paragraphs inside the row.
- Associate label with the actual input; compound controls retain their own accessible names.
- Reset affects only this property and has an explicit name such as Reset opacity.

## Variants, density and responsive behavior

Control-kind variants share one row contract. Compact is the inspector default; narrow layout is an owned responsive variant, not local padding. Complex multi-property editors use InspectorSection. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Enabled, disabled, focus, invalid and resettable. Read-only values remain readable; disabled is not the same as read-only. Mixed selection is a reviewed variant only where the feature supports it. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<PropertyRow label="Opacity">
	<Slider />
</PropertyRow>
```

Bad — bypasses the semantic or behavior contract:

```tsx
<div className="flex gap-[7px] py-[5px]">
	<span>Opacity</span>
	<Slider />
</div>
```

## Implementation

`PropertyRow` in [inspector.tsx](../../../apps/web/src/design-system/patterns/inspector.tsx), styled by [inspector.css](../../../apps/web/src/design-system/patterns/inspector.css); stories under `Patterns/Inspector/PropertyRow` and `Patterns/Inspector/Examples` ([source](../../../apps/web/stories/patterns/inspector/)). Production consumers: the clip inspector ([timeline-clip-inspector.tsx](../../../apps/web/src/components/timeline/timeline-clip-inspector.tsx)) and its shared `AmountRow`, `TransformSection`, audio and reveal controls in [clip-canvas.tsx](../../../apps/web/src/components/timeline/clip-canvas.tsx), driven by `apps/web/visual/clip-inspector-rows.spec.ts`; and `InfographicStyleControls` in [infographics-panel.tsx](../../../apps/web/src/components/timeline/infographics/infographics-panel.tsx), driven by `apps/web/visual/data-style-rows.spec.ts`.

```tsx
<PropertyRow label="Rotation" onReset={reset}><NumberField suffix="°" value={v} onValueChange={…} /></PropertyRow>
<PropertyRow label="Position" as="div">
  <NumberField icon="X" aria-label="X offset" … /><NumberField icon="Y" aria-label="Y offset" … />
</PropertyRow>
<FieldRow label="Size" beforeLabel={keyToggle} onReset={reset}>
  <AmountField label="Width" short="W" suffix="%" value={w} onChange={…} />
  <IconButton size="xs" aria-label="Lock size" aria-pressed={locked} … />
  <AmountField label="Height" short="H" suffix="%" value={h} onChange={…} />
</FieldRow>
```

- `label` (string), `children` (the control or controls), optional `onReset`, optional `as`, optional `actions` beside values. Actions use a named group rather than a wrapping label; each value keeps its accessible name.
- `FieldRow` (same module) groups values edited together into one row: a named group whose cells are `AmountField`s (a `NumberField` with a scrubbable short label, shown at its step's precision) and compact icon cells such as a lock or a flip. Number cells share the line down to `--ui-field-min` and wrap past it; icon cells keep their width. Property values use `AmountField`: drag the short label to scrub, type to set. Animation/Transition duration supports a compound `Slider` plus `NumberField` inside `PropertyRow as="div"`; both controls name duration, share bounds and update the same value. This variant is owned by `clip-animation-inspector.tsx`. One reset and one keyframe toggle serve the whole row.
- `as="label"` (default) wraps one control so the row label names it. `as="div"` is for compound controls: the row becomes `role="group"` labelled by the row label, and every control carries its own `aria-label`.
- Density: labels sit above compact editor fields with a `--s-1` gap; rows use `--s-3` vertical spacing. Field recipes retain control sizing and touch floors.
- Hierarchy is type and contrast, not boxes: label 11px regular in `--fg-dim` (`--type-label-*`), value 12px tabular in `--fg`, section title 12px strong in `--fg`.
- Layout: one full-width label line, then values and optional actions. Values share available width. Actions wrap onto their own line when space runs out.
- Reset: `IconButton size="xs"` named "Reset <label>" occupies reserved space beside values, outside wrapping labels. Visible on hover/focus and always without hover; disabled value controls hide reset, disabled adjacent navigation does not.
- States are read from the composed control through `:has()`: a disabled control dims the label; `aria-invalid="true"` turns the label `--err` beside the control's own destructive border. The row takes no `disabled`/`invalid` props.
- Touch: under a coarse pointer the row, the editor field, the number field and the slider's hit area all take `--control-h-touch` (44px); the drawn track and type do not change.
- Narrow: labels remain stacked; value/action line wraps. Existing fields and buttons keep 44px coarse-pointer targets.
- Long labels wrap to two lines, then ellipsize; the full text stays in the accessible name.

- Colour: `<AlphaColorControl display="value" label=… />` inside an `as="div"` row. The trigger is the editor field showing the swatch and the colour as text; its accessible name stays "<label> color".

Not implemented: row hint/error text and generic mixed numeric fields. Selected-key Curve supports a disabled Mixed option in its Easing Select until an explicit value is chosen; locked selections remain readable and refuse edits.

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#inspector-property-rows); [complete consumer inventory](../components.md). Current owner: `apps/web/src/design-system/patterns/inspector.tsx`. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- `ClipFrameTrim` is deliberately not a row: it is timeline geometry (a trim range against the clip), not a labelled value.
- The timeline zoom and the motion scrubber are bare `Slider`s, not rows: a toolbar control and a preview scrubber have no label column.

## Acceptance evidence

Compare numeric, slider, color and select rows across actual timeline/data/motion inspectors; verify keyboard edit/reset, label association, touch discovery and 320px layout. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.
