/* The process's editor engine, for shared code that executes a command outside
 * an editor session: scope-diff's safety net, a canvas preview, a scene edit
 * (`migrate-editor-to-shared-rust-core` 4.10). The engine is the only executor;
 * each host provides it once — the web page when its WASM has loaded, the API on
 * first use, tests from their preload. */
import type { EditorCommand, Execution } from "./commands.ts";
import type { Engine } from "./engine.ts";
import { engineExecutor, type CommandExecutor } from "./engine-executor.ts";
import type { EditScope } from "./scope.ts";

let source: (() => Engine) | undefined;
let loaded: Engine | undefined;
let executor: CommandExecutor | undefined;

/** Provide the engine, or a function that loads it on first use. */
export function provideEditorEngine(engine: Engine | (() => Engine)): void {
	source = typeof engine === "function" ? engine : () => engine;
	loaded = undefined;
	executor = undefined;
}

/** The provided engine, for shared code that calls it directly (`p1-app-core`). */
export function editorEngine(): Engine {
	if (!source) throw new Error("no editor engine provided: call provideEditorEngine first");
	loaded ??= source();
	return loaded;
}

/** Execute `command` against `scope` in the provided engine. Throws
 *  `EngineCommandError` when the engine refuses it; `scope` is then unchanged. */
export function execute(scope: EditScope, command: EditorCommand): Execution {
	executor ??= engineExecutor(editorEngine());
	return executor.execute(scope, command);
}

/** The scope after `command`; the input itself when nothing changed. */
export const applyCommand = (scope: EditScope, command: EditorCommand): EditScope =>
	execute(scope, command).scope;

/** The command that restores `before` after `command`. */
export const invertCommand = (before: EditScope, command: EditorCommand): EditorCommand =>
	execute(before, command).inverse;

/** Shared helpers use the same host-provided execution authority. */
export const editorExecutor: CommandExecutor = { execute };
