#!/usr/bin/env bun
/* Build and drive the Rust editor engine from TS tooling.
 *
 *   bun scripts/editor-engine.mts build    # release WASM → target/wasm32-unknown-unknown/release/
 *
 * The WASM build needs rustup's toolchain (pinned by rust-toolchain.toml, with
 * the wasm32 target). Homebrew's `rust` has no wasm32 standard library, and a
 * rustup `cargo` still runs whichever `rustc` comes first on PATH, so rustup's
 * directory is put first for the build. Uses `node:child_process` so Playwright
 * (Node) and Bun can both import it. */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { optimizeEditorWasm } from "./optimize-editor-wasm.mts";
import { buildParityCases, type ParityCase } from "../packages/shared/src/editor/engine-parity.ts";

export {
	generatedEdits,
	runParityCases,
	type ParityCase,
	type ParityResult,
} from "../packages/shared/src/editor/engine-parity.ts";
import { syntheticCorpusScope } from "../packages/shared/src/editor/corpus/synthetic.ts";
import type { EditorCommand } from "../packages/shared/src/editor/commands.ts";
import type { EditScope } from "../packages/shared/src/editor/scope.ts";

/* `.mts` so Node (Playwright) loads it as an ES module even though the root
 * package is not `"type": "module"`; it imports ESM from `@maleo/shared`. */
export const REPO_ROOT = join(import.meta.dirname, "..");
export const ENGINE_WASM = join(
	REPO_ROOT,
	"target/wasm32-unknown-unknown/release/maleo_editor_wasm.optimized.wasm",
);
const HOMEBREW_RUSTUP = "/opt/homebrew/opt/rustup/bin/rustup";

function rustupDir(): string {
	const onPath = spawnSync("sh", ["-c", "command -v rustup"], { encoding: "utf8" }).stdout.trim();
	const rustup = onPath || (existsSync(HOMEBREW_RUSTUP) ? HOMEBREW_RUSTUP : "");
	if (!rustup)
		throw new Error(
			"rustup not found: install it (brew install rustup) — the WASM build needs the wasm32-unknown-unknown target pinned in rust-toolchain.toml",
		);
	/* Homebrew links only `rustup` into its bin; the `cargo` proxy sits beside the
	 * real binary, as it does in a standard ~/.cargo/bin install. */
	return dirname(realpathSync(rustup));
}

export function cargo(args: string[], input?: string): string {
	const dir = rustupDir();
	const env = { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` };
	/* The absolute path: a runtime may resolve a bare name with its own PATH, not `env`'s. */
	return execFileSync(join(dir, "cargo"), args, {
		cwd: REPO_ROOT,
		env,
		input,
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
		stdio: ["pipe", "pipe", "inherit"],
	});
}

/** Build the release WASM engine and return its path. Cargo makes repeat builds cheap. */
export function buildEditorWasm(): string {
	cargo([
		"build",
		"--release",
		"--quiet",
		"-p",
		"maleo-editor-wasm",
		"--target",
		"wasm32-unknown-unknown",
	]);
	const raw = ENGINE_WASM.replace(".optimized.wasm", ".wasm");
	if (!existsSync(raw)) throw new Error(`build finished without ${raw}`);
	return optimizeEditorWasm(raw);
}

/** Run parity cases through the native engine (`crates/editor-wasm/src/bin/parity.rs`). */
export function runNativeParity(cases: unknown[]): unknown {
	const out: unknown = JSON.parse(
		cargo(
			["run", "--release", "--quiet", "-p", "maleo-editor-wasm", "--bin", "parity"],
			JSON.stringify(cases),
		),
	);
	return out;
}

const EDITOR_DIR = join(REPO_ROOT, "packages/shared/src/editor");
const jsonIn = (dir: string): string[] =>
	readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => join(dir, name));

export interface ParityFixture {
	scope: EditScope;
	command: EditorCommand;
}

export interface ParityInputs {
	fixtures: ParityFixture[];
	corpus: EditScope[];
}

/** Every golden fixture, plus the real-project corpus and the synthetic scope. */
export function loadParityInputs(): ParityInputs {
	const fixtureRoot = join(EDITOR_DIR, "fixtures");
	// SAFETY: golden fixtures; `commands.test.ts` asserts every file's scope/command shape on each run.
	const fixtures = readdirSync(fixtureRoot)
		.sort()
		.flatMap((type) => jsonIn(join(fixtureRoot, type)))
		.map((path) => JSON.parse(readFileSync(path, "utf8")) as ParityFixture);
	// SAFETY: exported corpus scopes; `commands.invert.test.ts` admits and round-trips every one on each run.
	const corpus = jsonIn(join(EDITOR_DIR, "corpus/scopes")).map(
		(path) => JSON.parse(readFileSync(path, "utf8")) as EditScope,
	);
	return { fixtures, corpus: [...corpus, syntheticCorpusScope()] };
}

export function parityCases(): ParityCase[] {
	const { fixtures, corpus } = loadParityInputs();
	return buildParityCases(fixtures, corpus);
}

/** Frozen TS execution reference: sorted JSON ignores only object key order. */
export function executorDigest(value: unknown): string {
	const sorted = (item: unknown): unknown =>
		Array.isArray(item)
			? item.map(sorted)
			: item !== null && typeof item === "object"
				? Object.fromEntries(
						Object.entries(item)
							.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
							.map(([key, child]) => [key, sorted(child)]),
					)
				: item;
	return createHash("sha256")
		.update(JSON.stringify(sorted(value)))
		.digest("hex")
		.slice(0, 16);
}

if (import.meta.main) {
	const [command] = process.argv.slice(2);
	if (command !== "build") {
		console.error("usage: bun scripts/editor-engine.mts build");
		process.exit(2);
	}
	console.log(buildEditorWasm());
}
