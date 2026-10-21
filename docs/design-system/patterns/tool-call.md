# ToolCall

**Status:** Implemented and in production (OpenSpec audit-ui-system task 10.5, done) in the editor chat. Earlier sections are the intent; [Implementation](#implementation) records the shipped contract where it is more specific.

## Purpose

Present one tool invocation and its lifecycle without overwhelming conversation.

## Use when

- Agent research, media or workflow tool execution shown within a message or activity view.

## Do not use for

- Raw logs as primary chat content
- turning every successful tool into a new bespoke card.

## Structure

```text
ToolCall
├── Name + StateSummary
├── Optional Disclosure
└── Safe Inputs / Result / ErrorDetail
```

## Allowed controls and composition

- Badge
- Button/IconButton disclosure
- ErrorState/Callout for safe failure
- owned text/detail renderer.

## Rules

- Use stable invocation identity and a human-readable task summary.
- Keep details collapsible; do not expose secret arguments or full provider payloads.
- Disclosure has a name, expanded state and keyboard access.
- Tool state reflects supplied lifecycle; a running tool is not automatically an assistant answer.
- Feature supplies retry authority; presentation never replays a tool from displayed arguments.

## Variants, density and responsive behavior

Compact summary or expanded safe detail; tool-kind-specific content fits detail slots rather than alternate header/layout. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Queued/running, succeeded, failed and cancelled; historical detail remains readable with no inappropriate replay action. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<ToolCall name="Find references" state="running" details={safeDetails} />
```

Bad — bypasses the semantic or behavior contract:

```tsx
<ToolCall details={allArgumentsIncludingCredentials} onClick={() => rerunFromDisplayedArgs()} />
```

## Implementation

`ToolCall` in [chat.tsx](../../../apps/web/src/design-system/patterns/chat.tsx).

```tsx
<ToolCall name="patch scene" status="running" />
<ToolCall name="patch scene" status="error" note="Planning timed out: the planner did not answer in time." />
```

- A line of text, not a card: the lifecycle in words (`running`, `called`, `failed`) and the readable `name`. A spinner shows only while running.
- `note` is one safe line about what it did or why it failed; `thumbs` are small previews of what it produced. Arguments and provider payloads are never passed in.
- No disclosure of its own and no retry: in the chat the run's Activity section is the disclosure that folds tool calls away, and retry belongs to the run.

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#audit-and-historical-activity); [complete consumer inventory](../components.md). Owner: `apps/web/src/design-system/patterns/chat.tsx`. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [ToolRow](../../../apps/web/src/components/editor/audit-panel.tsx) — current source candidate at line 143; not proof of target-pattern compliance.

## Acceptance evidence

Check parallel tool identities, success/failure, disclosure keyboard/focus, safe diagnostics and narrow long results. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.
