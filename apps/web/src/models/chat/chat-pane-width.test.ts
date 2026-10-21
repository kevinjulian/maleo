import { describe, expect, test } from "vite-plus/test";
import {
	CHAT_PANE_DEFAULT,
	CHAT_PANE_MAX,
	CHAT_PANE_MIN,
	clampChatPaneWidth,
	loadChatPaneWidth,
	saveChatPaneWidth,
	shouldCollapseInspector,
} from "./chat-pane-width.ts";

const memory = (initial?: string) => {
	const data = new Map<string, string>(initial == null ? [] : [["maleo.chatPaneWidth", initial]]);
	return {
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => {
			data.set(k, v);
		},
		data,
	};
};

describe("chat pane width", () => {
	test("clamps to 380-520", () => {
		expect(clampChatPaneWidth(100)).toBe(CHAT_PANE_MIN);
		expect(clampChatPaneWidth(9000)).toBe(CHAT_PANE_MAX);
		expect(clampChatPaneWidth(451.6)).toBe(452);
		expect(clampChatPaneWidth(Number.NaN)).toBe(CHAT_PANE_DEFAULT);
	});

	test("a stale stored width is clamped on load", () => {
		expect(loadChatPaneWidth(memory("1200"))).toBe(CHAT_PANE_MAX);
		expect(loadChatPaneWidth(memory("garbage"))).toBe(CHAT_PANE_DEFAULT);
		expect(loadChatPaneWidth(memory())).toBe(CHAT_PANE_DEFAULT);
		expect(loadChatPaneWidth(null)).toBe(CHAT_PANE_DEFAULT);
		expect(
			loadChatPaneWidth({
				getItem: () => {
					throw new Error("blocked");
				},
			}),
		).toBe(CHAT_PANE_DEFAULT);
	});

	test("saves the clamped width and survives blocked storage", () => {
		const store = memory();
		saveChatPaneWidth(10, store);
		expect(store.data.get("maleo.chatPaneWidth")).toBe(String(CHAT_PANE_MIN));
		expect(() =>
			saveChatPaneWidth(400, {
				setItem: () => {
					throw new Error("quota");
				},
			}),
		).not.toThrow();
	});

	test("the inspector collapses before chat drops below its floor", () => {
		expect(
			shouldCollapseInspector({
				available: 1400,
				chatWidth: 400,
				editorMin: 480,
				inspectorWidth: 320,
			}),
		).toBe(false);
		expect(
			shouldCollapseInspector({
				available: 1100,
				chatWidth: 400,
				editorMin: 480,
				inspectorWidth: 320,
			}),
		).toBe(true);
		expect(
			shouldCollapseInspector({
				available: 1180,
				chatWidth: 200,
				editorMin: 480,
				inspectorWidth: 320,
			}),
		).toBe(false);
	});
});
