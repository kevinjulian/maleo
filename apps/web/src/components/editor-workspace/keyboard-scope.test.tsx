import { describe, expect, test } from "vite-plus/test";
import { VuiKeyboardScope } from "./keyboard-scope.tsx";

type ShortcutHandler = (event: {
	target: EventTarget | null;
	key: string;
	metaKey?: boolean;
	ctrlKey?: boolean;
	stopPropagation: () => void;
}) => void;

function handler(options: Parameters<typeof VuiKeyboardScope>[0]): ShortcutHandler {
	const element = VuiKeyboardScope(options) as unknown as {
		props: { onKeyDownCapture?: ShortcutHandler };
	};
	return element.props.onKeyDownCapture!;
}

function event(
	key: string,
	target: EventTarget | null = null,
	modifiers: { metaKey?: boolean; ctrlKey?: boolean } = {},
): Parameters<ShortcutHandler>[0] {
	return { key, target, metaKey: false, ctrlKey: false, ...modifiers, stopPropagation() {} };
}

const editingTarget = { closest: () => ({}) } as unknown as EventTarget;
const editorTarget = { closest: () => null } as unknown as EventTarget;

describe("VUI keyboard scope", () => {
	test("keeps native editing ahead of default shortcuts", () => {
		const calls: string[] = [];
		const onShortcut = (name: string): void => {
			calls.push(name);
		};
		const onKeyDown = handler({ children: null, onShortcut: onShortcut as never });
		onKeyDown(event(" ", editingTarget));
		onKeyDown(event("Delete", editingTarget));
		onKeyDown(event(" ", editorTarget));
		expect(calls).toEqual(["play"]);
	});

	test("focused buttons and checkboxes receive Space before editor playback", () => {
		const calls: string[] = [];
		const onKeyDown = handler({ children: null, onShortcut: (name) => calls.push(name) });
		for (const selector of ["button", "[role=checkbox]", "select", "[role=slider]"]) {
			const target = {
				closest: (query: string) => (query.split(",").includes(selector) ? {} : null),
			} as unknown as EventTarget;
			onKeyDown(event(" ", target));
		}
		expect(calls).toEqual([]);
	});

	test("after clicking a button, Delete/undo/redo/save still reach the editor", () => {
		const calls: string[] = [];
		const onKeyDown = handler({ children: null, onShortcut: (name) => calls.push(name) });
		for (const selector of ["button", "a[href]", "[role=checkbox]"]) {
			const target = {
				closest: (query: string) => (query.split(",").includes(selector) ? {} : null),
			} as unknown as EventTarget;
			onKeyDown(event("Delete", target));
			onKeyDown(event("z", target, { metaKey: true }));
			onKeyDown(event("y", target, { ctrlKey: true }));
			onKeyDown(event("s", target, { metaKey: true }));
		}
		expect(calls).toEqual(
			Array.from({ length: 3 }, () => ["delete", "undo", "redo", "save"]).flat(),
		);
	});

	test("honors shortcut overrides and disabled commands", () => {
		const calls: string[] = [];
		const onKeyDown = handler({
			children: null,
			shortcuts: { play: "p", delete: false },
			onShortcut: (name) => calls.push(name),
		});
		onKeyDown(event("p", editorTarget));
		onKeyDown(event(" ", editorTarget));
		onKeyDown(event("Delete", editorTarget));
		expect(calls).toEqual(["play"]);
	});

	test("keeps nested scopes isolated", () => {
		const calls: string[] = [];
		const outer = handler({ children: null, onShortcut: (name) => calls.push(`outer:${name}`) });
		const inner = handler({ children: null, onShortcut: (name) => calls.push(`inner:${name}`) });
		let stopped = false;
		const nestedEvent = {
			...event(" ", editorTarget),
			stopPropagation: () => {
				stopped = true;
			},
		};
		inner(nestedEvent);
		if (!stopped) outer(nestedEvent);
		expect(calls).toEqual(["inner:play"]);
	});
});
