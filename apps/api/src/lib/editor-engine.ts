/* The Rust editor engine in the API (`migrate-editor-to-shared-rust-core`,
 * task 4.6): the one executor agent edits run through, the same module the web
 * editor executes with.
 *
 * Loaded once per process, synchronously, on first use, from the release build
 * of `crates/` (`bun scripts/editor-engine.mts build`; the Docker image builds
 * it in its own stage and copies it to the same path). */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { instantiateEngineSync, type Engine } from "@maleo/shared/editor";

export const EDITOR_ENGINE_WASM = join(
	import.meta.dir,
	"../../../../target/wasm32-unknown-unknown/release/maleo_editor_wasm.optimized.wasm",
);

let engine: Engine | undefined;

export function editorEngine(): Engine {
	if (engine) return engine;
	if (!existsSync(EDITOR_ENGINE_WASM))
		throw new Error(
			`the editor engine is not built: run \`bun scripts/editor-engine.mts build\` (expected ${EDITOR_ENGINE_WASM})`,
		);
	engine = instantiateEngineSync(readFileSync(EDITOR_ENGINE_WASM));
	return engine;
}
