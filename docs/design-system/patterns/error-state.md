# ErrorState

**Status:** Implemented and in production (OpenSpec audit-ui-system task 4.10, done). Earlier sections are the intent; [Implementation](#implementation) records the shipped contract.

## Purpose

Explain a failed task or region and expose meaningful recovery without losing context.

## Use when

- Collection fetch failure, recoverable form/work-region error or failed incremental loading.

## Do not use for

- Successful empty results
- normal validation hints
- full generation-run failure when GenerationError is the relevant contract.

## Structure

```text
ErrorState
├── ErrorHeading
├── Safe Explanation
└── Optional Retry / RecoveryAction
```

## Allowed controls and composition

- Existing Callout/error presentation
- text
- Button
- compact icon with text.

## Rules

- Retain useful loaded data and draft input; failure is not an empty success.
- Show safe task-specific information; avoid raw secrets/provider payloads.
- Retry is available only for a meaningful permitted operation; feature supplies retry behavior.
- Acknowledge recovery and clear obsolete errors after success.
- Use scoped announcement/focus behavior; repeated polling errors must not steal focus.

## Variants, density and responsive behavior

Full-region initial failure or inline partial/retry failure. Field validation belongs beside the field, not a full-region error. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Failed, retrying, recovered and unavailable recovery. Repeat failures retain context and keep controls reachable. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<ErrorState title="References could not load" onRetry={retryReferences} />
```

Bad — bypasses the semantic or behavior contract:

```tsx
{
	fetchFailed && <EmptyState title="No references yet" />;
}
```

## Implementation

`ErrorState` in [collection.tsx](../../../apps/web/src/design-system/patterns/collection.tsx): `title`, optional `message`, optional `onRetry` with `retrying`, and `inline`. An alert. The default fills the region when `collectionPhase` returns `"failed"`; `inline` is a Callout above rows that stay on screen, for a failed refresh or a failed action. Retry is a secondary Button with its loading state. For a failed load pass a plain sentence as `message`, not the client error, which names the route and the server's text.

`collectionPhase({ count, loading, failed })` in the same module decides between the three and `"ready"`: rows win, then loading, then failed, then empty. Stories under `Patterns/Request states`; `apps/web/visual/request-states.spec.ts` forces each library surface to fail, retries it, and holds a load open.

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#empty-filtered-empty-loading-and-failure); [complete consumer inventory](../components.md). Target owner: `apps/web/src/design-system/patterns/error-state/` if a shared implementation is justified; no target directory/API was created. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [Callout](../../../apps/web/src/design-system/components/note.tsx) — current source candidate at line 59; not proof of target-pattern compliance.

## Acceptance evidence

Force first-load and pagination failures, retry success/failure and permission changes; verify data retention, announcements and keyboard retry. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.
