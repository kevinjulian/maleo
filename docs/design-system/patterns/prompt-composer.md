# PromptComposer

**Status:** Implemented and in production (OpenSpec audit-ui-system task 10.4, done): the editor chat, the image lab and the speech lab. Earlier sections are the intent; [Implementation](#implementation) records the shipped contract where it is more specific.

## Purpose

Compose and submit a prompt with predictable keyboard, attachment and busy semantics.

## Use when

- Project chat and image/speech prompt entry where submission starts an authorized operation.

## Do not use for

- Application settings textareas
- inspector multiline properties
- a new per-feature keyboard submit contract.

## Structure

```text
PromptComposer
├── Label / Context
├── TextEntry
├── Optional Attachments / PromptOptions
└── Submit + Optional Cancel / Status
```

## Allowed controls and composition

- Textarea/owned mention-input recipe
- Button/IconButton
- Popover/Select for options
- Badge/Chip recipe for attachments.

## Rules

- Text entry has a persistent accessible name; placeholder alone is insufficient.
- Use the reviewed Enter-submit/Shift+Enter-newline contract; composition Enter must not submit.
- Preserve drafts/attachments on failure; do not clear until the feature acknowledges the appropriate submission state.
- Feature owns validation, provider choice, limits and request dispatch.
- Name send/close actions and show unavailable/busy state; do not fork composer padding and action placement per feature.

## Variants, density and responsive behavior

Chat, image and speech context/options; explicit multiline behavior and responsive action placement retain a common submit contract. Use [foundation roles](../foundations.md#target-grammar), not feature-local visual values.

## Accessibility and states

Empty, ready, composing IME, submitting, failed and disabled. Attachments can be pending/failed without falsely appearing ready. Controls keep their accessible behavior when composed; color/hover alone cannot carry essential meaning. Values and allowed actions come from the feature; this pattern does not own IO or authority.

## Examples

Good — preserves intent and the owned composition:

```tsx
<PromptComposer label="Message" value={draft} onSubmit={authorizedSubmit} />
```

Bad — bypasses the semantic or behavior contract:

```tsx
<textarea onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Ask anything" />
```

## Implementation

`PromptComposer` in [prompt-composer.tsx](../../../apps/web/src/design-system/patterns/prompt-composer.tsx), styled by [prompt-composer.css](../../../apps/web/src/design-system/patterns/prompt-composer.css); stories under `Patterns/PromptComposer`.

```tsx
<PromptComposer label="Image prompt" value={prompt} onValueChange={setPrompt} onSubmit={generate}
  canSubmit={!blocked} busy={busy} disabled={busy || !workspace}
  submitLabel="Generate image" busyLabel="Generating image" tools={…} elevated />
```

- `label` is required and names the text entry. `value` / `onValueChange` are controlled: the composer never clears the draft, so a failed send leaves the text and the feature clears it when the submission is accepted.
- Enter sends, Shift+Enter adds a line, and the Enter that confirms an input-method candidate does neither (`isSubmitEnter`). Enter never adds a line, whether or not the send is accepted.
- `canSubmit` is the feature's answer to "would a send be accepted now"; it defaults to "there is text". `busy` reports a send in flight (`aria-busy`, spinner, `busyLabel`) and ignores further sends. `disabled` means the entry cannot be typed in.
- The send control is the canonical `IconButton`, named by `submitLabel`.
- Slots: `context` above the box (what the prompt is about, queued text, attachments), `tools` below the text inside the box (ratio, voice, references), `popup` anchored to the box (a mention or command list).
- `onKeyDown` runs before the send rule and may claim a key with `preventDefault()`; `inputProps` carries combobox wiring. The chat's command and mention list uses both.
- Focus is shown once, on the box. The entry grows to 120px, then scrolls. `elevated` lifts the box where it floats over a scrolling page.
- Parts are found by `data-prompt="input"` and `data-prompt="submit"`.
- Project chat composes its canonical model Select in `tools`. The feature owns
  discovery, immediate preference saving, Retry, queue capture, and send validation.
  Chat uses the shared entry height, send icon, elevation, and focus treatment.
- Not built: an attachment-chip slot with pending and failed states, and a Cancel control. The image lab's reference chips and both labs' option popovers are still their own markup.

## Current usages and ownership

[Current usage family and screen evidence](../patterns.md#chat-and-generation-composers); [complete consumer inventory](../components.md). Owner: `apps/web/src/design-system/patterns/prompt-composer.tsx`. Feature/VUI behavior owners remain as specified in [principles.md](../principles.md).

- [ChatComposerBox](../../../apps/web/src/components/editor/chat-composer-box.tsx) — current source candidate at line 47; not proof of target-pattern compliance.
- [PromptComposer](../../../apps/web/src/components/image-lab/prompt-composer.tsx) — current source candidate at line 16; not proof of target-pattern compliance.

## Acceptance evidence

Exercise Enter/Shift+Enter/composition, send failure, attachment failure, focus preservation and disabled/busy on real chat/image/speech surfaces. Test relevant theme, narrow/desktop, keyboard, disabled/busy/error and coarse-pointer states before approval. Source/screenshot presence alone does not approve this specification or implementation. Record proof, exceptions and review in OpenSpec (private historical record), not a local task checklist.
