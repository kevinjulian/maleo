/* The timeline editor inside the phone's `Editor | Chat` workspace.
 *
 * Owns what the Editor/Chat split means for THIS editor, so the editor itself
 * does not: which view is showing, that the phone lands on Editor, and that the
 * clip's sheets stay with the Editor view. Above the breakpoint it renders the
 * editor and nothing else — see phone-workspace.tsx. */
import { useEffect } from "react";
import type { JSX, ReactNode } from "react";
import { PhoneWorkspace, type WorkspaceView } from "@components/editor/phone-workspace.tsx";
import { runIndicator } from "@models/chat/chat-feed.ts";
import {
	useChromeField,
	useChromeSetter,
	type EditorChromeStore,
} from "@stores/editor-chrome-store.ts";
import { TimelineChatPanel, type TimelineChatPanelProps } from "./timeline-chat-panel.tsx";

export interface TimelinePhoneWorkspaceProps {
	phone: boolean;
	chromeStore: EditorChromeStore;
	panel: Omit<TimelineChatPanelProps, "onClose" | "onShowEditor">;
	children: ReactNode;
}

export function TimelinePhoneWorkspace({
	phone,
	chromeStore,
	panel,
	children,
}: TimelinePhoneWorkspaceProps): JSX.Element {
	const [rail, setRail] = useChromeField(chromeStore, "rail");
	const [panelOpen, setPanelOpen] = useChromeField(chromeStore, "panelOpen");
	const setBottomSheet = useChromeSetter(chromeStore, "bottomSheet");

	/* The panel opens by default, which is right for a column beside the stage
	 * and wrong on a phone, where the default rail is chat and an open chat is
	 * the whole Chat view. The store starts closed on a phone, so the first
	 * render is Editor; this covers a rotation into phone width. Closing on the
	 * transition rather than on every render leaves a deliberate open alone. */
	useEffect(() => {
		if (phone) setPanelOpen(false);
	}, [phone, setPanelOpen]);

	/* Chat open IS the Chat view — the same two fields the rail and every "ask
	 * chat about this" action already write, so none of them needs to know which
	 * housing chat is in. */
	const chatView = phone && panelOpen && rail === "chat";
	const setView = (view: WorkspaceView): void => {
		if (view === "chat") {
			setRail("chat");
			setPanelOpen(true);
		} else setPanelOpen(false);
	};
	/* The clip's sheets portal to the body, outside the view that hides the
	 * editor, so they would sit over Chat. They belong to the Editor view. */
	useEffect(() => {
		if (chatView) setBottomSheet("none");
	}, [chatView, setBottomSheet]);

	const { chat } = panel;
	return (
		<PhoneWorkspace
			enabled={phone}
			view={chatView ? "chat" : "editor"}
			onViewChange={setView}
			indicator={runIndicator(chat.messages, {
				running: chat.running,
				interruptedJobId: chat.interrupted?.jobId,
			})}
			chat={
				<TimelineChatPanel
					{...panel}
					onClose={() => setPanelOpen(false)}
					onShowEditor={() => setPanelOpen(false)}
				/>
			}
		>
			{children}
		</PhoneWorkspace>
	);
}
