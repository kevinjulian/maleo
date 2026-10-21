/* The database handle every family module takes as its last, defaulted
 * parameter.
 *
 * It is asynchronous because the Postgres driver is, and it means the same
 * thing whether it wraps the shared pool or an open transaction: a caller
 * composing several writes passes its transaction to each and they commit or
 * roll back as one.
 *
 * While the runtime moves from SQLite to Postgres there are two
 * implementations. A ported module runs against whichever one the runtime
 * opened, so SQL written for it must mean the same on both engines; the rare
 * statement that cannot is chosen by `dialect`, and those branches are deleted
 * with the SQLite path.
 *
 * SQL keeps SQLite's `?` placeholders — the existing statements move over
 * unchanged — and the Postgres side numbers them. */
import type { Database } from "bun:sqlite";
import type postgres from "postgres";
import type { Sql } from "./pg.ts";

export type Param = string | number | boolean | bigint | null | undefined | Uint8Array;

export interface Db {
	readonly dialect: "postgres" | "sqlite";
	all<T>(sql: string, params?: readonly Param[]): Promise<T[]>;
	/** The first row, or null when there is none. */
	get<T>(sql: string, params?: readonly Param[]): Promise<T | null>;
	run(sql: string, params?: readonly Param[]): Promise<{ changes: number }>;
	/** One or more statements, no parameters. */
	exec(sql: string): Promise<void>;
	/** Commit when fn resolves, roll back and rethrow when it rejects. Nested,
	 *  it is a savepoint: an inner failure undoes only the inner work. */
	transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

/* `?` -> `$1`, `?3` -> `$3`, skipping string literals, quoted identifiers and
 * comments. A numbered `?N` keeps its number so a repeated parameter binds once,
 * exactly as SQLite reads it. */
export function toPostgresPlaceholders(sql: string): string {
	let out = "";
	let next = 1;
	let i = 0;
	while (i < sql.length) {
		const ch = sql[i]!;
		const skipTo = (end: string, from: number): number => {
			const at = sql.indexOf(end, from);
			return at === -1 ? sql.length : at + end.length;
		};
		let end = -1;
		if (ch === "'") end = skipQuoted(sql, i, "'");
		else if (ch === '"') end = skipQuoted(sql, i, '"');
		else if (ch === "-" && sql[i + 1] === "-") end = skipTo("\n", i);
		else if (ch === "/" && sql[i + 1] === "*") end = skipTo("*/", i + 2);
		if (end !== -1) {
			out += sql.slice(i, end);
			i = end;
			continue;
		}
		if (ch === "?") {
			const digits = /^\d+/.exec(sql.slice(i + 1))?.[0];
			if (digits) {
				out += `$${digits}`;
				next = Math.max(next, Number(digits) + 1);
				i += 1 + digits.length;
			} else {
				out += `$${next++}`;
				i += 1;
			}
			continue;
		}
		out += ch;
		i += 1;
	}
	return out;
}

/** Index just past a quoted run starting at `start`; a doubled quote is an escape. */
function skipQuoted(sql: string, start: number, quote: string): number {
	let i = start + 1;
	while (i < sql.length) {
		if (sql[i] === quote) {
			if (sql[i + 1] === quote) {
				i += 2;
				continue;
			}
			return i + 1;
		}
		i += 1;
	}
	return sql.length;
}

/* The schema stores flags as bigint 0/1, as SQLite did; Postgres will not cast
 * a boolean into one implicitly. */
function bindable(params: readonly Param[]): (string | number | bigint | null | Uint8Array)[] {
	return params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p));
}

type PgHandle = Sql | postgres.TransactionSql;

export function pgDb(sql: PgHandle): Db {
	const query = (text: string, params: readonly Param[]) =>
		// SAFETY: `bindable` yields only strings, numbers, bigints, null and bytes,
		// each of which postgres.js serialises as a plain parameter.
		sql.unsafe(toPostgresPlaceholders(text), bindable(params) as postgres.ParameterOrJSON<never>[]);
	return {
		dialect: "postgres",
		// SAFETY: row shape is the caller's claim about its own SELECT, exactly as
		// with any driver; the handle cannot check it.
		all: async <T>(text: string, params: readonly Param[] = []) =>
			[...(await query(text, params))] as T[],
		// SAFETY: as for `all` — the caller's claim about its own SELECT.
		get: async <T>(text: string, params: readonly Param[] = []) =>
			((await query(text, params))[0] as T | undefined) ?? null,
		run: async (text, params = []) => ({ changes: (await query(text, params)).count }),
		exec: async (text) => {
			await sql.unsafe(text);
		},
		transaction: async <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
			if ("savepoint" in sql) {
				// SAFETY: savepoint/begin resolve to exactly what `fn` resolved to;
				// postgres.js types that as its row-list union, not as `T`.
				return (await sql.savepoint((sp) => fn(pgDb(sp)))) as T;
			}
			// SAFETY: as above.
			return (await sql.begin((tx) => fn(pgDb(tx)))) as T;
		},
	};
}

/* Serialise transactions that read, decide, then write over the same scope.
 *
 * SQLite had one writer, so "count the owners, then remove one" could not
 * interleave with another removal. Postgres runs transactions concurrently
 * under READ COMMITTED: two removals can each count two owners and both
 * proceed. Call this first inside the transaction; a second transaction naming
 * the same scope waits until the first commits or rolls back, then reads what
 * it left. `scope` names what is being decided about, e.g. `owners:<workspace>`. */
export async function serialize(tx: Db, scope: string): Promise<void> {
	if (tx.dialect !== "postgres") return;
	await tx.get("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", [scope]);
}

/** A handle whose every operation first waits for `ready` — the runtime's
 *  one-time setup — so nothing reads a database that is not finished opening. */
export function gated(db: Db, ready: Promise<unknown>): Db {
	return {
		dialect: db.dialect,
		all: async (text, params) => {
			await ready;
			return db.all(text, params);
		},
		get: async (text, params) => {
			await ready;
			return db.get(text, params);
		},
		run: async (text, params) => {
			await ready;
			return db.run(text, params);
		},
		exec: async (text) => {
			await ready;
			return db.exec(text);
		},
		transaction: async (fn) => {
			await ready;
			return db.transaction(fn);
		},
	};
}

/* ---- SQLite, for the duration of the port ------------------------------------
 *
 * One connection, so a transaction is the connection's state: an unrelated
 * write issued while a transaction is open would land inside it and share its
 * fate. The lock queues work on the root handle behind an open transaction;
 * work inside the transaction uses the handle it was given and does not wait. */

class Lock {
	private tail: Promise<unknown> = Promise.resolve();
	run<T>(fn: () => Promise<T>): Promise<T> {
		const result = this.tail.then(fn);
		this.tail = result.catch(() => {});
		return result;
	}
}

const sqliteHandles = new WeakMap<Database, Db>();

/** The handle for a bun:sqlite connection. One per connection, so every caller
 *  shares its lock. */
export function sqliteDb(database: Database): Db {
	let db = sqliteHandles.get(database);
	if (!db) {
		const lock = new Lock();
		db = sqliteHandle(database, (fn) => lock.run(fn), 0);
		sqliteHandles.set(database, db);
	}
	return db;
}

function sqliteHandle(
	database: Database,
	gate: <T>(fn: () => Promise<T>) => Promise<T>,
	depth: number,
): Db {
	const inTx = sqliteHandle.bind(null, database, (fn) => fn(), depth + 1);
	return {
		dialect: "sqlite",
		// SAFETY: `bindable` yields only SQLite-bindable values, and the row shape
		// is the caller's claim about its own SELECT, as for the Postgres handle.
		all: (text, params = []) =>
			gate(async () => database.query(text).all(...(bindable(params) as never[])) as never),
		get: (text, params = []) =>
			// SAFETY: as for `all`.
			gate(
				async () => (database.query(text).get(...(bindable(params) as never[])) ?? null) as never,
			),
		run: (text, params = []) =>
			// SAFETY: `bindable` yields only SQLite-bindable values.
			gate(async () => ({ changes: database.run(text, bindable(params) as never[]).changes })),
		exec: (text) =>
			gate(async () => {
				database.exec(text);
			}),
		transaction: <T>(fn: (tx: Db) => Promise<T>) =>
			gate(async () => {
				const savepoint = `sp_${depth}`;
				database.run(depth === 0 ? "BEGIN" : `SAVEPOINT ${savepoint}`);
				try {
					const result = await fn(inTx());
					database.run(depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
					return result;
				} catch (error) {
					if (depth === 0) database.run("ROLLBACK");
					else database.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
					throw error;
				}
			}),
	};
}
