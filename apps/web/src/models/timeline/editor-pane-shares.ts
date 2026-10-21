import type { EditorPaneSizes } from "./editor-chrome.ts";

export const DEFAULT_EDITOR_PANE_SHARES: EditorPaneSizes = {
	tools: 0.35,
	inspector: 0.35,
	timeline: 0.5,
};
const STORAGE_KEY = "maleo.editorPaneShares";

export function loadEditorPaneShares(
	storage: Pick<Storage, "getItem"> | null = null,
): EditorPaneSizes {
	try {
		const stored: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null");
		const shares = { ...DEFAULT_EDITOR_PANE_SHARES };
		if (!stored || typeof stored !== "object") return shares;
		for (const [pane, value] of Object.entries(stored)) {
			if (pane !== "tools" && pane !== "inspector" && pane !== "timeline") continue;
			if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1)
				shares[pane] = value;
		}
		return shares;
	} catch {
		return { ...DEFAULT_EDITOR_PANE_SHARES };
	}
}

export function saveEditorPaneShares(
	shares: EditorPaneSizes,
	storage: Pick<Storage, "setItem"> | null = null,
): void {
	try {
		storage?.setItem(STORAGE_KEY, JSON.stringify(shares));
	} catch {
		/* Blocked storage leaves resizing usable for this editor session. */
	}
}
