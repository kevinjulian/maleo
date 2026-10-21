/* SQL lives in the module that owns the table.
 *
 * Twelve production files used to run 116 statements outside the database layer,
 * two of them ten-line modules whose only job was to hand back the shared
 * connection so a feature could write its own SQL. The rule that every statement
 * filters by `workspace` was enforced by a comment asking callers to remember.
 *
 * These checks read the source, so a new bypass fails the build rather than
 * waiting to be noticed. */
import { describe, expect, test } from "vite-plus/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "../../../..");
const DB_DIR = join(REPO, "packages/db/src/db");

/** Modules that legitimately own SQL outside `packages/db`: credit ledger owns
 *  five tables nothing else touches and has its own tests, and the workflow-run
 *  store is a database module living beside the others. */
const SQL_OWNERS_OUTSIDE_DB_DIR = ["apps/api/src/lib/credit-service.ts"];

function sourceFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules" || entry.startsWith(".")) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) sourceFiles(full, acc);
		else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) acc.push(full);
	}
	return acc;
}

const relative = (path: string): string => path.slice(REPO.length + 1);

describe("no module outside the database layer writes SQL", () => {
	test("nothing re-exports a raw connection handle", () => {
		// `workspace-db.ts` and `memory/db.ts` did exactly this: a function that
		// took a workspace, ignored it, and returned the shared handle.
		const offenders: string[] = [];
		for (const dir of ["apps/api/src", "packages/db/src"]) {
			for (const file of sourceFiles(join(REPO, dir))) {
				if (relative(file).startsWith("packages/db/src/db/")) continue;
				const src = readFileSync(file, "utf8");
				if (/:\s*Database\s*\{[\s\S]{0,200}return\s+openMaleoDb\(\)/.test(src)) {
					offenders.push(relative(file));
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	test("only the database layer and the credit ledger run statements", () => {
		const offenders: string[] = [];
		for (const dir of ["apps/api/src", "packages/db/src"]) {
			for (const file of sourceFiles(join(REPO, dir))) {
				const rel = relative(file);
				if (rel.startsWith("packages/db/src/db/")) continue;
				if (SQL_OWNERS_OUTSIDE_DB_DIR.includes(rel)) continue;
				const src = readFileSync(file, "utf8");
				// A statement against a runtime table, not an incidental `.query(`.
				if (
					/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\s+[A-Za-z_]/.test(src) &&
					/\bdb\.(query|run|prepare|exec)\b/.test(src)
				) {
					offenders.push(rel);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	test("the guard is looking at real files", () => {
		expect(sourceFiles(DB_DIR).length).toBeGreaterThan(15);
	});
});
