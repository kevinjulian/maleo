/* The chat composer: the context line, the text box, and the two completion menus.
 *
 * `/` offers commands and `@` offers project entities; they share one menu and
 * one set of keys, but never trigger each other. Choosing from either only
 * edits the text — nothing is sent until the user sends it.
 *
 * The box stays editable while a run works. Sending then prepares the single
 * `Send after current` instruction instead of a second run. A free-text answer
 * to a parked question is only ever sent from the explicit `Replying to` mode. */
import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, JSX, KeyboardEvent, RefObject } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { isComposingKey } from "@models/core/keys.ts";
import { Button } from "@design-system/components/button.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import {
	detectCommandTrigger,
	filterChatCommands,
	insertCommandPrompt,
	type ChatCommandOption,
} from "@models/chat/chat-commands.ts";
import {
	detectEntityMention,
	entityMentionCandidates,
	insertEntityMention,
	type ChatMention,
	type ComposerFocusPreview,
} from "@models/chat/chat-composer.ts";
import type { ChatProjectIndex } from "@maleo/shared";
import { PromptComposer } from "@design-system/patterns/prompt-composer.tsx";
import type { ChatScopeChip } from "@models/chat/chat-log.ts";
import { ChatModelPicker } from "./chat-model-picker.tsx";
import type { ChatModelSelection } from "@hooks/editor/use-chat-model-selection.ts";

type MenuItem =
	| { kind: "command"; key: string; token: string; detail: string; command: ChatCommandOption }
	| {
			kind: "entity";
			key: string;
			token: string;
			detail: string;
			entry: ChatProjectIndex["story"][number];
	  };

export interface ChatComposerBoxProps {
	model?: ChatModelSelection;
	value: string;
	onChange: (value: string) => void;
	inputRef: RefObject<HTMLTextAreaElement | null>;
	commands: ChatCommandOption[];
	/** Live focus preview; absent when no editor is attached. */
	preview?: ComposerFocusPreview;
	onRemoveChip: (chip: ChatScopeChip) => void;
	onMention: (mention: ChatMention) => void;
	/** A run is executing: sending queues instead of starting another. */
	running: boolean;
	queued: string | null;
	onEditQueued: () => void;
	onRemoveQueued: () => void;
	replyingTo: string | null;
	onCancelReply: () => void;
	onSubmit: (text: string) => void;
	placeholder?: string;
}

const CONTEXT_LIMIT = 3;
const KIND_LABEL: Record<string, string> = {
	section: "Section",
	scene: "Scene",
	beat: "Beat",
	slide: "Slide",
	post: "Post",
	clip: "Clip",
	material: "Material",
	reference: "Reference",
};

export function ChatComposerBox(props: ChatComposerBoxProps): JSX.Element {
	const {
		value,
		onChange,
		inputRef,
		commands,
		preview,
		onRemoveChip,
		onMention,
		running,
		queued,
		onEditQueued,
		onRemoveQueued,
		replyingTo,
		onCancelReply,
		onSubmit,
		placeholder,
	} = props;
	const [cursor, setCursor] = useState<number | null>(null);
	const [active, setActive] = useState(0);
	const [dismissed, setDismissed] = useState(false);
	const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const menuId = useId();

	const at = cursor ?? value.length;
	const commandTrigger = cursor == null || dismissed ? null : detectCommandTrigger(value, at);
	const entityTrigger =
		cursor == null || dismissed || commandTrigger ? null : detectEntityMention(value, at);
	const items: MenuItem[] = commandTrigger
		? filterChatCommands(commands, commandTrigger.query).map((command) => ({
				kind: "command",
				key: command.id,
				token: command.command,
				detail: command.intent,
				command,
			}))
		: entityTrigger && preview
			? entityMentionCandidates(preview.index, entityTrigger.query).map((entry) => ({
					kind: "entity",
					key: `${entry.kind}:${entry.id}`,
					token: `@${entry.label}`,
					detail: KIND_LABEL[entry.kind] ?? entry.kind,
					entry,
				}))
			: [];
	const menuOpen = Boolean(commandTrigger || (entityTrigger && preview));

	useEffect(() => {
		setActive(0);
	}, [commandTrigger?.query, entityTrigger?.query]);
	useEffect(() => {
		if (menuOpen) itemRefs.current[active]?.scrollIntoView({ block: "nearest" });
	}, [active, menuOpen]);

	const placeCaret = (next: number): void => {
		requestAnimationFrame(() => {
			const box = inputRef.current;
			if (!box) return;
			box.focus();
			box.selectionStart = next;
			box.selectionEnd = next;
			setCursor(next);
		});
	};
	const choose = (item: MenuItem): void => {
		if (item.kind === "command" && commandTrigger) {
			const next = insertCommandPrompt(value, commandTrigger, item.command);
			onChange(next.value);
			placeCaret(next.cursor);
		} else if (item.kind === "entity" && entityTrigger) {
			const next = insertEntityMention(value, entityTrigger, item.entry);
			onChange(next.value);
			onMention(next.mention);
			placeCaret(next.cursor);
		}
		setDismissed(true);
	};

	const onInput = (event: ChangeEvent<HTMLTextAreaElement>): void => {
		onChange(event.target.value);
		setCursor(event.target.selectionStart ?? event.target.value.length);
		setDismissed(false);
	};
	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		if (menuOpen) {
			if (event.key === "Escape") {
				event.preventDefault();
				setDismissed(true);
				return;
			}
			if (items.length && event.key === "ArrowDown") {
				event.preventDefault();
				setActive((i) => (i + 1) % items.length);
				return;
			}
			if (items.length && event.key === "ArrowUp") {
				event.preventDefault();
				setActive((i) => (i - 1 + items.length) % items.length);
				return;
			}
			if (
				items.length &&
				(event.key === "Tab" || event.key === "Enter") &&
				!isComposingKey(event)
			) {
				event.preventDefault();
				const item = items[active];
				if (item) choose(item);
				return;
			}
		}
		if (event.key === "Escape" && replyingTo) {
			event.preventDefault();
			onCancelReply();
		}
		// Sending on Enter is the composer's; this only claims the keys above.
	};

	const sendLabel = replyingTo
		? "Send reply"
		: running
			? queued
				? "Replace queued instruction"
				: "Send after current"
			: "Send";
	/* Whole-project focus is the default and says nothing, so it shows no line.
	 * The rest reads as one quiet line; past three labels it counts instead. */
	const specific = (preview?.chips ?? []).filter((chip) => chip.source !== "project");
	const context = specific.slice(0, CONTEXT_LIMIT);
	const overflow = specific.length - context.length;

	return (
		<PromptComposer
			className="fc-composer"
			label={replyingTo ? "Reply" : "Instruction"}
			canSubmit={
				Boolean(value.trim()) &&
				(Boolean(replyingTo) ||
					!props.model ||
					(props.model.valid && !props.model.saving && !props.model.saveError))
			}
			tools={props.model && <ChatModelPicker model={props.model} />}
			value={value}
			onValueChange={(_, event) => onInput(event)}
			onSubmit={() => onSubmit(value)}
			onKeyDown={onKeyDown}
			elevated
			inputRef={inputRef}
			placeholder={
				placeholder ??
				(replyingTo
					? "Type your answer"
					: running
						? "Queue the next instruction…"
						: "Describe a change — / for commands, @ for project items")
			}
			submitLabel={sendLabel}
			inputProps={{
				"aria-autocomplete": "list",
				"aria-expanded": menuOpen,
				"aria-controls": menuOpen ? menuId : undefined,
				"aria-activedescendant": menuOpen && items[active] ? `${menuId}-${active}` : undefined,
				onSelect: (event) => setCursor(event.currentTarget.selectionStart ?? value.length),
				onBlur: () => window.setTimeout(() => setCursor(null), 140),
			}}
			context={
				<>
					{queued != null && (
						<div className="fc-queued" role="status">
							<span className="fc-queued-label">Send after current</span>
							<span className="fc-queued-text">{queued}</span>
							<span className="fc-queued-actions">
								<Button variant="secondary" size="sm" onClick={onEditQueued}>
									Edit
								</Button>
								<Button variant="secondary" size="sm" onClick={onRemoveQueued}>
									Remove
								</Button>
							</span>
						</div>
					)}
					{replyingTo != null && (
						<div className="fc-replying" role="status">
							<span>
								<b>Replying to</b> {replyingTo}
							</span>
							<IconButton
								size="micro"
								className="fc-context-x"
								onClick={onCancelReply}
								aria-label="Cancel reply"
							>
								{Ic.x(ICON.xs)}
							</IconButton>
						</div>
					)}
					{replyingTo == null && (context.length > 0 || preview?.ambiguous) && (
						<div className="fc-context" role="group" aria-label="Context for the next instruction">
							<span className="fc-context-k">About</span>
							{context.map((chip) => (
								<span
									key={`${chip.kind}:${chip.id}`}
									className="fc-context-item"
									data-source={chip.source}
								>
									{chip.label}
									<IconButton
										size="micro"
										className="fc-context-x"
										onClick={() => onRemoveChip(chip)}
										aria-label={`Remove ${chip.label} from context`}
									>
										{Ic.x(ICON.xs)}
									</IconButton>
								</span>
							))}
							{overflow > 0 && <span className="fc-context-more">+{overflow}</span>}
							{preview?.ambiguous && (
								<span className="fc-context-warn">
									“{preview.ambiguous.phrase}” matches {preview.ambiguous.labels.length} — type @ to
									pick one
								</span>
							)}
						</div>
					)}
				</>
			}
			popup={
				menuOpen ? (
					<div
						id={menuId}
						className="tl2-mention-pop fc-command-pop"
						role="listbox"
						aria-label={commandTrigger ? "Commands" : "Project items"}
					>
						{items.length ? (
							items.map((item, idx) => (
								<button
									key={item.key}
									id={`${menuId}-${idx}`}
									type="button"
									tabIndex={-1}
									ref={(el) => {
										itemRefs.current[idx] = el;
									}}
									className={`tl2-mention-item ${idx === active ? "active" : ""}`}
									role="option"
									aria-selected={idx === active}
									onMouseDown={(event) => {
										event.preventDefault();
										choose(item);
									}}
									onMouseEnter={() => setActive(idx)}
								>
									<span className="fc-command-token">{item.token}</span>
									<span className="fc-command-intent">{item.detail}</span>
								</button>
							))
						) : (
							<div className="tl2-mention-empty">
								{commandTrigger ? "No matching commands" : "No matching project items"}
							</div>
						)}
					</div>
				) : null
			}
		/>
	);
}
