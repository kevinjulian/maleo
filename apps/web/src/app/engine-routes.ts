/* `/editor-engine.wasm`: the Rust editor engine's release build
 * (`migrate-editor-to-shared-rust-core`). The editor route fetches it before it
 * mounts the editor (`services/editor-engine/engine-loader.ts`); it is a build
 * output of `crates/` (`bun scripts/editor-engine.mts build`, and the
 * Dockerfile's engine stage), not a bundle module. Absent, it answers 404 and
 * the editor shows that it could not start. */
import { join } from "node:path";

const ENGINE_WASM = join(
	import.meta.dir,
	"../../../../target/wasm32-unknown-unknown/release/maleo_editor_wasm.optimized.wasm",
);

export function engineRoutes() {
	return {
		"/editor-engine.wasm": async (): Promise<Response> => {
			const file = Bun.file(ENGINE_WASM);
			return (await file.exists())
				? new Response(file, { headers: { "content-type": "application/wasm" } })
				: new Response(null, { status: 404 });
		},
	};
}
