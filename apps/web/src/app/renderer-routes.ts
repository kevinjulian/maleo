/* `/renderer/*`: the Rust renderer's browser module (`crates/renderer-wasm`,
 * ADR 0011) and its wasm-bindgen glue, for the editor's hidden compare mode
 * (`?renderer=compare`, `hooks/timeline/use-rust-compare.ts`). Nothing else
 * requests it. It is a build output of `crates/`
 * (`bun scripts/build-renderer-wasm.ts`, and the Dockerfile's renderer stage),
 * not a bundle module. Absent, it answers 404 and compare mode says so. */
import { join } from "node:path";

const RENDERER_DIR = join(import.meta.dir, "../../../../target/renderer-wasm");

/** The files compare mode loads, by name, with their content types. */
export const RENDERER_FILES: Readonly<Record<string, string>> = {
	"maleo_renderer_wasm.js": "text/javascript; charset=utf-8",
	"maleo_renderer_wasm_bg.wasm": "application/wasm",
};

export function rendererRoutes(dir = RENDERER_DIR): Record<string, () => Promise<Response>> {
	return Object.fromEntries(
		Object.entries(RENDERER_FILES).map(([name, type]) => [
			`/renderer/${name}`,
			async (): Promise<Response> => {
				const file = Bun.file(join(dir, name));
				return (await file.exists())
					? new Response(file, { headers: { "content-type": type } })
					: new Response(null, { status: 404 });
			},
		]),
	);
}
