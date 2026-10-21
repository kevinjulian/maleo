# ChatMessage

**Status:** Implemented and in production (OpenSpec audit-ui-system task 10.5, done) in the editor chat. Earlier sections are the intent; [Implementation](#implementation) records the shipped contract where it is more specific.

## Purpose

Present one conversational entry with clear speaker, content and attached outputs.

## Use when

- User/assistant messages in a project conversation, including streamed content and run references.

## Do not use for

- Notifications
- editor property rows
- merging separate message/run identities into one anonymous block.

## Structure

```text
ChatMessage
├── Speaker / Context
├── MessageContent
├── Optional ToolCall / GenerationCard
└── Optional MessageActions
```

## Allowed controls and composition

- Avatar
- text/owned content renderer
- ToolCall
- GenerationCard
- IconButton/DropdownMenu for permitted message actions.

## Rules

- Preserve message identity, chronology and speaker semantics.
- Use one readable content hierarchy; do not invent card chrome per tool/provider.
- Feature owns trust/sanitization of content and allowed commands; shared presentation does not execute embedded commands.
- Streaming updates should not force scroll away from a user reading history.
- Historical actions obey supplied eligibility; attach run outputs to the correct message.

## Variants, density and responsive behavior

User, assistant or system/context entries; streaming/final and output attachments preserve the common structure. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Streaming, complete, failed send, historical/read-only and selected text. Do not announce every streamed token. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<ChatMessage speaker="assistant" content={safeContent}>
	<GenerationCard run={runPresentation} />
</ChatMessage>
```

Bad — bypasses the semantic or behavior contract:

```tsx
<div className="bg-[#191919]" onClick={executeTextCommand}>
	{rawMessage}
</div>
```

## Implementation

`ChatMessage` in [chat.tsx](../../../apps/web/src/design-system/patterns/chat.tsx), styled by [chat.css](../../../apps/web/src/design-system/patterns/chat.css); stories under `Patterns/Chat`.

```tsx
<ChatMessage speaker="user">{run.user.text}</ChatMessage>
<ChatMessage speaker="assistant" held={held ? "Proposed, not applied" : undefined}><ChatMarkdown text={m.text} /></ChatMessage>
```

- `speaker` is `user` (a bubble on the user's side) or `assistant` (prose across the column, marked with the assistant glyph). There is no avatar and no card: the conversation's only bordered surface is an output.
- Content is `children`. The feature renders and sanitises it (the chat passes its markdown renderer); the pattern executes nothing.
- `held` labels an assistant message whose change did not land and dims it, so it reads as a proposal.
- `action` makes the message pressable when it points at something (`{ label: "Jump to clip", onPress }`); the text reads as a link. History passes none. Other actions stay on the run, not on a message.

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#agent-run-and-output-cards); [complete consumer inventory](../components.md). Owner: `apps/web/src/design-system/patterns/chat.tsx`. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [ThinkingCard](../../../apps/web/src/components/editor/chat-run-cards.tsx) — current source candidate at line 10; not proof of target-pattern compliance.
- [AgentErrorCard](../../../apps/web/src/components/editor/chat-output-cards.tsx) — current source candidate at line 45; not proof of target-pattern compliance.

## Acceptance evidence

Check long messages, tool/output attachments, failed send, stream completion and reading history on phone; verify speaker/message identity and action access. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.
