/* The migration runner: ordered, once-only, recorded, and all-or-nothing.
 *
 * Each test gets an EMPTY database of the real engine, so the runner is observed
 * doing its whole job — creating its own bookkeeping table included — rather
 * than against a database some earlier test already migrated. */
import { afterEach, describe, expect, test } from "bun:test";
import { createTestDatabase, type TestDatabase } from "../../src/db/pg-testing.ts";
import { MigrationError, migrate, type Migration } from "../../src/db/migrate.ts";

const opened: TestDatabase[] = [];
async function emptyDb(): Promise<TestDatabase> {
	const db = await createTestDatabase({ migrated: false });
	opened.push(db);
	return db;
}
afterEach(async () => {
	await Promise.all(opened.splice(0).map((db) => db.drop()));
});

const m = (version: number, sql: string, name = `m${version}`): Migration => ({
	version,
	name,
	sql,
});

async function tables(db: TestDatabase): Promise<string[]> {
	const rows = await db.sql<{ table_name: string }[]>`
		SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
	return rows.map((r) => r.table_name);
}

async function applied(db: TestDatabase): Promise<number[]> {
	const rows = await db.sql<
		{ version: number }[]
	>`SELECT version FROM schema_migrations ORDER BY version`;
	return rows.map((r) => r.version);
}

describe("migrations run in order, once, and are recorded", () => {
	test("applies every migration in version order regardless of list order", async () => {
		const db = await emptyDb();
		// 2 depends on 1: out of order it would fail on the missing table.
		await migrate(db.sql, [
			m(2, "ALTER TABLE a ADD COLUMN y text"),
			m(1, "CREATE TABLE a (x text)"),
		]);
		expect(await applied(db)).toEqual([1, 2]);
		const cols = await db.sql<{ column_name: string }[]>`
			SELECT column_name FROM information_schema.columns WHERE table_name = 'a' ORDER BY ordinal_position`;
		expect(cols.map((c) => c.column_name)).toEqual(["x", "y"]);
	});

	test("a database already at the current version runs nothing", async () => {
		const db = await emptyDb();
		const list = [m(1, "CREATE TABLE a (x text)")];
		expect(await migrate(db.sql, list)).toEqual({ applied: [1] });
		// Re-running CREATE TABLE would throw, so a second apply cannot hide.
		expect(await migrate(db.sql, list)).toEqual({ applied: [] });
		expect(await applied(db)).toEqual([1]);
	});

	test("a newly added migration is the only one that runs", async () => {
		const db = await emptyDb();
		await migrate(db.sql, [m(1, "CREATE TABLE a (x text)")]);
		const result = await migrate(db.sql, [
			m(1, "CREATE TABLE a (x text)"),
			m(2, "CREATE TABLE b (x text)"),
		]);
		expect(result).toEqual({ applied: [2] });
		expect(await tables(db)).toEqual(["a", "b", "schema_migrations"]);
	});

	test("concurrent runners against one database apply each migration once", async () => {
		const db = await emptyDb();
		const list = [m(1, "CREATE TABLE a (x text)"), m(2, "CREATE TABLE b (x text)")];
		const results = await Promise.all([
			migrate(db.sql, list),
			migrate(db.sql, list),
			migrate(db.sql, list),
		]);
		expect(results.flatMap((r) => r.applied).sort((a, b) => a - b)).toEqual([1, 2]);
		expect(await applied(db)).toEqual([1, 2]);
	});

	test("duplicate versions are refused before anything runs", async () => {
		const db = await emptyDb();
		await expect(
			migrate(db.sql, [m(1, "CREATE TABLE a (x text)"), m(1, "CREATE TABLE b (x text)")]),
		).rejects.toThrow(/duplicate migration version 1/);
		expect(await tables(db)).toEqual([]);
	});
});

describe("a failed migration rolls back and refuses to serve", () => {
	test("the failing migration leaves no trace and the version does not advance", async () => {
		const db = await emptyDb();
		const list = [
			m(1, "CREATE TABLE a (x text)"),
			// Creates a table, then fails: the table must not survive.
			m(2, "CREATE TABLE b (x text); INSERT INTO nope VALUES (1)", "broken"),
			m(3, "CREATE TABLE c (x text)"),
		];
		const error = await migrate(db.sql, list).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(MigrationError);
		expect((error as Error).message).toContain("2_broken");
		expect(await applied(db)).toEqual([1]);
		expect(await tables(db)).toEqual(["a", "schema_migrations"]);
	});

	test("the next start refuses again rather than skipping past the failure", async () => {
		const db = await emptyDb();
		const list = [m(1, "CREATE TABLE a (x text)"), m(2, "INSERT INTO nope VALUES (1)")];
		await migrate(db.sql, list).catch(() => {});
		await expect(migrate(db.sql, list)).rejects.toBeInstanceOf(MigrationError);
		expect(await applied(db)).toEqual([1]);
	});
});

describe("an applied migration is never edited", () => {
	test("changed content of an applied migration is detected and refused", async () => {
		const db = await emptyDb();
		await migrate(db.sql, [m(1, "CREATE TABLE a (x text)")]);
		const error = await migrate(db.sql, [m(1, "CREATE TABLE a (x text, y text)")]).catch(
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(MigrationError);
		expect((error as Error).message).toMatch(/migration 1_m1 was edited after it was applied/);
	});

	test("an unchanged migration passes the check", async () => {
		const db = await emptyDb();
		const list = [m(1, "CREATE TABLE a (x text)")];
		await migrate(db.sql, list);
		await expect(migrate(db.sql, list)).resolves.toEqual({ applied: [] });
	});
});
