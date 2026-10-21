---
name: web-design-system
description: Resolve design-system choices for Maleo frontend changes. Identify approved patterns, canonical components, semantic tokens, ownership, and required extensions before implementation; verify resulting usage follows their contracts. Use for UI controls, layouts, states, styling, and overlays.
---

# Web Design System

Decide how a UI change fits Maleo's governed design system before writing JSX
or CSS, and verify that decision after implementation. Feature implementation
owns data, state, API calls, permissions, and business behavior.

## Read the owners

Resolve links relative to this skill directory; source paths below are relative
to the repository root.

- [Web authoring](../../../apps/web/DESIGN.md): imports, recipes, icons, overlays,
  and verification commands.
- [Pattern catalogue and agent protocol](../../../docs/design-system/patterns.md):
  current status, import paths, stories, and extension decisions.
- [Principles](../../../docs/design-system/principles.md): layer ownership and
  composition boundaries.
- [Foundations](../../../docs/design-system/foundations.md): relevant visual
  roles and permitted literal exceptions.

Read the relevant pattern specification, shipped implementation/types,
Storybook examples, and a production consumer. Use Semble to locate code as
required by repository instructions. Documentation examples may be proposed
pseudocode; confirm the real API before using them. Catalogue status, not a
name in the inventory or a screenshot, determines approval. Keep contracts in
their owning documents rather than copying them into this skill.

## Decide before implementation

Perform discovery for every user-facing UI change, including new states,
controls, layout, styling, and overlays. Keep this short decision record in
working context; present it only when it helps explain a decision:

```text
Screen and relevant states:
UI intent:
Pattern and catalogue status (or direct component use):
Canonical components and supported slots/variants:
Foundation roles/tokens:
Existing story and production reference:
Owning layer:
Extension required: none / component variant / pattern variant / NEW_PATTERN
```

Match semantic purpose before choosing controls. Apply the catalogue's agent
protocol:

- **Approved fits:** import its listed module and compose canonical components
  within documented slots. Preserve hierarchy, density, responsive behavior,
  label associations, and state semantics.
- **Approved almost fits:** record the semantic gap and real consumers in the
  owning OpenSpec task; resolve a reviewed variant before implementing it.
  Do not fork the pattern or compensate with feature CSS.
- **Candidate fits:** follow its specification with approved components in the
  feature. Building a shared pattern requires its own reviewed task; do not
  invent an export or promote its status as a feature side effect.
- **Feature-owned fits:** preserve its specification and existing feature/VUI
  owner. Do not introduce a shared wrapper merely to complete the hierarchy.
- **Nothing fits:** use components directly for a single control or plain form.
  For a new recurring composition, record `NEW_PATTERN` with at least two real
  usages in OpenSpec and review its contract before implementation.

Use existing session authorization and accepted OpenSpec decisions. A gap is
not an automatic permission request; ask only for unresolved decisions that
require user input. Continue independent work while those decisions are pending.

## Preserve the layer boundaries

Features consume `@design-system/patterns/…` and
`@design-system/components/…`. Only the design-system layer imports Base UI;
shadcn recipes are adapted implementation details. Keep domain IO and business
state out of patterns. Preserve the editor workspace's geometry and gesture contracts and
`controllers/overlay` modal, sheet, and lightbox lifecycle ownership.

Use semantic foundation roles for visual values and named icon steps through
the canonical icon registry. Do not override control styling in features.
Literal exceptions must fit the foundation rules: hairlines, media/canvas
geometry, or local stacking inside a stage/track. Prefer composition over
specialized styling components; specialized feature controls may encapsulate
meaningful domain behavior while composing canonical controls.

Fix problems where they belong: visual vocabulary in foundations, control
behavior/appearance in components, composition contracts in patterns, and
incorrect usage or domain layout in features. Extend variants for reusable
semantic differences, not feature locations. For a reviewed new shared pattern,
land specification, implementation, Storybook, visual/interaction proof, and
production usage before recording approval in the catalogue.

## Validate the decision

For a decision-only request, report the selected contract, supporting source
references, gaps, and required proof; do not claim browser validation occurred.

After implementation, check relevant hierarchy, alignment, density, long
content, overflow, themes, and changed states. Drive the production control at
320px and desktop width with keyboard and pointer; verify focus, dismissal,
selection, and recovery where relevant. Storybook demonstrates the contract;
it does not prove production reachability. Inspect changed visual baselines
before accepting them.

Run the applicable checks from web authoring and repository instructions:
layer/census checks, focused behavior tests and visual specs, typecheck and
lint after code changes, and the full CI gate for cross-cutting work. Record
contract changes and actual proof in the owning OpenSpec task when one exists;
never create a second tracker. Report failed or unperformed checks explicitly.
