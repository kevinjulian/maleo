/* The chat pane's width, shared by everything that lays out around it.
 *
 * One value in this browser, not per project and not per surface: the timeline's
 * chat panel, the image/text chat column and the editor deciding whether its
 * inspector still fits all read the same number. Stored clamped (see
 * `chat-pane-width.ts`), so every reader sees a usable width. */
import { useEffect, useState, useSyncExternalStore } from "react";
import {
	clampChatPaneWidth,
	loadChatPaneWidth,
	saveChatPaneWidth,
	shouldCollapseInspector,
	EDITOR_INSPECTOR_WIDTH,
	EDITOR_PREVIEW_MIN,
	EDITOR_RAIL_WIDTH,
} from "@models/chat/chat-pane-width.ts";
import { useChromeField, type EditorChromeStore } from "@stores/editor-chrome-store.ts";

let width: number | null = null;
const listeners = new Set<() => void>();

const read = (): number => {
	if (width === null) width = loadChatPaneWidth();
	return width;
};

export function setChatPaneWidth(next: number): void {
	const clamped = clampChatPaneWidth(next);
	if (clamped === read()) return;
	width = clamped;
	saveChatPaneWidth(clamped);
	for (const listener of listeners) listener();
}

const subscribe = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

export function useChatPaneWidth(): number {
	return useSyncExternalStore(subscribe, read, read);
}

/** The viewport's CSS width, kept current across resizes. */
export function useViewportWidth(): number {
	const [viewport, setViewport] = useState(() =>
		typeof window === "undefined" ? 1440 : window.innerWidth,
	);
	useEffect(() => {
		const onResize = (): void => setViewport(window.innerWidth);
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);
	return viewport;
}

/* Chat has a floor; the timeline editor's inspector does not. When the chat
 * panel, the preview and the inspector cannot all keep their minimums, the
 * inspector folds away first — a chat narrower than its floor cannot show a
 * decision card and the composer at once. */
export function useInspectorYieldsToChat(chrome: EditorChromeStore, phone: boolean): boolean {
	const [rail] = useChromeField(chrome, "rail");
	const [panelOpen] = useChromeField(chrome, "panelOpen");
	const chatWidth = useChatPaneWidth();
	const viewport = useViewportWidth();
	return (
		!phone &&
		panelOpen &&
		rail === "chat" &&
		shouldCollapseInspector({
			available: viewport - EDITOR_RAIL_WIDTH,
			chatWidth,
			editorMin: EDITOR_PREVIEW_MIN,
			inspectorWidth: EDITOR_INSPECTOR_WIDTH,
		})
	);
}
