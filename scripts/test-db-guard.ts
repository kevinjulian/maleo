/* Test preload: never let a test suite touch a production database.
 *
 * `resolveMaleoDbPath()` falls back to `<dataDir>/maleo.db` when MALEO_DB_PATH
 * is unset. Most DB-touching tests set it; many do not, and those wrote straight
 * into data/maleo.db. The result: 18,150 content projects across 137 distinct
 * titles with 3 renders total, a 963 MB file, and every production row count
 * contaminated by fixtures — which matters because migration blast radius is
 * measured in exactly those numbers.
 *
 * This redirects the default to a per-run temp directory. A test that wants its
 * own path still sets MALEO_DB_PATH explicitly and is unaffected.
 *
 * Wired via bunfig.toml `[test] preload` and package `--preload` flags for Bun,
 * and as the root `test.setupFiles` entry for Vitest, so it applies to every
 * suite without each test file having to remember. Bun runs it once per
 * process; Vitest runs it before every test file, in each worker process. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

const temporary = (path: string): boolean => {
	if (!isAbsolute(path)) return false;
	const pathFromTemp = relative(tmpdir(), path);
	return (
		pathFromTemp !== "" &&
		pathFromTemp !== ".." &&
		!pathFromTemp.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
		!isAbsolute(pathFromTemp)
	);
};

function redirect(): void {
	const explicit = process.env.MALEO_DB_PATH?.trim();

	// An explicit test path is safe only under the system temp directory.
	if (explicit && !temporary(explicit)) {
		throw new Error(
			`[test-db-guard] A test set MALEO_DB_PATH outside the temporary directory (${explicit}). ` +
				"Point it at a temp path instead.",
		);
	}
	if (explicit) return; // test manages its own path

	const dir = mkdtempSync(join(tmpdir(), "maleo-test-db-"));
	process.env.MALEO_DB_PATH = join(dir, "maleo.db");
	// MALEO_DATA_DIR also feeds resolveDataDir() for non-DB artifacts, and it is
	// the load-bearing half: with it pointing at a temp dir, a suite that clears
	// MALEO_DB_PATH still falls back to <temp>/maleo.db rather than to the real
	// database. Which is why a suite must RESTORE this variable rather than delete
	// it — three did delete it, and a full `bun test apps/api` then wrote two
	// fixture projects into a developer's data/maleo.db on every run, with this
	// guard installed and green. `test-db-guard-usage.test.ts` pins that.
	process.env.MALEO_DATA_DIR ??= dir;
}

/* The media worker keeps its own SQLite result store, and the repo `.env` points
 * GEN_WORKER_DB at the real one. `bun test` auto-loads that .env, so a suite run
 * from the repo root opened the developer's live worker DB — the metrics test
 * counted rows from real generations and failed at the root while passing inside
 * the package. Same failure mode as the maleo.db contamination above, so it gets
 * the same treatment: the default is redirected, and an explicit path is only
 * respected when it is not the live store. */
function redirectWorkerDb(): void {
	const dir = mkdtempSync(join(tmpdir(), "maleo-test-worker-db-"));
	const explicit = process.env.GEN_WORKER_DB?.trim();
	if (!explicit || !temporary(explicit)) {
		process.env.GEN_WORKER_DB = join(dir, "gen-worker.sqlite");
	}
}

/* The runtime database is Postgres. A suite gets a throwaway embedded cluster
 * and a fresh database each time it resets the handle — never a database named
 * by a developer's .env, which `bun test` loads. */
function redirectRuntimeDb(): void {
	process.env.MALEO_DATABASE_URL = "";
	process.env.MALEO_PG_EPHEMERAL = "1";
}

/* Temporary state is created once per process: a Vitest worker keeps one set
 * across the files it runs, as a Bun process does. A child process inherits the
 * marker with another pid and gets its own. */
if (process.env.MALEO_TEST_GUARD_PID !== String(process.pid)) {
	redirect();
	redirectWorkerDb();
	redirectRuntimeDb();

	// New media writes share MALEO_DATA_DIR. Tests must select local explicitly
	// and isolate that directory even when the developer's .env names real S3.
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	process.env.MALEO_DATA_DIR = mkdtempSync(join(tmpdir(), "maleo-test-media-"));
	process.env.CACHE_DIR = join(process.env.MALEO_DATA_DIR, "cache");
	process.env.MALEO_VIDEO_DB = join(process.env.MALEO_DATA_DIR, "video-jobs.sqlite");
	process.env.MALEO_TEST_GUARD_PID = String(process.pid);
}
delete process.env.MALEO_API_URL;
delete process.env.MALEO_API_URLS;
delete process.env.MALEO_VIDEO_URL;
delete process.env.MALEO_GEN_WORKER_URL;
delete process.env.MALEO_IMAGE_URL;
for (const key of [
	"OPENAI_API_KEY",
	"ELEVENLABS_API_KEY",
	"MALEO_AI_API_KEY",
	"HF_TOKEN",
	"MALEO_CF_API_TOKEN",
	"PEXELS_API_KEY",
	"FREESOUND_API_KEY",
]) {
	delete process.env[key];
}

// Shared edit helpers run through Rust in every suite, loaded only on first edit.
import { instantiateEngineSync } from "../packages/shared/src/editor/engine.ts";
import { provideEditorEngine } from "../packages/shared/src/editor/engine-registry.ts";
import { readFileSync } from "node:fs";
import { buildEditorWasm } from "./editor-engine.mts";
/* Cargo runs once per test run, not once per file: Vitest re-runs this guard for
 * every file, and hundreds of concurrent `cargo build` calls wait on one lock.
 * Spawned children inherit the built path. */
provideEditorEngine(() => {
	process.env.MALEO_TEST_EDITOR_WASM ??= buildEditorWasm();
	return instantiateEngineSync(readFileSync(process.env.MALEO_TEST_EDITOR_WASM));
});
