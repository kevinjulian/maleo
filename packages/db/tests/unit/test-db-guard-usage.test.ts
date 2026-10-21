/* No suite may delete the test database redirect.
 *
 * `scripts/test-db-guard.ts` points MALEO_DATA_DIR at a temp directory so that a
 * suite which clears MALEO_DB_PATH still falls back to `<temp>/maleo.db`.
 * Deleting MALEO_DATA_DIR removes that floor: `resolveDataDir()` returns
 * `<repo>/data`, and every later test whose own path was cleared opens the real
 * database.
 *
 * That is not hypothetical. Three suites cleaned up with
 * `delete process.env.MALEO_DATA_DIR`, and a full `bun test apps/api` wrote
 * two fixture projects into a developer's `data/maleo.db` on every run — while
 * this guard was installed and every test was green. The contamination is
 * invisible from inside the suite, which is why it is checked here against the
 * source rather than by asserting on behaviour.
 *
 * Restoring the prior value is correct; deleting is not. */
import { describe, expect, test } from "vite-plus/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "../../../..");
const ROOTS = ["packages", "apps", "scripts"];

function tsFilesUnder(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry.startsWith(".") || entry === "node_modules" || entry === "dist") continue;
		const path = join(dir, entry);
		// A dangling symlink is not a source file; skipping beats crashing the guard.
		let stat;
		try {
			stat = statSync(path);
		} catch {
			continue;
		}
		if (stat.isDirectory()) out.push(...tsFilesUnder(path));
		else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(path);
	}
	return out;
}

describe("the test database redirect is never deleted", () => {
	// Full CI scans sources while every workspace test runs; allow disk contention.
	test("there are sources to check", () => {
		expect(ROOTS.flatMap((r) => tsFilesUnder(join(REPO, r))).length).toBeGreaterThan(100);
	}, 20_000);

	test("no file deletes MALEO_DATA_DIR", () => {
		const offenders: string[] = [];
		for (const root of ROOTS) {
			for (const file of tsFilesUnder(join(REPO, root))) {
				const src = readFileSync(file, "utf8");
				if (file === import.meta.filename) continue;
				if (new RegExp("delete\\s+process\\.env\\." + "MALEO_DATA_DIR").test(src)) {
					offenders.push(file.slice(REPO.length + 1));
				}
			}
		}
		expect(offenders).toEqual([]);
	}, 20_000);
});
