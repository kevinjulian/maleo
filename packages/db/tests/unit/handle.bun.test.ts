/* The database handle every family module receives, on both engines.
 *
 * During the move to Postgres a ported module runs against whichever engine
 * the runtime opened, so the handle must mean the same thing on each: the same
 * placeholders, the same row shapes, the same transaction semantics. */
import { afterAll, describe, expect, test } from "bun:test";
import { pgDb, toPostgresPlaceholders, type Db } from "../../src/db/handle.ts";
import { createSql } from "../../src/db/pg.ts";
import { createTestDatabase } from "../../src/db/pg-testing.ts";
import { ENGINES, openTestDb, type TestDb } from "../../src/db/handle-testing.ts";

describe("placeholders", () => {
	test("positional ? become numbered $n in order", () => {
		expect(toPostgresPlaceholders("SELECT * FROM t WHERE a = ? AND b IN (?, ?)")).toBe(
			"SELECT * FROM t WHERE a = $1 AND b IN ($2, $3)",
		);
	});

	test("numbered ?N keep their number, so a repeated parameter binds once", () => {
		expect(toPostgresPlaceholders("WHERE key LIKE ?1 || '%' AND key != ?1 || '__envelope'")).toBe(
			"WHERE key LIKE $1 || '%' AND key != $1 || '__envelope'",
		);
	});

	test("a ? inside a string literal, a quoted identifier, or a comment is left alone", () => {
		const sql = `SELECT '?', 'it''s ?', "col?" FROM t -- why?\nWHERE a = ? /* or ? */ AND b = ?`;
		expect(toPostgresPlaceholders(sql)).toBe(
			`SELECT '?', 'it''s ?', "col?" FROM t -- why?\nWHERE a = $1 /* or ? */ AND b = $2`,
		);
	});
});

const opened: TestDb[] = [];
afterAll(async () => {
	await Promise.all(opened.map((t) => t.close()));
});

async function withTable(engine: (typeof ENGINES)[number]): Promise<Db> {
	const t = await openTestDb(engine, { migrated: false });
	opened.push(t);
	await t.db.exec("CREATE TABLE t (id text PRIMARY KEY, n bigint, flag bigint, note text)");
	return t.db;
}

describe.each([...ENGINES])("the handle on %s", (engine) => {
	test("run reports changed rows; get returns null for no row; all returns rows", async () => {
		const db = await withTable(engine);
		expect(await db.run("INSERT INTO t (id, n) VALUES (?, ?), (?, ?)", ["a", 1, "b", 2])).toEqual({
			changes: 2,
		});
		expect(await db.run("UPDATE t SET note = ? WHERE id = ?", ["x", "nope"])).toEqual({
			changes: 0,
		});
		expect(await db.get("SELECT id FROM t WHERE id = ?", ["zzz"])).toBeNull();
		expect(await db.all<{ id: string; n: number }>("SELECT id, n FROM t ORDER BY id")).toEqual([
			{ id: "a", n: 1 },
			{ id: "b", n: 2 },
		]);
	});

	test("epoch milliseconds and counts come back as numbers", async () => {
		const db = await withTable(engine);
		const now = 1_759_999_999_999;
		await db.run("INSERT INTO t (id, n) VALUES (?, ?)", ["a", now]);
		expect(await db.get<{ n: number }>("SELECT n FROM t")).toEqual({ n: now });
		expect(await db.get<{ c: number }>("SELECT COUNT(*) AS c FROM t")).toEqual({ c: 1 });
		expect(await db.get<{ s: number }>("SELECT SUM(n) AS s FROM t")).toEqual({ s: now });
	});

	test("booleans bind as 1 and 0, and undefined as null", async () => {
		const db = await withTable(engine);
		await db.run("INSERT INTO t (id, flag, note) VALUES (?, ?, ?), (?, ?, ?)", [
			"a",
			true,
			undefined,
			"b",
			false,
			"n",
		]);
		expect(await db.all("SELECT id, flag, note FROM t ORDER BY id")).toEqual([
			{ id: "a", flag: 1, note: null },
			{ id: "b", flag: 0, note: "n" },
		]);
	});

	test("a transaction commits as one", async () => {
		const db = await withTable(engine);
		const result = await db.transaction(async (tx) => {
			await tx.run("INSERT INTO t (id) VALUES (?)", ["a"]);
			await tx.run("INSERT INTO t (id) VALUES (?)", ["b"]);
			return "done";
		});
		expect(result).toBe("done");
		expect(await db.get<{ c: number }>("SELECT COUNT(*) AS c FROM t")).toEqual({ c: 2 });
	});

	test("a throw inside a transaction rolls every write back and rethrows", async () => {
		const db = await withTable(engine);
		await expect(
			db.transaction(async (tx) => {
				await tx.run("INSERT INTO t (id) VALUES (?)", ["a"]);
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(await db.get<{ c: number }>("SELECT COUNT(*) AS c FROM t")).toEqual({ c: 0 });
	});

	test("a nested transaction is a savepoint: its failure undoes only itself", async () => {
		const db = await withTable(engine);
		await db.transaction(async (tx) => {
			await tx.run("INSERT INTO t (id) VALUES (?)", ["outer"]);
			await tx
				.transaction(async (inner) => {
					await inner.run("INSERT INTO t (id) VALUES (?)", ["inner"]);
					throw new Error("inner");
				})
				.catch(() => {});
		});
		expect(await db.all("SELECT id FROM t")).toEqual([{ id: "outer" }]);
	});

	test("writes outside a transaction wait for it rather than joining it", async () => {
		const db = await withTable(engine);
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const tx = db
			.transaction(async (t) => {
				await t.run("INSERT INTO t (id) VALUES (?)", ["in-tx"]);
				await gate;
				throw new Error("roll back");
			})
			.catch(() => {});
		const outside = db.run("INSERT INTO t (id) VALUES (?)", ["outside"]);
		release();
		await Promise.all([tx, outside]);
		// The outside write survived the rollback, so it was never part of it.
		expect(await db.all("SELECT id FROM t")).toEqual([{ id: "outside" }]);
	});
});

/* A pooled handle held across an await pins nothing: each query takes a
 * connection and gives it back. Proven on a pool of ONE connection, where a
 * pinned connection would make the second caller wait forever. */
describe("the pooled handle on postgres", () => {
	test("holding the handle across an await does not hold a connection", async () => {
		const database = await createTestDatabase({ migrated: false });
		const single = createSql(database.url, { max: 1 });
		try {
			const held = pgDb(single);
			await held.get("SELECT 1 AS one");
			let release!: () => void;
			const pause = new Promise<void>((r) => (release = r));
			const holder = (async () => {
				await pause; // the caller keeps `held` across this await
				return held.get<{ two: number }>("SELECT 2 AS two");
			})();
			// Another caller on the same one-connection pool is not blocked by it.
			const other = await Promise.race([
				pgDb(single).get<{ three: number }>("SELECT 3 AS three"),
				Bun.sleep(2_000).then(() => "blocked"),
			]);
			expect(other).toEqual({ three: 3 });
			release();
			expect(await holder).toEqual({ two: 2 });
		} finally {
			await single.end();
			await database.drop();
		}
	});
});
