/* The renderer module is served from the build output, and only compare mode
 * reaches for it. Bun suite: the routes read files through `Bun.file`, the
 * runtime that serves them. */
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { RENDERER_FILES, rendererRoutes } from "./renderer-routes.ts";

describe("renderer routes", () => {
	test("serve the module and its glue with their content types", async () => {
		const dir = mkdtempSync(join(tmpdir(), "maleo-renderer-"));
		writeFileSync(join(dir, "maleo_renderer_wasm.js"), "export default 1;");
		writeFileSync(join(dir, "maleo_renderer_wasm_bg.wasm"), new Uint8Array([0, 97, 115, 109]));
		const routes = rendererRoutes(dir);
		const glue = await routes["/renderer/maleo_renderer_wasm.js"]!();
		expect(glue.status).toBe(200);
		expect(glue.headers.get("content-type")).toBe(RENDERER_FILES["maleo_renderer_wasm.js"]);
		expect(await glue.text()).toBe("export default 1;");
		const wasm = await routes["/renderer/maleo_renderer_wasm_bg.wasm"]!();
		expect(wasm.headers.get("content-type")).toBe("application/wasm");
		expect(new Uint8Array(await wasm.arrayBuffer())).toEqual(new Uint8Array([0, 97, 115, 109]));
	});

	test("serve the preview worker as JavaScript", async () => {
		const dir = mkdtempSync(join(tmpdir(), "maleo-renderer-"));
		writeFileSync(join(dir, "preview-worker.js"), "postMessage(1);");
		const worker = await rendererRoutes(dir)["/renderer/preview-worker.js"]!();
		expect(worker.status).toBe(200);
		expect(worker.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
		expect(await worker.text()).toBe("postMessage(1);");
	});

	test("answer 404 when the module has not been built", async () => {
		const routes = rendererRoutes(mkdtempSync(join(tmpdir(), "maleo-renderer-empty-")));
		expect((await routes["/renderer/maleo_renderer_wasm.js"]!()).status).toBe(404);
	});

	test("no module but compare mode and its worker names the renderer files", () => {
		const src = join(import.meta.dir, "..");
		const files = (dir: string): string[] =>
			readdirSync(dir).flatMap((entry) => {
				const path = join(dir, entry);
				return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(entry) ? [path] : [];
			});
		const naming = files(src)
			.filter((path) => !/\.test\.tsx?$/.test(path))
			.filter((path) => /\/renderer\/|maleo_renderer_wasm/.test(readFileSync(path, "utf8")))
			.map((path) => path.slice(src.length + 1))
			.sort();
		expect(naming).toEqual([
			"app/renderer-routes.ts",
			"hooks/timeline/use-rust-compare.ts",
			"preview-worker/worker.ts",
		]);
	});
});
