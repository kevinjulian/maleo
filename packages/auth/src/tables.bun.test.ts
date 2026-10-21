/* The schema-ownership boundary, proven against a database the auth library
 * actually migrated.
 *
 * `packages/db` asserts the same property against hand-written stand-ins,
 * because it must not depend on better-auth to describe its own boundary. That
 * leaves one gap only this side can close: whether the library really produces
 * the tables the exemption names. A prefix typo, or a library version that
 * adds a fifth table, is invisible to the stand-in test and caught here. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Db } from "@maleo/db/handle";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { AUTH_OWNED_TABLES, unownedTables } from "@maleo/db/schema";

const priorDbPath = process.env.MALEO_DB_PATH;
const priorDataDir = process.env.MALEO_DATA_DIR;
let dataDir = "";

const tableNames = async (db: Db): Promise<string[]> =>
	(
		await db.all<{ name: string }>(
			"SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()",
		)
	).map((r) => r.name);

beforeEach(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "maleo-auth-tables-"));
	process.env.MALEO_DATA_DIR = dataDir;
	process.env.MALEO_DB_PATH = join(dataDir, "test.db");
	await closeMaleoDb();
});

afterEach(async () => {
	await closeMaleoDb();
	rmSync(dataDir, { recursive: true, force: true });
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
	// Restored, never deleted — see scripts/test-db-guard.ts.
	if (priorDataDir !== undefined) process.env.MALEO_DATA_DIR = priorDataDir;
});

describe("the auth library's tables against the schema-ownership exemption", () => {
	test("migrating creates exactly the exempted tables and nothing else", async () => {
		// Imported here, not at module scope: the auth config opens the database
		// on import, and the redirect above has to be in place first.
		const { ensureAuthTables } = await import("./config.ts");

		const before = await tableNames(openDb());
		expect(before.filter((t) => AUTH_OWNED_TABLES.includes(t))).toEqual([]);

		await ensureAuthTables();

		const after = await tableNames(openDb());
		// Every exempted table now exists...
		for (const table of AUTH_OWNED_TABLES) expect(after).toContain(table);
		// ...and the library brought nothing the exemption does not name.
		expect(unownedTables(after)).toEqual([]);
		// The first database use in this process starts the embedded cluster and
		// migrates its template, which outlasts the default 5s under a parallel
		// `bun run test`. A timeout kills the cluster with the test, failing every
		// test after it, so this one is given room.
	}, 60_000);

	test("migrating twice is a no-op", async () => {
		const { ensureAuthTables } = await import("./config.ts");
		await ensureAuthTables();
		const after = (await tableNames(openDb())).sort();

		await ensureAuthTables();

		expect((await tableNames(openDb())).sort()).toEqual(after);
	});

	test("workspace_members is ours, and survives the auth migration", async () => {
		const { ensureAuthTables } = await import("./config.ts");
		await ensureAuthTables();

		const db = openDb();
		expect(await tableNames(db)).toContain("workspace_members");
		// The borrowed id is a plain column. A foreign key here would couple two
		// schemas that migrate independently.
		const refs = await db.all(
			`SELECT 1 FROM pg_constraint con JOIN pg_class t ON t.oid = con.conrelid
			 WHERE t.relname = 'workspace_members' AND con.contype = 'f'`,
		);
		expect(refs).toEqual([]);
	});
});
