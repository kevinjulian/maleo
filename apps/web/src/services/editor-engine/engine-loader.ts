/* The Rust editor engine, fetched once per page (`migrate-editor-to-shared-rust-core`,
 * task 4.5).
 *
 * The engine is the editor's write authority, so the editor route waits for it
 * before it mounts. It is a separate file the web server serves at
 * `/editor-engine.wasm` (`app/engine-routes.ts`), never part of the
 * initial bundle, and a failed load may be retried. */
import { instantiateEngine, provideEditorEngine, type Engine } from "@maleo/shared/editor";

export const ENGINE_WASM_PATH = "/editor-engine.wasm";

let loading: Promise<Engine> | undefined;
let loaded: Engine | undefined;

async function fetchEngine(): Promise<Engine> {
	const response = await fetch(ENGINE_WASM_PATH);
	if (!response.ok) throw new Error(`${ENGINE_WASM_PATH} answered ${response.status}`);
	loaded = await instantiateEngine(await response.arrayBuffer());
	provideEditorEngine(loaded);
	return loaded;
}

/** The engine once `loadEditorEngine` has resolved. A pointer sample cannot
 *  wait for a promise; the editor route mounts only after the load. */
export function loadedEditorEngine(): Engine | undefined {
	return loaded;
}

/** The page's engine; a rejected load is forgotten so the next call retries. */
export function loadEditorEngine(): Promise<Engine> {
	loading ??= fetchEngine().catch((error: unknown) => {
		loading = undefined;
		throw error;
	});
	return loading;
}
