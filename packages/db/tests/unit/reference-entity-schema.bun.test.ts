/* Schema-level guarantees for the reference entity model.
 *
 * The role CHECK constraint is the load-bearing part: `content_references.kind`
 * was free text with no constraint, which is how one column ended up carrying two
 * orthogonal axes (asset type and scene role) and how five consumers grew five
 * different fallbacks for an unrecognised value. */
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { applyUnifiedSchema, DEFAULT_CONTENT_WORKSPACE } from "../../src/db/unified-schema.ts";

function freshDb(): Database {
	const db = new Database(":memory:");
	applyUnifiedSchema(db);
	return db;
}

function insertEntity(db: Database, role: string, id = "e1"): void {
	db.run(
		`INSERT INTO reference_entity (id, workspace, role, label, description, canonical_image_url, created_at, updated_at)
		 VALUES (?, 'ws', ?, 'L', '', '/img.png', 1, 1)`,
		[id, role],
	);
}

describe("reference_entity role constraint", () => {
	it("accepts every role in the vocabulary", () => {
		const db = freshDb();
		for (const role of ["style", "character", "location", "product", "prop"]) {
			expect(() => insertEntity(db, role, `e-${role}`)).not.toThrow();
		}
		db.close();
	});

	it("rejects an asset-type value on the role axis", () => {
		const db = freshDb();
		for (const notARole of ["note", "audio", "research", "image", "video", "logo", "environment"]) {
			expect(() => insertEntity(db, notARole, `x-${notARole}`)).toThrow();
		}
		db.close();
	});

	it("rejects arbitrary text and casing variants", () => {
		const db = freshDb();
		for (const junk of ["", "Character", "CHARACTER", " character", "hero"]) {
			expect(() => insertEntity(db, junk, `j-${junk}`)).toThrow();
		}
		db.close();
	});

	it("rebuilds old environment CHECK tables as style", () => {
		const db = new Database(":memory:");
		db.exec(`
			CREATE TABLE reference_entity (
			  id TEXT PRIMARY KEY,
			  workspace TEXT NOT NULL,
			  role TEXT NOT NULL CHECK (role IN ('character', 'environment', 'product', 'prop', 'style')),
			  label TEXT NOT NULL,
			  description TEXT NOT NULL DEFAULT '',
			  canonical_image_url TEXT,
			  tags_json TEXT,
			  origin TEXT NOT NULL DEFAULT 'linked',
			  created_at INTEGER NOT NULL,
			  updated_at INTEGER NOT NULL
			);
		`);
		insertEntity(db, "environment", "legacy-env");

		applyUnifiedSchema(db);

		expect(db.query(`SELECT role FROM reference_entity WHERE id='legacy-env'`).get()).toEqual({
			role: "style",
		});
		expect(() => insertEntity(db, "location", "new-location")).not.toThrow();
		expect(() => insertEntity(db, "environment", "old-env")).toThrow();
		db.close();
	});
});

describe("project_note", () => {
	it("stores text-only rows with no image column", () => {
		const db = freshDb();
		db.run(
			`INSERT INTO project_note (id, project_id, label, body, created_at, updated_at)
			 VALUES ('n1', 'p1', 'Tone', 'Casual', 1, 1)`,
		);
		expect(db.query(`SELECT count(*) c FROM project_note`).get()).toEqual({ c: 1 });
		const cols = db.query<{ name: string }, []>(`PRAGMA table_info(project_note)`).all();
		expect(cols.map((c) => c.name)).not.toContain("canonical_image_url");
		db.close();
	});
});

describe("content_projects workspace tenancy", () => {
	it("is NOT NULL on a fresh database", () => {
		const db = freshDb();
		const col = db
			.query<{ nn: number; dv: string | null }, []>(
				`SELECT "notnull" AS nn, dflt_value AS dv FROM pragma_table_info('content_projects') WHERE name='workspace'`,
			)
			.get();
		expect(col!.nn).toBe(1);
		db.close();
	});

	it("defaults a new project to the default workspace", () => {
		const db = freshDb();
		db.run(
			`INSERT INTO content_projects (id, title, type, status, created_at, updated_at) VALUES ('p1','T','video','draft',1,1)`,
		);
		expect(db.query(`SELECT workspace FROM content_projects WHERE id='p1'`).get()).toEqual({
			workspace: DEFAULT_CONTENT_WORKSPACE,
		});
		db.close();
	});

	it("backfills pre-tenancy rows and then enforces NOT NULL", () => {
		// Simulate a legacy DB: content_projects without a workspace column at all.
		const db = new Database(":memory:");
		db.exec(`
			CREATE TABLE content_projects (
			  id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL,
			  target_platform TEXT, target_audience TEXT, target_duration_sec INTEGER,
			  target_format TEXT, language TEXT, campaign_id TEXT, brief_json TEXT,
			  reference_notes TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
			);
		`);
		db.run(
			`INSERT INTO content_projects (id,title,type,status,created_at,updated_at) VALUES ('old1','Legacy','video','draft',1,1)`,
		);
		db.run(
			`INSERT INTO content_projects (id,title,type,status,created_at,updated_at) VALUES ('old2','Legacy 2','image','draft',2,2)`,
		);

		applyUnifiedSchema(db);

		// Rows preserved, every one tenanted, constraint now real.
		expect(db.query(`SELECT count(*) c FROM content_projects`).get()).toEqual({ c: 2 });
		expect(
			db
				.query(`SELECT count(*) c FROM content_projects WHERE workspace = ?`)
				.get(DEFAULT_CONTENT_WORKSPACE),
		).toEqual({ c: 2 });
		const col = db
			.query<{ nn: number }, []>(
				`SELECT "notnull" AS nn FROM pragma_table_info('content_projects') WHERE name='workspace'`,
			)
			.get();
		expect(col!.nn).toBe(1);
		expect(db.query(`SELECT title FROM content_projects WHERE id='old1'`).get()).toEqual({
			title: "Legacy",
		});
		db.close();
	});

	it("recreates the workspace index after the table rebuild", () => {
		const db = new Database(":memory:");
		db.exec(`
			CREATE TABLE content_projects (
			  id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL,
			  target_platform TEXT, target_audience TEXT, target_duration_sec INTEGER,
			  target_format TEXT, language TEXT, campaign_id TEXT, brief_json TEXT,
			  reference_notes TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
			);
		`);
		db.run(
			`INSERT INTO content_projects (id,title,type,status,created_at,updated_at) VALUES ('old1','Legacy','video','draft',1,1)`,
		);
		applyUnifiedSchema(db);
		const idx = db
			.query<{ name: string }, []>(
				`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='content_projects'`,
			)
			.all();
		expect(idx.map((i) => i.name)).toContain("idx_content_projects_workspace");
		expect(idx.map((i) => i.name)).toContain("idx_content_projects_status");
		db.close();
	});

	it("is idempotent across repeated opens", () => {
		const db = new Database(":memory:");
		db.exec(`
			CREATE TABLE content_projects (
			  id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL,
			  target_platform TEXT, target_audience TEXT, target_duration_sec INTEGER,
			  target_format TEXT, language TEXT, campaign_id TEXT, brief_json TEXT,
			  reference_notes TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
			);
		`);
		db.run(
			`INSERT INTO content_projects (id,title,type,status,created_at,updated_at) VALUES ('old1','Legacy','video','draft',1,1)`,
		);
		applyUnifiedSchema(db);
		applyUnifiedSchema(db);
		applyUnifiedSchema(db);
		expect(db.query(`SELECT count(*) c FROM content_projects`).get()).toEqual({ c: 1 });
		db.close();
	});
});
