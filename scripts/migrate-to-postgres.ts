/* One-time move of an existing SQLite runtime database into Postgres.
 *
 *   bun run db:migrate-from-sqlite [--source <path>]
 *
 * The target is the runtime database — MALEO_DATABASE_URL, or the embedded
 * development server — migrated to the current schema before anything is copied.
 * The source defaults to the old data/maleo.db and is brought up to the last
 * SQLite schema by opening it, exactly as the SQLite runtime did on every start;
 * run this against a COPY.
 *
 * What it guarantees:
 *   - every table's row count matches afterwards, and the counts are reported;
 *   - a run interrupted part-way finishes on the next run without duplicating a
 *     row (every insert is keyed on the table's primary key);
 *   - a value Postgres cannot hold as it is stops the run naming table, row and
 *     column — nothing is coerced or dropped. The one substitution: NULL in a
 *     column the schema declares NOT NULL with a DEFAULT takes that default,
 *     since SQLite left ALTER-added columns nullable;
 *   - a retired table still holding rows stops the run rather than being left
 *     behind unseen;
 *   - each workspace's config.yaml becomes its configuration row, validated
 *     exactly as a write through the API is, and a file that is missing,
 *     unparseable or invalid stops the run naming it. */
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateWorkspaceConfigText } from "../apps/api/src/lib/config-yaml.ts";
import type { Db, Param } from "../packages/db/src/db/handle.ts";
import { AUTH_OWNED_TABLES, RUNTIME_TABLES } from "../packages/db/src/db/schema.ts";

export class CarryOverError extends Error {
	override name = "CarryOverError";
}

export interface TableCount {
	table: string;
	source: number;
	target: number;
}

export interface CarryOverReport {
	tables: TableCount[];
	workspaces: string[];
}

export interface CarryOverInput {
	source: Database;
	target: Db;
	/** The old data directory, holding workspaces/<ws>/config.yaml. */
	dataDir: string;
	batchSize?: number;
	/** Called after each committed batch; tests use it to interrupt a run. */
	onBatch?: (table: string, carried: number) => void;
}

/* Tables the runtime schema no longer has. Carried nothing; required empty. */
const NOT_CARRIED = new Set(["workspace_config"]);

interface TargetColumn {
	name: string;
	type: string;
	notNull: boolean;
	hasDefault: boolean;
	/** The column declares a DEFAULT expression (identity aside). */
	declaredDefault: boolean;
	identity: boolean;
}

/* Bound as the SQL keyword DEFAULT rather than a parameter. */
const USE_DEFAULT = Symbol("default");

const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;

function sourceTables(source: Database): string[] {
	return source
		.query<{ name: string }, []>(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
		)
		.all()
		.map((r) => r.name);
}

const sourceCount = (source: Database, table: string): number =>
	source.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${quote(table)}`).get()!.n;

async function targetColumns(db: Db, table: string): Promise<TargetColumn[]> {
	const rows = await db.all<{
		name: string;
		type: string;
		nullable: string;
		dflt: string | null;
		identity: string;
	}>(
		`SELECT column_name AS name, data_type AS type, is_nullable AS nullable, column_default AS dflt, is_identity AS identity
		 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position`,
		[table],
	);
	return rows.map((r) => ({
		name: r.name,
		type: r.type,
		notNull: r.nullable === "NO",
		hasDefault: r.dflt !== null || r.identity === "YES",
		declaredDefault: r.dflt !== null,
		identity: r.identity === "YES",
	}));
}

async function primaryKey(db: Db, table: string): Promise<string[]> {
	const rows = await db.all<{ name: string }>(
		`SELECT a.attname AS name FROM pg_index i
		 JOIN pg_class t ON t.oid = i.indrelid
		 CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
		 JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
		 WHERE t.relname = ? AND i.indisprimary ORDER BY k.ord`,
		[table],
	);
	return rows.map((r) => r.name);
}

/* One value, checked against the column it is going into. Returns it as it
 * should be bound, or throws naming what is wrong. */
function convert(value: unknown, column: TargetColumn): Param | typeof USE_DEFAULT {
	if (value === null || value === undefined) {
		// A column SQLite gained by ALTER TABLE ADD COLUMN is nullable there even
		// where the declared schema says NOT NULL DEFAULT; the rows older than the
		// column hold NULL, which that schema defines as the default.
		if (column.notNull && column.declaredDefault) return USE_DEFAULT;
		if (column.notNull) throw new Error("is missing, and the column requires a value");
		return null;
	}
	switch (column.type) {
		case "bigint":
		case "integer":
			if (typeof value === "number" && Number.isSafeInteger(value)) return value;
			throw new Error(`holds ${JSON.stringify(value)}, which is not a whole number`);
		case "double precision":
			if (typeof value === "number" && Number.isFinite(value)) return value;
			throw new Error(`holds ${JSON.stringify(value)}, which is not a number`);
		case "text":
			if (typeof value !== "string")
				throw new Error(`holds a ${value instanceof Uint8Array ? "blob" : typeof value}, not text`);
			if (value.includes("\u0000"))
				throw new Error("holds a NUL character, which Postgres text cannot store");
			return value;
		case "boolean":
			if (value === 0 || value === 1) return value === 1;
			throw new Error(`holds ${JSON.stringify(value)}, which is not 0 or 1`);
		case "timestamp with time zone": {
			const date =
				typeof value === "number"
					? new Date(value)
					: typeof value === "string"
						? new Date(value)
						: null;
			if (!date || Number.isNaN(date.getTime()))
				throw new Error(`holds ${JSON.stringify(value)}, which is not a date`);
			return date.toISOString();
		}
		default:
			throw new Error(`has target type ${column.type}, which this migration does not carry`);
	}
}

/* Everything that can be decided before a row moves: retired tables with data,
 * and every workspace's configuration document. Failing here copies nothing. */
interface CarryPlan {
	/** Tables to copy, in schema order. */
	tables: string[];
	/** Validated configuration text by workspace name. */
	configs: Map<string, string>;
}

function preflight(input: CarryOverInput): CarryPlan {
	const present = sourceTables(input.source);
	const carried = new Set([...RUNTIME_TABLES, ...AUTH_OWNED_TABLES]);
	for (const table of present) {
		if (carried.has(table)) continue;
		const n = sourceCount(input.source, table);
		if (n > 0) {
			throw new CarryOverError(
				`${table} is not part of the Postgres schema and still holds ${n} row${n === 1 ? "" : "s"}; move or clear them first`,
			);
		}
	}
	const configs = new Map<string, string>();
	const names = present.includes("workspaces")
		? input.source
				.query<{ name: string }, []>(`SELECT name FROM workspaces ORDER BY name`)
				.all()
				.map((r) => r.name)
		: [];
	for (const name of names) {
		const file = join(input.dataDir, "workspaces", name, "config.yaml");
		if (!existsSync(file))
			throw new CarryOverError(
				`workspace "${name}" is registered but has no config.yaml at ${file}`,
			);
		const text = readFileSync(file, "utf8");
		try {
			validateWorkspaceConfigText(name, text);
		} catch (error) {
			throw new CarryOverError(
				`${file}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		configs.set(name, text);
	}
	const order = [...RUNTIME_TABLES, ...AUTH_OWNED_TABLES].filter(
		(t) => present.includes(t) && !NOT_CARRIED.has(t),
	);
	return { tables: order, configs };
}

async function carryTable(input: CarryOverInput, table: string): Promise<void> {
	const columns = await targetColumns(input.target, table);
	if (columns.length === 0)
		throw new CarryOverError(`${table} has rows in the source but no table in the target`);
	const sourceColumns = new Set(
		input.source
			.query<{ name: string }, [string]>(`SELECT name FROM pragma_table_info(?)`)
			.all(table)
			.map((c) => c.name),
	);
	for (const column of columns) {
		if (!sourceColumns.has(column.name) && column.notNull && !column.hasDefault) {
			throw new CarryOverError(
				`${table}.${column.name} is required in the target and absent from the source`,
			);
		}
	}
	const carried = columns.filter((c) => sourceColumns.has(c.name));
	const pk = await primaryKey(input.target, table);
	const describeRow = (row: Record<string, unknown>, rid: number): string =>
		pk.length ? pk.map((k) => `${k}=${String(row[k])}`).join(",") : `rowid ${rid}`;
	// Postgres binds at most 65535 parameters per statement.
	const batch = Math.max(1, Math.min(input.batchSize ?? 500, Math.floor(60_000 / carried.length)));
	const select = `SELECT rowid AS __rid, ${carried.map((c) => quote(c.name)).join(", ")} FROM ${quote(table)} WHERE rowid > ? ORDER BY rowid LIMIT ?`;
	const conflict = pk.length
		? `ON CONFLICT (${pk.map(quote).join(", ")}) DO NOTHING`
		: "ON CONFLICT DO NOTHING";
	let after = 0;
	let total = 0;
	for (;;) {
		const rows = input.source
			.query<Record<string, unknown>, [number, number]>(select)
			.all(after, batch);
		if (rows.length === 0) break;
		const params: Param[] = [];
		const tuples: string[] = [];
		for (const row of rows) {
			const placeholders: string[] = [];
			for (const column of carried) {
				let value: Param | typeof USE_DEFAULT;
				try {
					value = convert(row[column.name], column);
				} catch (error) {
					throw new CarryOverError(
						`${table}, row ${describeRow(row, row.__rid as number)}, column ${column.name}: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				if (value === USE_DEFAULT) {
					placeholders.push("DEFAULT");
				} else {
					params.push(value);
					placeholders.push("?");
				}
			}
			tuples.push(`(${placeholders.join(", ")})`);
		}
		await input.target.run(
			`INSERT INTO ${quote(table)} (${carried.map((c) => quote(c.name)).join(", ")}) OVERRIDING SYSTEM VALUE VALUES ${tuples.join(", ")} ${conflict}`,
			params,
		);
		after = rows[rows.length - 1]!.__rid as number;
		total += rows.length;
		input.onBatch?.(table, total);
	}
	for (const column of columns.filter((c) => c.identity)) {
		// Carried ids were written explicitly; the sequence continues after the highest.
		await input.target.get(
			`SELECT setval(pg_get_serial_sequence(?, ?), GREATEST((SELECT max(${quote(column.name)}) FROM ${quote(table)}), 1))`,
			[table, column.name],
		);
	}
}

export async function carryOver(input: CarryOverInput): Promise<CarryOverReport> {
	const plan = preflight(input);
	for (const table of plan.tables) await carryTable(input, table);
	for (const [name, text] of plan.configs) {
		await input.target.run(
			`INSERT INTO workspace_config (workspace, config_yaml, updated_at) VALUES (?, ?, ?) ON CONFLICT (workspace) DO NOTHING`,
			[name, text, Date.now()],
		);
	}
	const tables: TableCount[] = [];
	for (const table of plan.tables) {
		const target = (await input.target.get<{ n: number }>(
			`SELECT count(*) AS n FROM ${quote(table)}`,
		))!.n;
		tables.push({ table, source: sourceCount(input.source, table), target });
	}
	const mismatched = tables.filter((t) => t.source !== t.target);
	if (mismatched.length) {
		throw new CarryOverError(
			`row counts differ: ${mismatched.map((t) => `${t.table} ${t.source}→${t.target}`).join(", ")}`,
		);
	}
	return { tables, workspaces: [...plan.configs.keys()] };
}

if (import.meta.main) {
	const { openLegacySqlite, resolveLegacySqlitePath } =
		await import("../packages/db/src/db/legacy-sqlite.ts");
	const { closeMaleoDb, databaseReady, openDb } =
		await import("../packages/db/src/db/connection.ts");
	const { resolveDataDir } = await import("../packages/db/src/data-path.ts");
	const { ensureAuthTables } = await import("../packages/auth/src/config.ts");
	// Seeded fixture rows would collide by slug with the ones being carried.
	process.env.MALEO_BOOTSTRAP_FIXTURES = "0";
	const at = process.argv.indexOf("--source");
	if (at !== -1) process.env.MALEO_DB_PATH = process.argv[at + 1];
	console.log(`source: ${resolveLegacySqlitePath()}`);
	const source = openLegacySqlite();
	await databaseReady();
	await ensureAuthTables();
	const started = performance.now();
	const report = await carryOver({
		source,
		target: openDb(),
		dataDir: resolveDataDir(),
		onBatch: (table, n) => {
			if (n % 20_000 === 0) console.log(`  ${table}: ${n}`);
		},
	});
	for (const t of report.tables)
		console.log(
			`${t.table.padEnd(28)} ${String(t.source).padStart(8)} → ${String(t.target).padStart(8)}`,
		);
	console.log(`workspaces carried: ${report.workspaces.join(", ") || "none"}`);
	console.log(`done in ${Math.round((performance.now() - started) / 1000)}s; every count matches.`);
	source.close();
	await closeMaleoDb();
}
