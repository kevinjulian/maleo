#!/usr/bin/env bun
/* Builds the renderer's browser module (crates/renderer-wasm, ADR 0011):
 *
 *   bun scripts/build-renderer-wasm.ts
 *
 * cargo builds the wasm32 release, then the wasm-bindgen CLI writes the module
 * and its JS glue (`--target web`) to target/renderer-wasm/. The CLI must be the
 * version the crate pins:
 *
 *   cargo install wasm-bindgen-cli --version 0.2.129 --locked
 *
 * It also bundles the preview worker (apps/web/src/preview-worker/worker.ts,
 * OpenSpec p2-preview-runtime D5) to target/renderer-wasm/preview-worker.js and
 * the export worker (apps/web/src/export-worker/worker.ts, OpenSpec p2-export
 * E2) to target/renderer-wasm/export-worker.js. `--worker` bundles only the
 * workers (the Dockerfile builds the module in a Rust stage without Bun).
 *
 * The web serves target/renderer-wasm/ at /renderer/ (app/renderer-routes.ts). */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { REPO_ROOT, cargo } from "./editor-engine.mts";

export const RENDERER_WASM_DIR = join(REPO_ROOT, "target/renderer-wasm");

function pinnedVersion(): string {
	const manifest = readFileSync(join(REPO_ROOT, "crates/renderer-wasm/Cargo.toml"), "utf8");
	const pinned = manifest.match(/^wasm-bindgen = "=([0-9.]+)"/m)?.[1];
	if (!pinned) throw new Error("crates/renderer-wasm/Cargo.toml must pin wasm-bindgen with =");
	return pinned;
}

/** `wasm-bindgen` on PATH, else where `cargo install` puts it. */
function wasmBindgen(): string {
	const installed = join(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "bin/wasm-bindgen");
	return existsSync(installed) ? installed : "wasm-bindgen";
}

export function buildRendererWasm(): string {
	const version = pinnedVersion();
	const bindgen = wasmBindgen();
	let cli: string;
	try {
		cli = execFileSync(bindgen, ["--version"], { encoding: "utf8" }).trim();
	} catch {
		throw new Error(
			`wasm-bindgen CLI not found: cargo install wasm-bindgen-cli --version ${version} --locked`,
		);
	}
	if (cli !== `wasm-bindgen ${version}`)
		throw new Error(`${cli} does not match the crate's wasm-bindgen ${version}`);
	cargo([
		"build",
		"--release",
		"--quiet",
		"-p",
		"maleo-renderer-wasm",
		"--target",
		"wasm32-unknown-unknown",
	]);
	execFileSync(
		bindgen,
		[
			"--target",
			"web",
			"--out-dir",
			RENDERER_WASM_DIR,
			join(REPO_ROOT, "target/wasm32-unknown-unknown/release/maleo_renderer_wasm.wasm"),
		],
		{ stdio: "inherit" },
	);
	return join(RENDERER_WASM_DIR, "maleo_renderer_wasm_bg.wasm");
}

async function bundleWorker(entry: string, name: string): Promise<string> {
	const result = await Bun.build({
		entrypoints: [join(REPO_ROOT, entry)],
		outdir: RENDERER_WASM_DIR,
		naming: name,
		target: "browser",
		format: "esm",
		minify: true,
	});
	if (!result.success) throw new AggregateError(result.logs, `${name} bundle failed`);
	return join(RENDERER_WASM_DIR, name);
}

/** Bundles the preview worker beside the module it loads. */
export function buildPreviewWorker(): Promise<string> {
	return bundleWorker("apps/web/src/preview-worker/worker.ts", "preview-worker.js");
}

/** Bundles the export worker beside the module it loads. */
export function buildExportWorker(): Promise<string> {
	return bundleWorker("apps/web/src/export-worker/worker.ts", "export-worker.js");
}

if (import.meta.main) {
	for (const worker of [await buildPreviewWorker(), await buildExportWorker()])
		console.log(`${worker}: ${statSync(worker).size} bytes`);
	if (process.argv.includes("--worker")) process.exit(0);
	const module = buildRendererWasm();
	const raw = statSync(module).size;
	const gzip = gzipSync(readFileSync(module)).length;
	console.log(`${module}: ${raw} bytes, ${gzip} bytes gzip`);
}
