# EmptyState

**Status:** Implemented and in production (OpenSpec audit-ui-system task 4.10, done). Earlier sections are the intent; [Implementation](#implementation) records the shipped contract.

## Purpose

Explain a successfully loaded region with no usable items and offer a relevant next action.

## Use when

- An empty Library/project collection or a query with zero matching results.

## Do not use for

- Loading
- failed requests
- access denial
- generation failure
- hiding already present data.

## Structure

```text
EmptyState
├── Optional MeaningfulIcon
├── Title
├── Brief Explanation
└── Optional Primary / SecondaryAction
```

## Allowed controls and composition

- Icon
- text recipes
- Button for create/add
- Button for clear/reset filters.

## Rules

- Render only after successful loading establishes emptiness.
- Distinguish first-use empty from filtered-empty; query emptiness offers clear filters rather than only create.
- Keep copy task-specific and brief; reuse shared hierarchy/spacing.
- An action must be available to the user; feature supplies authority.
- Do not design a different illustration/layout for every empty feature.

## Variants, density and responsive behavior

Collection-empty and filtered-empty; inline compact or full-region presentation within the same hierarchy. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Loaded-empty and loaded-filtered-empty only. Pending/error/denied states route to their own presentation; action busy state does not redefine emptiness. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<EmptyState
	kind="filtered"
	title="No matching references"
	action={<Button>Clear filters</Button>}
/>
```

Bad — bypasses the semantic or behavior contract:

```tsx
{
	!items.length && <EmptyState title="Nothing here" />;
} // also shown while loading or failed
```

## Implementation

`EmptyState` in [collection.tsx](../../../apps/web/src/design-system/patterns/collection.tsx): `label`, optional `title`. Plain content, with no role. Render it only when `collectionPhase` returns `"empty"`, or for a filter that matched nothing in a loaded list; it has no busy form any more (that was `LoadingState`'s job).

`collectionPhase({ count, loading, failed })` in the same module decides between the three and `"ready"`: rows win, then loading, then failed, then empty. Stories under `Patterns/Request states`; `apps/web/visual/request-states.spec.ts` forces each library surface to fail, retries it, and holds a load open.

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#empty-filtered-empty-loading-and-failure); [complete consumer inventory](../components.md). Target owner: `apps/web/src/design-system/patterns/empty-state/` if a shared implementation is justified; no target directory/API was created. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [EmptyState](../../../apps/web/src/design-system/patterns/collection.tsx) — current source candidate at line 30; not proof of target-pattern compliance.

## Acceptance evidence

Force successful zero data, no query matches, delay, error and permission denial on Library routes; ensure only correct states render EmptyState. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.
