// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";
import {
	trimClipAtPlayhead,
	editorExecutor,
	type EditorCommand,
	type EditScope,
} from "@maleo/shared/editor";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCommandStack } = await import("./use-command-stack.ts");

test("a command that changes nothing leaves undo and redo untouched", async () => {
	const scope = {
		doc: { clips: [] },
		slides: [],
		posts: [],
		mediaAssets: [],
	} as unknown as EditScope;
	let stack!: ReturnType<typeof useCommandStack>;
	let commits = 0;
	function Harness() {
		stack = useCommandStack({
			executor: editorExecutor,
			scope,
			deps: [],
			commit: () => {
				commits++;
			},
		});
		return null;
	}
	const root = createRoot(document.createElement("div"));
	await act(async () => root.render(createElement(Harness)));
	// Trimming a clip the scope does not hold is refused: the command returns its input.
	const refused: EditorCommand = trimClipAtPlayhead("missing", 1, "before");
	let step: string | null = "unset";
	await act(async () => {
		step = stack.run(refused);
	});
	expect(step).toBeNull();
	expect(stack.canUndo).toBe(false);
	expect(commits).toBe(0);
	await act(async () => root.unmount());
});
