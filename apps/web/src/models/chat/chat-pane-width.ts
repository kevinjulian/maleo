/* The desktop chat pane's width: bounded, remembered, and never the first thing
 * to give way.
 *
 * Below 380px a decision card and the composer no longer fit at once, so that is
 * the floor; above 520px the editor loses more than chat gains. The width is
 * local chrome — it belongs to this browser, not to the project — and a stored
 * value is clamped on read so a width saved on another screen cannot produce an
 * unusable pane. */

export const CHAT_PANE_MIN = 380;
export const CHAT_PANE_MAX = 520;
export const CHAT_PANE_DEFAULT = 400;
/** Keyboard resize step. */
export const CHAT_PANE_STEP = 20;
const STORAGE_KEY = "maleo.chatPaneWidth";

export function clampChatPaneWidth(width: number): number {
	if (!Number.isFinite(width)) return CHAT_PANE_DEFAULT;
	return Math.round(Math.min(CHAT_PANE_MAX, Math.max(CHAT_PANE_MIN, width)));
}

export function loadChatPaneWidth(
	storage: Pick<Storage, "getItem"> | null = safeStorage(),
): number {
	try {
		const raw = storage?.getItem(STORAGE_KEY);
		return raw == null ? CHAT_PANE_DEFAULT : clampChatPaneWidth(Number(raw));
	} catch {
		return CHAT_PANE_DEFAULT;
	}
}

export function saveChatPaneWidth(
	width: number,
	storage: Pick<Storage, "setItem"> | null = safeStorage(),
): void {
	try {
		storage?.setItem(STORAGE_KEY, String(clampChatPaneWidth(width)));
	} catch {
		// Private mode or blocked storage: the width simply is not remembered.
	}
}

function safeStorage(): Storage | null {
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
}

/* The desktop editor's other columns, as the layout sizes them: the icon rail
 * (`--tl2-rail-w`), the narrowest useful preview, and the docked inspector at
 * the top of its `clamp(340px, 28vw, 380px)` track (stage.css). Omitting the
 * inspector slot removes its track, so collapsing needs no width override. */
export const EDITOR_RAIL_WIDTH = 54;
export const EDITOR_PREVIEW_MIN = 480;
export const EDITOR_INSPECTOR_WIDTH = 380;

/* Whether the inspector has to fold away for chat to keep its floor.
 *
 * The editor needs `editorMin` beside the chat pane; the inspector takes
 * `inspectorWidth` more. When all three do not fit, the inspector goes first. */
export function shouldCollapseInspector(input: {
	available: number;
	chatWidth: number;
	editorMin: number;
	inspectorWidth: number;
}): boolean {
	return (
		input.available < clampChatPaneWidth(input.chatWidth) + input.editorMin + input.inspectorWidth
	);
}
