# GenerationCard

**Status:** Implemented and in production (OpenSpec audit-ui-system task 10.5, done) in the editor chat. Earlier sections are the intent; [Implementation](#implementation) records the shipped contract where it is more specific.

## Purpose

Present one generation run and its outputs, state and authorized actions.

## Use when

- Image/audio/video or agent runs shown in chat/workspace output history.

## Do not use for

- Generic asset browsing
- one field error
- making permission or active-frontier decisions inside shared presentation.

## Structure

```text
GenerationCard
├── RunIdentity + State
├── GenerationProgress or OutputSummary
├── Optional GenerationError
└── AuthorizedActions
```

## Allowed controls and composition

- GenerationProgress
- GenerationError
- MediaCard/owned output preview
- Badge
- Button/IconButton
- disclosure.

## Rules

- Identify the run/task so updates do not attach to the wrong card.
- Present supplied status consistently; do not infer completion from a preview alone.
- Feature supplies newest-frontier eligibility and allowed actions; historical/superseded runs remain read-only.
- Preserve partial outputs and provenance during failure.
- Use shared surface/hierarchy; do not invent an AI accent color per provider.

## Variants, density and responsive behavior

Active run or historical result; media-kind/output slots preserve run identity/state/action contract. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Queued, running, waiting for input, succeeded, failed, cancelled and superseded as supplied by feature state. Do not fabricate stages. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<GenerationCard run={presentation} actions={authorizedActions} />
```

Bad — bypasses the semantic or behavior contract:

```tsx
<GenerationCard run={oldRun} actions={<Button onClick={resumeAnyRun}>Resume</Button>} />
```

## Implementation

`GenerationCard` in [generation.tsx](../../../apps/web/src/design-system/patterns/generation.tsx), styled by [generation.css](../../../apps/web/src/design-system/patterns/generation.css); stories under `Patterns/Generation`.

```tsx
<GenerationCard phase={phase} busy={phase === "running"} frontier={isFrontier} status={<GenerationProgress … />}>
  {activity}{outputs}{notes}{result}
</GenerationCard>
```

- A column, not a box: the status line, then the run's content in reading order. "Card" is the pattern's name; in the chat a run deliberately has no container.
- `phase` is the feature's own word for the state, exposed as `data-phase`. `busy` sets `aria-busy`. `frontier` marks the newest run, the only one that may be acted on.
- It adds no action. The feature passes the one action its state allows to GenerationProgress, and passes none for history.
- Children are the feature's: tool calls, outputs, a GenerationError, the result.

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#agent-run-and-output-cards); [complete consumer inventory](../components.md). Owner: `apps/web/src/design-system/patterns/generation.tsx`. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [ThinkingCard](../../../apps/web/src/components/editor/chat-run-cards.tsx) — current source candidate at line 10; not proof of target-pattern compliance.
- [WorkflowProgressCard](../../../apps/web/src/components/editor/chat-run-cards.tsx) — current source candidate at line 31; not proof of target-pattern compliance.

## Acceptance evidence

Drive active/history/superseded runs, partial output failure and multi-run updates; verify action eligibility, state transitions and readable phone output. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.
