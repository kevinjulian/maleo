/* TEST SUPPORT ONLY: the release WASM engine, built from `crates/` if needed,
 * for web tests that run the editor's real executor and edit policies. */
import { readFileSync } from "node:fs";
import { instantiateEngine, type Engine } from "@maleo/shared/editor";
import { buildEditorWasm } from "../../../../../scripts/editor-engine.mts";

export const testEngine: Engine = await instantiateEngine(readFileSync(buildEditorWasm()));
