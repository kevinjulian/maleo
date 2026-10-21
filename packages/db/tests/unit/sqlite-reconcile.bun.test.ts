/* Reconcile-at-open, while the SQLite path still serves.
 *
 * These pin the behaviour of the SQLite reconcile pass in unified-schema.ts,
 * which the runtime still opens until the move to Postgres completes. Ownership
 * itself moved to the migration sequence (schema-ownership.bun.test.ts); this file
 * is deleted with the SQLite path, and the requirement it pins is REMOVED by
 * migrate-to-postgres rather than carried over.
 *
 * On 2026-07-30 the `content_projects` rebuild destroyed `editor_state_json` for
 * 141 projects because a column added outside the declaration was invisible to
 * the rebuild. */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
	applyUnifiedSchema,
	canonicalColumns,
	UNIFIED_SCHEMA,
} from "../../src/db/unified-schema.ts";
import { sqliteDb } from "../../src/db/handle.ts";
import { bootstrapLibraryFixtures } from "../../src/db/library-fixtures.ts";
import { PRESET_FIXTURES } from "@maleo/shared";
import { listContentPresets } from "../../src/db/content-presets.ts";
import { randomUUID } from "node:crypto";
import { getMediaObject, registerMediaObject } from "../../src/db/media-objects.ts";

const hash = "a".repeat(64);
const key = (workspace: string, kind: string, name = "shot.png") =>
	`workspaces/${workspace}/${kind}/${randomUUID()}-${name}`;

const columnNames = (db: Database, table: string): string[] =>
	(db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe("reconcileColumns heals an old DB against the declaration", () => {
	test("a content_projects table predating editor_state_json gains it", () => {
		const db = new Database(":memory:");
		db.exec(`
			CREATE TABLE content_projects (
			  id TEXT PRIMARY KEY,
			  workspace TEXT NOT NULL DEFAULT 'default',
			  title TEXT NOT NULL,
			  type TEXT NOT NULL,
			  status TEXT NOT NULL,
			  created_at INTEGER NOT NULL,
			  updated_at INTEGER NOT NULL
			);
		`);
		db.run(`INSERT INTO content_projects (id, workspace, title, type, status, created_at, updated_at)
			VALUES ('p1', 'default', 'Old', 'video', 'draft', 1, 1)`);

		applyUnifiedSchema(db);

		expect(columnNames(db, "content_projects")).toContain("editor_state_json");
		expect((db.query(`SELECT count(*) AS c FROM content_projects`).get() as { c: number }).c).toBe(
			1,
		);
		db.close();
	});

	test("a workspaces table predating branding gains the branding columns", () => {
		const db = new Database(":memory:");
		db.exec(`
			CREATE TABLE workspaces (
			  name TEXT PRIMARY KEY,
			  display_name TEXT NOT NULL,
			  status TEXT NOT NULL DEFAULT 'active',
			  workspace_dir TEXT NOT NULL,
			  config_path TEXT NOT NULL,
			  created_at INTEGER NOT NULL,
			  updated_at INTEGER NOT NULL
			);
		`);
		db.run(`INSERT INTO workspaces (name, display_name, status, workspace_dir, config_path, created_at, updated_at)
			VALUES ('w1', 'W1', 'active', '/w1', '/w1/config.yaml', 1, 1)`);

		applyUnifiedSchema(db);

		expect(columnNames(db, "workspaces")).toContain("tagline");
		// The same reconcile has to carry `description`, which an operator writes
		// and nothing derives — a database that silently lacked it would accept a
		// description and read it back as absent.
		expect(columnNames(db, "workspaces")).toContain("description");
		expect((db.query(`SELECT count(*) AS c FROM workspaces`).get() as { c: number }).c).toBe(1);
		db.close();
	});
});

describe("canonicalColumns is the single source the rebuild reads", () => {
	test("it reports the declared shape, constraints included", () => {
		const cols = canonicalColumns("content_projects");
		const workspace = cols.find((c) => c.name === "workspace");
		expect(workspace?.decl).toContain("NOT NULL");
		expect(cols.map((c) => c.name)).toContain("editor_state_json");
	});

	test("it matches what the schema actually creates", () => {
		const db = new Database(":memory:");
		db.exec(UNIFIED_SCHEMA);
		expect(
			canonicalColumns("content_projects")
				.map((c) => c.name)
				.sort(),
		).toEqual(columnNames(db, "content_projects").sort());
		db.close();
	});

	test("an unknown table has no canonical shape", () => {
		expect(canonicalColumns("no_such_table")).toEqual([]);
	});
});

describe("the rebuild carries data the declaration owns", () => {
	test("editor_state_json survives the NOT NULL rebuild", () => {
		const db = new Database(":memory:");
		// Pre-rebuild shape: nullable workspace, and editor_state_json present with data.
		db.exec(`
			CREATE TABLE content_projects (
			  id TEXT PRIMARY KEY,
			  workspace TEXT,
			  title TEXT NOT NULL,
			  type TEXT NOT NULL,
			  status TEXT NOT NULL,
			  created_at INTEGER NOT NULL,
			  updated_at INTEGER NOT NULL,
			  editor_state_json TEXT
			);
		`);
		db.run(`INSERT INTO content_projects (id, workspace, title, type, status, created_at, updated_at, editor_state_json)
			VALUES ('p1', 'default', 'Kept', 'video', 'draft', 1, 1, '{"chat":[{"role":"user"}]}')`);

		applyUnifiedSchema(db);

		const row = db
			.query<{ e: string | null }, []>(
				`SELECT editor_state_json AS e FROM content_projects WHERE id = 'p1'`,
			)
			.get();
		expect(row!.e).toBe('{"chat":[{"role":"user"}]}');
		const notNull = db
			.query<{ nn: number }, []>(
				`SELECT "notnull" AS nn FROM pragma_table_info('content_projects') WHERE name = 'workspace'`,
			)
			.get();
		expect(notNull!.nn).toBe(1);
		db.close();
	});
});

/* A database that predates this change reaches the new columns through
 * `reconcileColumns`, which is only exercised when the tables ALREADY exist — every
 * other test here builds the current schema from scratch and never touches that path.
 *
 * This caught a real ordering bug: the unique slug indexes ran in the tables-only pass,
 * BEFORE the ALTER that adds the column they cover, so the whole migration threw and
 * left the database on its old shape. The symptom was `no such column: slug` on every
 * library read. */
describe("migrating a database that predates the identity columns", () => {
	function legacyDb(): Database {
		const old = new Database(":memory:");
		old.exec(`
			CREATE TABLE content_presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', preset_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
			CREATE TABLE content_timeline_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', template_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
			CREATE TABLE content_materials (id TEXT PRIMARY KEY, workspace TEXT NOT NULL DEFAULT 'default', name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', material_group TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', asset_ids_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
		`);
		return old;
	}

	test("the migration adds the identity columns to all three tables", () => {
		const old = legacyDb();
		applyUnifiedSchema(old);
		for (const table of ["content_presets", "content_timeline_templates", "content_materials"]) {
			const columns = old
				.query<{ name: string }, []>(`PRAGMA table_info(${table})`)
				.all()
				.map((row) => row.name);
			expect(columns, table).toContain("slug");
			expect(columns, table).toContain("source");
			expect(columns, table).toContain("retired");
			expect(columns, table).toContain("fixture_rank");
		}
	});

	test("an existing workspace keeps its rows and gains the fixtures", async () => {
		const old = legacyDb();
		old.run(
			"INSERT INTO content_presets (id,name,description,preset_json,created_at,updated_at) VALUES ('mine','My preset','','{}',1,1)",
		);
		applyUnifiedSchema(old);
		await bootstrapLibraryFixtures(sqliteDb(old), true);

		const presets = await listContentPresets(sqliteDb(old));
		expect(presets.filter((p) => p.source === "fixture")).toHaveLength(PRESET_FIXTURES.length);
		// The operator's row is untouched, still last, and still has no slug.
		const mine = presets.find((p) => p.id === "mine")!;
		expect(mine.name).toBe("My preset");
		expect(mine.slug).toBeNull();
		expect(presets.at(-1)!.id).toBe("mine");
	});
});

test("an existing registry drops the retired hash uniqueness on open", async () => {
	const db = new Database(":memory:");
	// The shape applyUnifiedSchema created before keys became unique per write.
	db.exec(`
		CREATE TABLE media_objects (
		  id TEXT PRIMARY KEY, workspace TEXT NOT NULL, kind TEXT NOT NULL, hash TEXT NOT NULL,
		  storage_key TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL,
		  created_at INTEGER NOT NULL, UNIQUE (workspace, kind, hash), UNIQUE (storage_key)
		);
	`);
	db.run(
		"INSERT INTO media_objects VALUES ('keep', 'one', 'image', ?, 'workspaces/one/image/legacy', 'image/png', 5, 1)",
		[hash],
	);
	applyUnifiedSchema(db);
	// The existing row survives the table swap.
	expect((await getMediaObject("keep", sqliteDb(db)))?.storage_key).toBe(
		"workspaces/one/image/legacy",
	);
	/* And a second object with the same bytes now registers, which is what the
	 * old constraint made impossible — it returned the first row, whose key named
	 * different bytes than the caller had just uploaded. */
	const row = await registerMediaObject(
		{
			workspace: "one",
			kind: "image",
			hash,
			content_type: "image/png",
			size: 5,
			storage_key: key("one", "image"),
		},
		sqliteDb(db),
	);
	expect(row.id).not.toBe("keep");
	expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM media_objects").get()?.n).toBe(2);
	db.close();
});
