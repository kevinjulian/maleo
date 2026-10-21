# GenerationProgress

**Status:** Implemented and in production (OpenSpec audit-ui-system task 10.5, done) in the editor chat. Earlier sections are the intent; [Implementation](#implementation) records the shipped contract where it is more specific.

## Purpose

Show trustworthy stage/progress for one generation run.

## Use when

- Queued/running generation or an agent stage with known activity or supplied measured progress.

## Do not use for

- Fake percentage from elapsed time
- a generic collection fetch
- completed/failure summaries.

## Structure

```text
GenerationProgress
├── StageLabel
├── DeterminateProgress or IndeterminateActivity
└── Optional SupportingStatus
```

## Allowed controls and composition

- Owned progress indicator recipe
- text
- Badge for bounded state
- optional authorized cancel action via Button.

## Rules

- Use percentage only when the feature supplies a reliable measure; otherwise show stage/activity.
- Keep progress scoped to run identity; parallel runs do not share one ambiguous indicator.
- Announce meaningful stage changes, not every tick.
- Use the normal motion recipe and reduced-motion alternative.
- Completion/failure transitions to the corresponding run presentation.

## Variants, density and responsive behavior

Determinate or indeterminate; compact embedded or expanded stage detail. No extra progress primitive implementation is implied. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Queued, active, waiting, completed, failed and cancelled. Waiting for input is not an endlessly spinning active state. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<GenerationProgress stage="Rendering" progress={reportedProgress} />
```

Bad — bypasses the semantic or behavior contract:

```tsx
<GenerationProgress progress={Math.min(99, elapsedSeconds * 2)} />
```

## Implementation

`GenerationProgress` in [generation.tsx](../../../apps/web/src/design-system/patterns/generation.tsx).

```tsx
<GenerationProgress label="Rewrite narration" running tone="active" count={{ done: 1, total: 3, unit: "steps" }} action={<Button …>Stop</Button>} />
<GenerationProgress label="Partly done" tone="warn" action={…} />
```

- `label` is the stage or outcome in words. `running` shows activity instead of the settled glyph.
- `count` is a measure the feature vouches for. With one, the count is written out ("1/3 steps") and a bar is shown while running; without one there is no bar and no percentage.
- `tone`: `active` while working, `warn` or `error` for a state that needs the user. The feature gives history no tone, so a finished run does not read as a call to act. The state is always in the label as well.
- `action` is the single action the state allows.
- Parts are found by `data-gen="stage"`, `"count"` and `"action"`.
- `announce` makes the stage a polite status, so a screen reader hears it change; the count is left out so a tick does not interrupt. The chat sets it for the frontier run only.
- Not built: a cancel distinct from the action slot.

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#agent-run-and-output-cards); [complete consumer inventory](../components.md). Owner: `apps/web/src/design-system/patterns/generation.tsx`. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [WorkflowProgressCard](../../../apps/web/src/components/editor/chat-run-cards.tsx) — current source candidate at line 31; not proof of target-pattern compliance.

## Acceptance evidence

Check unknown/known progress, stage change, waiting for input, failure and completion; verify run association and reduced-motion/status behavior. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.
