// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test } from "vite-plus/test";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useKeyboardShortcuts } = await import("./use-keyboard-shortcuts.ts");
type Options = Parameters<typeof useKeyboardShortcuts>[0];

const calls: string[] = [];
const values: Partial<Options> = {
	editTarget: null,
	clipboard: [],
	selectedFreeIds: new Set(),
	selectedFreeId: null,
	selectedOverlayId: null,
	selectedAudioId: null,
	selectedVideoOvId: null,
	selectedEffectId: null,
	selectedTransition: null,
	editorScene: undefined,
	freeClips: [],
	total: 10,
	selectionIds: () => ["video:1"],
};
// Every action records its name, so a test reads which shortcut fired.
const options = new Proxy(values, {
	get: (target, key: string) =>
		key in target
			? target[key as keyof Options]
			: () => {
					calls.push(key);
				},
}) as Options;
function Harness() {
	useKeyboardShortcuts(options);
	return null;
}
let root: ReturnType<typeof createRoot>;
beforeEach(async () => {
	calls.length = 0;
	root = createRoot(document.createElement("div"));
	await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
	await act(async () => root.unmount());
	document.body.innerHTML = "";
});

test("a focused select or slider keeps its keys; the timeline does not split or delete", () => {
	document.body.innerHTML = `<select><option>a</option></select><div role="slider" tabindex="0"></div><button>Play</button>`;
	for (const target of [
		document.querySelector("select")!,
		document.querySelector("[role=slider]")!,
	])
		for (const key of ["s", "q", "Delete", "0"])
			target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
	expect(calls).toEqual([]);
	document
		.querySelector("button")!
		.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
	expect(calls).toEqual(["splitAtPlayhead"]);
});

test("copy with highlighted page text leaves the system clipboard alone", () => {
	document.body.innerHTML = `<p>Quote this</p>`;
	const range = document.createRange();
	range.selectNodeContents(document.querySelector("p")!);
	window.getSelection()!.removeAllRanges();
	window.getSelection()!.addRange(range);
	const event = new Event("copy", { bubbles: true, cancelable: true });
	document.body.dispatchEvent(event);
	expect(event.defaultPrevented).toBe(false);
	expect(calls).toEqual([]);
	window.getSelection()!.removeAllRanges();
	const clip = new Event("copy", { bubbles: true, cancelable: true });
	document.body.dispatchEvent(clip);
	expect(clip.defaultPrevented).toBe(true);
	expect(calls).toEqual(["copySelection"]);
});

test("Space owns playback before button and widget handlers and ignores repeat/release", () => {
	document.body.innerHTML =
		'<button>Delete</button><a href="#">Link</a><input type="checkbox"><div role="listbox" tabindex="0"></div>';
	for (const target of document.body.children) {
		calls.length = 0;
		target.addEventListener("keydown", () => calls.push("control"));
		for (const [type, repeat] of [
			["keydown", false],
			["keydown", true],
			["keyup", false],
		] as const) {
			const e = new KeyboardEvent(type, {
				code: "Space",
				key: " ",
				repeat,
				bubbles: true,
				cancelable: true,
			});
			target.dispatchEvent(e);
			expect(e.defaultPrevented).toBe(true);
		}
		expect(calls).toEqual(["togglePlay"]);
	}
});

test("editable text, composition and independent dialogs keep Space", () => {
	document.body.innerHTML =
		'<input><textarea></textarea><div contenteditable="true"><span>Text</span></div><div role="dialog"><button>Confirm</button></div>';
	for (const target of document.querySelectorAll(
		"input,textarea,[contenteditable], [role=dialog] button",
	)) {
		const e = new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true });
		target.dispatchEvent(e);
		expect(e.defaultPrevented).toBe(false);
	}
	document.body.dispatchEvent(
		new KeyboardEvent("keydown", { code: "Space", isComposing: true, bubbles: true }),
	);
	expect(calls).toEqual([]);
});

test("Enter activates editor checkboxes once while disabled and modal controls keep their scope", () => {
	document.body.innerHTML =
		'<input type="checkbox"><button role="checkbox">Select</button><input type="checkbox" disabled><div role="dialog"><input type="checkbox"></div>';
	const native = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
	const button = document.querySelector<HTMLButtonElement>('button[role="checkbox"]')!;
	button.addEventListener("click", () => calls.push("select"));
	for (const target of [native, button])
		for (const [type, repeat] of [
			["keydown", false],
			["keydown", true],
			["keyup", false],
		] as const)
			target.dispatchEvent(
				new KeyboardEvent(type, { key: "Enter", repeat, bubbles: true, cancelable: true }),
			);
	expect(native.checked).toBe(true);
	expect(calls).toEqual(["select"]);
	const disabled = document.querySelector<HTMLInputElement>("input[disabled]")!;
	disabled.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
	);
	expect(disabled.checked).toBe(false);
	const modal = document.querySelector("[role=dialog] input")!,
		event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
	modal.dispatchEvent(event);
	expect(event.defaultPrevented).toBe(false);
});
