/* Vitest global setup: build the editor engine once, before any worker starts.
 *
 * Every worker reads `MALEO_TEST_EDITOR_WASM` in `test-db-guard.ts` and skips
 * cargo when it is set. Without this, each worker that reaches the engine runs
 * `cargo build` itself, and while one build re-links the raw `.wasm` another
 * worker can find it missing ("build finished without …"). */
import { buildEditorWasm } from "./editor-engine.mts";

export default function setup(): void {
	process.env.MALEO_TEST_EDITOR_WASM ??= buildEditorWasm();
}
