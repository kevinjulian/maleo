/* The workspace NOT NULL rebuild must not destroy columns it does not know about.
 *
 * `openMaleoDb` ALTER-adds `editor_state_json` (chat, media assets, settings,
 * creative direction) AFTER applyUnifiedSchema runs, so that column is invisible to
 * UNIFIED_SCHEMA. The rebuild used to copy a hardcoded canonical column list, which
 * dropped it: on 2026-07-30 that destroyed editor state for 141 projects, 2,883
 * chat messages among them. The ALTER then re-added the column empty on the next
 * open, so the schema self-healed and the loss was silent. */
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { applyUnifiedSchema } from "../../src/db/unified-schema.ts";

/* A pre-rebuild database: `workspace` still nullable, plus an out-of-schema column
 * carrying real data — the exact shape the live DB had that morning. */
function legacyDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
		CREATE TABLE content_projects (
		  id TEXT PRIMARY KEY,
		  workspace TEXT,
		  title TEXT NOT NULL,
		  type TEXT NOT NULL,
		  status TEXT NOT NULL,
		  target_platform TEXT,
		  target_audience TEXT,
		  target_duration_sec INTEGER,
		  target_format TEXT,
		  language TEXT,
		  campaign_id TEXT,
		  brief_json TEXT,
		  reference_notes TEXT,
		  created_at INTEGER NOT NULL,
		  updated_at INTEGER NOT NULL
		);
		ALTER TABLE content_projects ADD COLUMN editor_state_json TEXT;
	`);
	db.run(
		`INSERT INTO content_projects (id, workspace, title, type, status, editor_state_json, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			"p1",
			"default",
			"Has chat",
			"video",
			"brief",
			JSON.stringify({
				chat: [
					{ id: 1, text: "hello" },
					{ id: 2, text: "world" },
				],
			}),
			1,
			1,
		],
	);
	return db;
}

describe("content_projects workspace rebuild", () => {
	it("keeps out-of-schema columns and their data", () => {
		const db = legacyDb();
		applyUnifiedSchema(db);

		const cols = new Set(
			(db.query(`PRAGMA table_info(content_projects)`).all() as Array<{ name: string }>).map(
				(c) => c.name,
			),
		);
		expect(cols.has("editor_state_json")).toBe(true);

		const row = db
			.query<{ editor_state_json: string | null }, []>(
				`SELECT editor_state_json FROM content_projects WHERE id = 'p1'`,
			)
			.get();
		expect(row!.editor_state_json).not.toBeNull();
		expect(JSON.parse(row!.editor_state_json!).chat).toHaveLength(2);
	});

	it("still tightens workspace to NOT NULL, which is why the rebuild exists", () => {
		const db = legacyDb();
		applyUnifiedSchema(db);
		const info = db
			.query<{ nn: number }, []>(
				`SELECT "notnull" AS nn FROM pragma_table_info('content_projects') WHERE name = 'workspace'`,
			)
			.get();
		expect(info!.nn).toBe(1);
	});

	it("does not lose ordinary rows", () => {
		const db = legacyDb();
		applyUnifiedSchema(db);
		expect((db.query(`SELECT count(*) AS c FROM content_projects`).get() as { c: number }).c).toBe(
			1,
		);
		expect(
			(db.query(`SELECT title FROM content_projects WHERE id = 'p1'`).get() as { title: string })
				.title,
		).toBe("Has chat");
	});
});
