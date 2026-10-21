# LoadingState

**Status:** Implemented and in production (OpenSpec audit-ui-system task 4.10, done). Earlier sections are the intent; [Implementation](#implementation) records the shipped contract.

## Purpose

Communicate pending work in a known region while preserving usable context.

## Use when

- Initial collection loading, background refresh or a bounded operation awaiting completion.

## Do not use for

- Unknown generation percentage
- successful emptiness
- permanent placeholders after failure.

## Structure

```text
LoadingState
├── Accessible Status
├── Optional Shimmer / BusyIndicator
└── Preserved Context where available
```

## Allowed controls and composition

- Shimmer
- owned busy indicator
- text/status recipe
- existing controls with busy feedback.

## Rules

- Match placeholder geometry to the expected region; decorative skeletons are not content.
- Keep current items visible for background refresh when valid; do not flash an empty state.
- Use indeterminate status unless reliable progress is supplied.
- Do not announce every animation frame or apply aria-busy indefinitely.
- Honor reduced-motion behavior and distinguish cancellable from non-cancellable operations.

## Variants, density and responsive behavior

Initial skeleton, inline busy or background refresh. Region geometry determines the recipe; features do not invent spinner layouts. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Pending, success, failure and cancellation transition explicitly; loaded content retains identity/focus where possible. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<LoadingState label="Loading references" kind="collection" />
```

Bad — bypasses the semantic or behavior contract:

```tsx
<div>
	{Array.from({ length: 20 }, () => (
		<span className="animate-pulse">Loading</span>
	))}
</div>
```

## Implementation

`LoadingState` in [collection.tsx](../../../apps/web/src/design-system/patterns/collection.tsx): `label`, with a Spinner, as a polite busy status in the region the rows will fill. Render it when `collectionPhase` returns `"loading"`, which is only while there are no rows: a list that has data keeps showing it through a refresh. Skeleton placeholders matched to row geometry are not built.

`collectionPhase({ count, loading, failed })` in the same module decides between the three and `"ready"`: rows win, then loading, then failed, then empty. Stories under `Patterns/Request states`; `apps/web/visual/request-states.spec.ts` forces each library surface to fail, retries it, and holds a load open.

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#empty-filtered-empty-loading-and-failure); [complete consumer inventory](../components.md). Target owner: `apps/web/src/design-system/patterns/loading-state/` if a shared implementation is justified; no target directory/API was created. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [Shimmer](../../../apps/web/src/design-system/components/shimmer.tsx) — current source candidate at line 9; not proof of target-pattern compliance.

## Acceptance evidence

Force delayed requests then success/error/cancel; verify retained data, announced status, reduced motion and narrow layout. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.
