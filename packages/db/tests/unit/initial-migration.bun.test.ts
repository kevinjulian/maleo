/* The initial migration reproduces the schema SQLite was running.
 *
 * 0001_initial.sql is a mechanical translation of unified-schema.ts. This holds
 * it to that: the same tables, the same columns with the same nullability,
 * key, and default, and the same indexes over the same columns — compared
 * against what the SQLite declaration actually builds, not against a copy.
 *
 * Types are compared through the translation table in the migration's header,
 * because "the same" across two engines means the mapped type. */
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDatabase, type TestDatabase } from "../../src/db/pg-testing.ts";
import { loadMigrations, migrate, MIGRATIONS_TABLE } from "../../src/db/migrate.ts";
import { applyUnifiedSchema } from "../../src/db/unified-schema.ts";

interface Column {
	name: string;
	type: string;
	notnull: boolean;
	pk: boolean;
	dflt: string | null;
}
interface Index {
	name: string;
	unique: boolean;
	columns: string;
}
interface Shape {
	columns: Column[];
	indexes: Index[];
	/** Column lists of UNIQUE constraints, sorted. */
	uniques: string[];
}

const PG_TYPE: Record<string, string> = {
	TEXT: "text",
	INTEGER: "bigint",
	REAL: "double precision",
};

/* A default as each engine prints it: SQLite keeps the literal as written,
 * Postgres appends a cast. */
function normaliseDefault(value: string | null): string | null {
	if (value === null) return null;
	return value.replace(/::[a-z ]+$/, "");
}

function sqliteShapes(): Map<string, Shape> {
	const db = new Database(":memory:");
	applyUnifiedSchema(db);
	const shapes = new Map<string, Shape>();
	const tables = db
		.query<{ name: string }, []>(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
		)
		.all();
	for (const { name } of tables) {
		const columns = db
			.query<
				{ name: string; type: string; notnull: number; pk: number; dflt_value: string | null },
				[]
			>(`PRAGMA table_info(${name})`)
			.all()
			.map((c) => ({
				name: c.name,
				type: PG_TYPE[c.type] ?? `unmapped ${c.type}`,
				// A primary key is not null in Postgres; SQLite only enforces it for INTEGER keys.
				notnull: c.notnull === 1 || c.pk > 0,
				pk: c.pk > 0,
				dflt: normaliseDefault(c.dflt_value),
			}));
		const indexes = db
			.query<{ name: string; unique: number; origin: string }, []>(`PRAGMA index_list(${name})`)
			.all()
			// Constraint-backed indexes are named by each engine on its own; they are
			// compared as constraints through the columns instead.
			.filter((i) => i.origin === "c")
			.map((i) => ({
				name: i.name,
				unique: i.unique === 1,
				columns: db
					.query<{ name: string | null }, []>(`PRAGMA index_info(${i.name})`)
					.all()
					.map((c) => c.name ?? "<expr>")
					.join(","),
			}));
		const uniques = db
			.query<{ name: string; origin: string }, []>(`PRAGMA index_list(${name})`)
			.all()
			.filter((i) => i.origin === "u")
			.map((i) =>
				db
					.query<{ name: string }, []>(`PRAGMA index_info(${i.name})`)
					.all()
					.map((c) => c.name)
					.join(","),
			)
			.sort();
		shapes.set(name, { columns, indexes, uniques });
	}
	db.close();
	return shapes;
}

async function postgresShapes(db: TestDatabase): Promise<Map<string, Shape>> {
	const shapes = new Map<string, Shape>();
	const tables = await db.sql<{ table_name: string }[]>`
		SELECT table_name FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name <> ${MIGRATIONS_TABLE}`;
	for (const { table_name: name } of tables) {
		const columns = await db.sql<
			{
				column_name: string;
				data_type: string;
				is_nullable: string;
				column_default: string | null;
				pk: boolean;
			}[]
		>`
			SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
			       EXISTS (
			         SELECT 1 FROM information_schema.key_column_usage k
			         JOIN information_schema.table_constraints t
			           ON t.constraint_name = k.constraint_name AND t.constraint_type = 'PRIMARY KEY'
			         WHERE k.table_name = c.table_name AND k.column_name = c.column_name
			       ) AS pk
			FROM information_schema.columns c
			WHERE c.table_schema = 'public' AND c.table_name = ${name}
			ORDER BY c.ordinal_position`;
		const indexes = await db.sql<{ name: string; unique: boolean; columns: string }[]>`
			SELECT i.relname AS name, ix.indisunique AS unique,
			       string_agg(coalesce(a.attname, '<expr>'), ',' ORDER BY k.ord) AS columns
			FROM pg_index ix
			JOIN pg_class i ON i.oid = ix.indexrelid
			JOIN pg_class t ON t.oid = ix.indrelid
			CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
			LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum AND k.attnum > 0
			WHERE t.relname = ${name}
			  AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = ix.indexrelid)
			GROUP BY i.relname, ix.indisunique`;
		const uniques = await db.sql<{ columns: string }[]>`
			SELECT string_agg(a.attname, ',' ORDER BY k.ord) AS columns
			FROM pg_constraint con
			JOIN pg_class t ON t.oid = con.conrelid
			CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
			JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
			WHERE t.relname = ${name} AND con.contype = 'u'
			GROUP BY con.oid`;
		shapes.set(name, {
			uniques: uniques.map((u) => u.columns).sort(),
			columns: columns.map((c) => ({
				name: c.column_name,
				type: c.data_type,
				notnull: c.is_nullable === "NO",
				pk: c.pk,
				// An identity column has no default expression; SQLite shows none either.
				dflt: normaliseDefault(c.column_default),
			})),
			indexes: [...indexes],
		});
	}
	return shapes;
}

const byName = <T extends { name: string }>(rows: T[]): T[] =>
	[...rows].sort((a, b) => a.name.localeCompare(b.name));

let pg: TestDatabase;
let expected: Map<string, Shape>;
let actual: Map<string, Shape>;

beforeAll(async () => {
	// Migration 1 alone: later migrations change the schema on purpose.
	pg = await createTestDatabase({ migrated: false });
	await migrate(
		pg.sql,
		loadMigrations().filter((m) => m.version === 1),
	);
	expected = sqliteShapes();
	actual = await postgresShapes(pg);
});
afterAll(async () => {
	await pg.drop();
});

describe("0001_initial reproduces the SQLite schema", () => {
	test("the same tables", () => {
		expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
		expect(actual.size).toBeGreaterThan(40);
	});

	test("the same columns, types, nullability, keys and defaults", () => {
		for (const [table, shape] of expected) {
			expect({ table, columns: actual.get(table)?.columns }).toEqual({
				table,
				columns: shape.columns,
			});
		}
	});

	test("the same unique constraints", () => {
		for (const [table, shape] of expected) {
			expect({ table, uniques: actual.get(table)?.uniques }).toEqual({
				table,
				uniques: shape.uniques,
			});
		}
	});

	test("the same indexes over the same columns", () => {
		for (const [table, shape] of expected) {
			expect({ table, indexes: byName(actual.get(table)?.indexes ?? []) }).toEqual({
				table,
				indexes: byName(shape.indexes),
			});
		}
	});
});
