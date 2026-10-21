# GenerationError

**Status:** Implemented and in production (OpenSpec audit-ui-system task 10.5, done) in the editor chat. Earlier sections are the intent; [Implementation](#implementation) records the shipped contract where it is more specific.

## Purpose

Explain a generation-run failure with preserved outputs and valid recovery choices.

## Use when

- Failed agent/media run, missing prerequisite or blocked generation requiring user action.

## Do not use for

- Field validation
- normal collection emptiness
- raw provider exception dumps.

## Structure

```text
GenerationError
├── RunContext + FailureSummary
├── Optional PreservedOutputs
└── Authorized RecoveryActions
```

## Allowed controls and composition

- ErrorState/Callout recipe
- Button
- disclosure for safe technical detail
- existing output previews.

## Rules

- Separate recoverable failure, blocker and cancellation; label the supplied state accurately.
- Keep usable outputs and run identity visible.
- Feature determines retry/resume eligibility and provider/billing implications.
- Historical/superseded failures do not gain active actions merely because retry exists.
- Show safe actionable cause; redact sensitive diagnostics before presentation.

## Variants, density and responsive behavior

Retryable failure, prerequisite blocker or terminal failure; action slots stay within the same recovery hierarchy. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Failed/blocked, recovery busy, recovered, cancelled and historical read-only. A retry creates/updates the feature-authorized run, not local optimistic success. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<GenerationError summary={safeFailure} actions={allowedRecoveryActions} />
```

Bad — bypasses the semantic or behavior contract:

```tsx
<GenerationError
	summary={rawProviderPayload}
	actions={<Button onClick={retryWithoutEligibility}>Retry</Button>}
/>
```

## Implementation

`GenerationError` in [generation.tsx](../../../apps/web/src/design-system/patterns/generation.tsx).

```tsx
<GenerationError
	title={error.title}
	code={error.code}
	message={error.message}
	detail={error.technicalDetail}
/>
```

- `title` says what failed, `message` the safe cause, `code` a short reference a person can quote.
- `detail` sits behind a native disclosure. The feature redacts it before passing it in.
- No recovery actions of its own. In the chat, retry and resume are the run's action on GenerationProgress, offered only on the frontier; preserved outputs stay in the card beside the error.

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#agent-run-and-output-cards); [complete consumer inventory](../components.md). Owner: `apps/web/src/design-system/patterns/generation.tsx`. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [AgentErrorCard](../../../apps/web/src/components/editor/chat-output-cards.tsx) — current source candidate at line 45; not proof of target-pattern compliance.

## Acceptance evidence

Exercise active and historical failure, retained partial media, unavailable retry and repeated recovery failure; verify safe details and authorized actions. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.
