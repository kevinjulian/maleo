import { expect, test } from "vite-plus/test";
import {
	DEFAULT_EDITOR_PANE_SHARES,
	loadEditorPaneShares,
	saveEditorPaneShares,
} from "./editor-pane-shares.ts";

test("panel shares default, round-trip, and recover from invalid or blocked storage", () => {
	expect(loadEditorPaneShares(null)).toEqual({ tools: 0.35, inspector: 0.35, timeline: 0.5 });
	let raw = "";
	const storage = {
		getItem: () => raw,
		setItem: (_key: string, value: string) => {
			raw = value;
		},
	};
	const resized = { tools: 0.4, inspector: 0.25, timeline: 0.55 };
	saveEditorPaneShares(resized, storage);
	expect(loadEditorPaneShares(storage)).toEqual(resized);
	raw = '{"tools":-1,"inspector":"0.4","timeline":0.7}';
	expect(loadEditorPaneShares(storage)).toEqual({ ...DEFAULT_EDITOR_PANE_SHARES, timeline: 0.7 });
	raw = "broken";
	expect(loadEditorPaneShares(storage)).toEqual(DEFAULT_EDITOR_PANE_SHARES);
	expect(
		loadEditorPaneShares({
			getItem: () => {
				throw new Error("blocked");
			},
		}),
	).toEqual(DEFAULT_EDITOR_PANE_SHARES);
	expect(() =>
		saveEditorPaneShares(resized, {
			setItem: () => {
				throw new Error("blocked");
			},
		}),
	).not.toThrow();
});
