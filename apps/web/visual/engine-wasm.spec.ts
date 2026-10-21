/* The Rust editor engine's WASM build, in a real browser, against native Rust
 * (`migrate-editor-to-shared-rust-core`, task 2.3).
 *
 * The page gets the release `.wasm` and a bundle of the same TS loader and
 * parity runner the API uses (`packages/shared/src/editor/engine.ts`,
 * `engine-parity.ts`), runs every parity case — golden fixtures, corpus edits,
 * handle sequences, refusals, tick rounding — and must produce exactly what
 * `crates/editor-wasm/src/bin/parity.rs` produces natively. */
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildEditorWasm,
	parityCases,
	REPO_ROOT,
	runNativeParity,
} from "../../../scripts/editor-engine.mts";
import type {
	ParityCase,
	ParityResult,
} from "../../../packages/shared/src/editor/engine-parity.ts";

declare global {
	interface Window {
		engineParity(wasmBase64: string, cases: ParityCase[]): Promise<ParityResult[]>;
	}
}

/* The loader and runner, bundled for the page by the repo's own bundler. */
function browserBundle(): string {
	const dir = mkdtempSync(join(tmpdir(), "engine-parity-"));
	const entry = join(dir, "entry.ts");
	const editor = join(REPO_ROOT, "packages/shared/src/editor");
	writeFileSync(
		entry,
		[
			`import { instantiateEngine } from ${JSON.stringify(join(editor, "engine.ts"))};`,
			`import { runParityCases } from ${JSON.stringify(join(editor, "engine-parity.ts"))};`,
			"window.engineParity = async (wasmBase64, cases) => {",
			"\tconst bytes = Uint8Array.from(atob(wasmBase64), (c) => c.charCodeAt(0));",
			"\treturn runParityCases(await instantiateEngine(bytes), cases);",
			"};",
		].join("\n"),
	);
	const out = join(dir, "bundle.js");
	execFileSync("bun", ["build", entry, "--target=browser", "--outfile", out], {
		stdio: ["ignore", "ignore", "inherit"],
	});
	return readFileSync(out, "utf8");
}

test("the WASM engine in a real browser matches native Rust on every parity case", async ({
	page,
}) => {
	test.setTimeout(300_000);
	const wasm = readFileSync(buildEditorWasm());
	const cases = parityCases();
	const native = runNativeParity(cases);
	expect(native).toHaveLength(cases.length);

	await page.setContent("<!doctype html><title>editor engine parity</title>");
	await page.addScriptTag({ content: browserBundle() });
	const inBrowser = await page.evaluate(
		({ wasmBase64, cases }) => window.engineParity(wasmBase64, cases),
		{ wasmBase64: wasm.toString("base64"), cases },
	);

	/* Strings inside results (scopes, inverses, errors) compare byte for byte. */
	expect(inBrowser).toEqual(native);
	const executed = inBrowser.filter((result) => "ok" in result).length;
	expect(executed, "edits actually executed, not only refused").toBeGreaterThan(100);
});
