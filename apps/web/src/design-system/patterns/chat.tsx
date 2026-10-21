/* ChatMessage and ToolCall — one entry in a conversation, and one tool the
 * assistant used on the way.
 *
 * Both are presentation only. The feature decides what the text is, renders it
 * (markdown, plain) and passes it as children; nothing here runs a command or
 * replays a tool from what it displays.
 */
import type { JSX, ReactNode } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { cn } from "@models/core/cn.ts";
import { Spinner } from "@design-system/components/spinner.tsx";
import "./chat.css";

export interface ChatMessageProps {
	/** Who said it. The user's is a bubble on their side; the assistant's is
	 *  prose across the column, marked with the assistant glyph. */
	speaker: "user" | "assistant";
	/** The assistant described a change that did not land. Shown as a proposal:
	 *  dimmed, and labelled with this text. */
	held?: string;
	/** The message points at something: pressing it goes there. `label` says
	 *  where ("Jump to clip"). Omit for history, which offers nothing. */
	action?: { label: string; onPress: () => void };
	className?: string;
	children: ReactNode;
}

export function ChatMessage({
	speaker,
	held,
	action,
	className,
	children: content,
}: ChatMessageProps): JSX.Element {
	const children = action ? (
		<button type="button" className="ui-chat-link" title={action.label} onClick={action.onPress}>
			{content}
		</button>
	) : (
		content
	);
	if (speaker === "user")
		return (
			<div data-slot="chat-message" data-speaker="user" className={cn("ui-chat-msg", className)}>
				{children}
			</div>
		);
	return (
		<div
			data-slot="chat-message"
			data-speaker="assistant"
			data-held={held ? "" : undefined}
			className={cn("ui-chat-prose", className)}
		>
			{Ic.spark(ICON.xs)}
			<div>
				{held && <span className="ui-chat-held">{held}</span>}
				{children}
			</div>
		</div>
	);
}

export interface ToolCallProps {
	/** A readable task name: "patch scene", not `patch_scene`. */
	name: string;
	/** The lifecycle the feature reports. A running tool is not an answer. */
	status: "running" | "done" | "error";
	/** One safe line about what it did, or why it failed. Never raw arguments. */
	note?: ReactNode;
	/** Small previews of what it produced. */
	thumbs?: readonly string[];
	className?: string;
}

const VERB = { running: "running", done: "called", error: "failed" } as const;

export function ToolCall({ name, status, note, thumbs, className }: ToolCallProps): JSX.Element {
	return (
		<div data-slot="tool-call" data-status={status} className={cn("ui-chat-tool", className)}>
			<div className="ui-chat-tool-h">
				{status === "running" && <Spinner size="xs" />}
				{VERB[status]} {name}
			</div>
			{note != null && note !== "" && <div className="ui-chat-tool-note">{note}</div>}
			{thumbs && thumbs.length > 0 && (
				<div className="ui-chat-tool-thumbs">
					{thumbs.map((src) => (
						<img key={src} src={src} alt="Result preview" loading="lazy" />
					))}
				</div>
			)}
		</div>
	);
}
