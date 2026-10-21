/* The chat pane beside a workspace and the button that brings it back — or,
 * on a phone, the Chat view beside the workspace's Editor view.
 *
 * Image and text both wrap their surface in this exact shell — the same
 * aside, the same collapse button, differing only in the quick commands
 * offered. It was written out twice.
 */
import { useEffect } from "react";
import type { JSX, ReactNode } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import type { ChatEditorBridge, useChatSession } from "@hooks/editor/use-chat-session.ts";
import { usePhoneLayout } from "@hooks/editor/use-phone-layout.ts";
import { runIndicator } from "@models/chat/chat-feed.ts";
import { PhoneWorkspace } from "./phone-workspace.tsx";
import { ChatPanel } from "./editor-chat.tsx";
import { ChatPaneResizeHandle } from "./chat-pane-resize.tsx";
import { useChatPaneWidth } from "@hooks/editor/use-chat-pane-width.ts";

export interface ChatSplitProps {
	/* Typed from the hook that produces it rather than restated: a hand-copied
	 * signature is a second source of truth that drifts without failing. */
	chat: ReturnType<typeof useChatSession>;
	projectId: string | null;
	quickCommands: string[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Class on the content side; the text workspace adds its rail state. */
	mainClassName?: string;
	children: ReactNode;
}

export function ChatSplit({
	chat,
	projectId,
	quickCommands,
	open,
	onOpenChange,
	mainClassName = "cv-chatsplit-main",
	children,
}: ChatSplitProps): JSX.Element {
	const phone = usePhoneLayout();
	const chatWidth = useChatPaneWidth();

	/* Chat opens by default, which suits a column beside the workspace. On a
	 * phone the same flag is the Editor | Chat view, and the operator came to see
	 * their work first. The shell store already STARTS closed on a phone, so the
	 * first render is Editor; this covers a rotation into phone width.
	 * Keyed on the phone transition only. Depending on `open` as well would slam
	 * Chat shut every time it was deliberately opened. */
	useEffect(() => {
		if (phone) onOpenChange(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [phone]);

	/* On a phone, `Show changes` has to cross to the view that shows them. */
	const base = chat.editor;
	const editor: ChatEditorBridge | undefined =
		phone && base
			? {
					...base,
					reveal: (refs) => {
						onOpenChange(false);
						base.reveal(refs);
					},
				}
			: base;

	const panel = (
		<ChatPanel
			scenes={[]}
			messages={chat.messages}
			setMessages={chat.setMessages}
			onRunCommand={chat.run}
			onAnswerQuestion={chat.answer}
			busy={chat.running}
			onStop={chat.stop}
			projectId={projectId}
			interrupted={chat.interrupted}
			onResume={() => void chat.resume()}
			quickCommands={quickCommands}
			editor={editor}
			onClose={() => onOpenChange(false)}
		/>
	);

	/* On a phone the pane cannot be a column — 360px of a 393px viewport leaves
	 * nothing to chat *about* — and a partial sheet cannot hold a workspace chat.
	 * Chat becomes the other view of this workspace instead. */
	if (phone) {
		return (
			<PhoneWorkspace
				enabled
				page
				view={open ? "chat" : "editor"}
				onViewChange={(view) => onOpenChange(view === "chat")}
				indicator={runIndicator(chat.messages, {
					running: chat.running,
					interruptedJobId: chat.interrupted?.jobId,
				})}
				chat={panel}
			>
				<div className={mainClassName}>{children}</div>
			</PhoneWorkspace>
		);
	}

	return (
		<div className="cv-chatsplit">
			{open ? (
				<aside className="cv-chatpane" style={{ width: chatWidth }}>
					{panel}
					<ChatPaneResizeHandle />
				</aside>
			) : (
				<button className="cv-chatreopen" onClick={() => onOpenChange(true)} title="Show chat">
					{Ic.spark(ICON.md)}
				</button>
			)}
			<div className={mainClassName}>{children}</div>
		</div>
	);
}
