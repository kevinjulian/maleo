/* The editor's chrome, tested without a document, a store or a player — which is
 * the point of separating it. None of these rules could be reached before: they
 * lived inside a 2,300-line component whose test file imports a different module. */
import { describe, expect, test } from "vite-plus/test";
import {
	clampMenuToViewport,
	clampEditorPanes,
	isTypingTarget,
	acceptsDocumentUndo,
	ownsKeyboard,
	railTargetForKey,
	resolveTimelineHeight,
	stepPlaybackRate,
} from "./editor-chrome.ts";
import { PLAYBACK_RATES } from "./timeline-editor-model.ts";

const RAIL = [
	"media",
	"chat",
	"style",
	"templates",
	"elements",
	"transitions",
	"effects",
	"captions",
	"settings",
	"tenth",
] as const;
const key = (
	over: Partial<{ altKey: boolean; metaKey: boolean; ctrlKey: boolean; code: string }> = {},
) => ({ altKey: true, metaKey: false, ctrlKey: false, code: "Digit1", ...over });

describe("rail shortcuts", () => {
	test("Alt+1 selects the first destination, Alt+0 the tenth", () => {
		expect(railTargetForKey(RAIL, key({ code: "Digit1" }), false)).toBe("media");
		expect(railTargetForKey(RAIL, key({ code: "Digit0" }), false)).toBe("tenth");
	});

	test("Cmd or Ctrl is left to the browser's tab switching", () => {
		expect(railTargetForKey(RAIL, key({ metaKey: true }), false)).toBeNull();
		expect(railTargetForKey(RAIL, key({ ctrlKey: true }), false)).toBeNull();
	});

	test("a bare digit is a digit", () => {
		expect(railTargetForKey(RAIL, key({ altKey: false }), false)).toBeNull();
	});

	test("typing wins over the shortcut", () => {
		expect(railTargetForKey(RAIL, key(), true)).toBeNull();
	});

	test("a non-digit key selects nothing", () => {
		expect(railTargetForKey(RAIL, key({ code: "KeyA" }), false)).toBeNull();
	});

	test("a digit past the rail's length selects nothing", () => {
		expect(railTargetForKey(RAIL.slice(0, 3), key({ code: "Digit9" }), false)).toBeNull();
	});
});

describe("typing targets", () => {
	test("inputs, textareas and contenteditable take the key", () => {
		expect(isTypingTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
		expect(isTypingTarget({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
		expect(
			isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget),
		).toBe(true);
	});

	test("an ordinary element does not", () => {
		expect(
			isTypingTarget({ tagName: "DIV", isContentEditable: false } as unknown as EventTarget),
		).toBe(false);
		expect(isTypingTarget(null)).toBe(false);
	});

	test("only a clean field that opts in hands undo to the document", () => {
		const field = (value: string | null) =>
			({ tagName: "TEXTAREA", getAttribute: () => value }) as unknown as EventTarget;
		expect(acceptsDocumentUndo(field("clean"))).toBe(true);
		expect(acceptsDocumentUndo(field(null))).toBe(false);
		expect(acceptsDocumentUndo({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(false);
		expect(acceptsDocumentUndo(null)).toBe(false);
	});
});

describe("playback speed", () => {
	test("steps through the rates and stops at each end", () => {
		expect(stepPlaybackRate(1, 1)).toBe(1.5);
		expect(stepPlaybackRate(1, -1)).toBe(0.5);
		expect(stepPlaybackRate(PLAYBACK_RATES[0]!, -1)).toBe(PLAYBACK_RATES[0]!);
		expect(stepPlaybackRate(PLAYBACK_RATES.at(-1)!, 1)).toBe(PLAYBACK_RATES.at(-1)!);
	});

	test("an unrecognised rate is treated as 1x", () => {
		expect(stepPlaybackRate(3.7, 1)).toBe(1.5);
	});
});

describe("stage resize", () => {
	const stage = { bottom: 900, height: 800 };

	test("the timeline follows the pointer", () => {
		expect(resolveTimelineHeight(stage, 600)).toBe(300);
	});

	test("neither pane can be dragged shut", () => {
		expect(resolveTimelineHeight(stage, 899)).toBe(220);
		expect(resolveTimelineHeight(stage, 0)).toBe(580);
	});

	test("a stage shorter than both minimums still yields a usable height", () => {
		expect(resolveTimelineHeight({ bottom: 300, height: 300 }, 100)).toBe(150);
	});

	test("pane clamps retain preview through extreme drags and chat-constrained desktop", () => {
		for (const width of [1400, 700, 400, 200])
			for (const height of [800, 300]) {
				const result = clampEditorPanes(width, height, true, {
					tools: 10000,
					inspector: 10000,
					timeline: 10000,
				});
				expect(result.tools).toBeGreaterThan(0);
				expect(result.inspector).toBeGreaterThan(0);
				expect(result.tools + result.inspector).toBeLessThan(width - 32);
				expect(result.timeline).toBeLessThanOrEqual(height - 24);
				expect(result.timeline).toBeGreaterThan(0);
			}
	});

	test("hidden tools use rail width; negative drags cannot collapse panes", () => {
		const hidden = clampEditorPanes(1000, 800, false, {
			tools: 500,
			inspector: 300,
			timeline: 250,
		});
		expect(hidden.tools).toBe(41);
		const minimum = clampEditorPanes(1000, 800, true, {
			tools: -500,
			inspector: -500,
			timeline: -500,
		});
		expect(minimum).toEqual({ tools: 220, inspector: 200, timeline: 220 });
	});
});

describe("menu placement", () => {
	const viewport = { width: 1000, height: 800 };
	const size = { width: 200, height: 300 };

	test("a menu with room opens where it was asked to", () => {
		expect(clampMenuToViewport({ x: 100, y: 100 }, size, viewport)).toEqual({ x: 100, y: 100 });
	});

	test("a menu near the right or bottom edge is pulled back into view", () => {
		expect(clampMenuToViewport({ x: 990, y: 790 }, size, viewport)).toEqual({ x: 792, y: 492 });
	});

	test("a menu at the origin keeps a margin", () => {
		expect(clampMenuToViewport({ x: 0, y: 0 }, size, viewport)).toEqual({ x: 8, y: 8 });
	});
});

describe("ownsKeyboard", () => {
	// Plain objects stand in for elements: the guard reads only `closest`, as the DOM-free tests above do.
	const target = (value: { closest?: (selector: string) => object | null }): EventTarget =>
		Object.assign(new EventTarget(), value);
	const at = (match: string | null) =>
		target({
			closest: (selector: string) => (match && selector.split(",").includes(match) ? {} : null),
		});
	test("widgets that consume keys own every key, so editor shortcuts stand aside", () => {
		for (const widget of [
			"select",
			"[role=combobox]",
			"[role=slider]",
			"[role=listbox]",
			"[role=spinbutton]",
			"[role=menu]",
			"[role=tablist]",
			"[role=radiogroup]",
		])
			expect(ownsKeyboard(at(widget))).toBe(true);
	});
	test("plain buttons and the editor surface do not", () => {
		expect(ownsKeyboard(at("button"))).toBe(false);
		expect(ownsKeyboard(at(null))).toBe(false);
		expect(ownsKeyboard(null)).toBe(false);
		expect(ownsKeyboard(target({}))).toBe(false);
	});
});
