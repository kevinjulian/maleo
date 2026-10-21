import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { applyUnifiedSchema, UNIFIED_RUNTIME_TABLES } from "../../src/db/unified-schema.ts";

/* Tables that are deliberately NOT partitioned by workspace, grouped by why.
 * Anything not listed here must carry a `workspace` column. */
const NOT_WORKSPACE_SCOPED = [
	// The workspace's own settings row — keyed by workspace, not scoped by it.
	"global_settings",

	// Global library/template tables: shared across every workspace by design.
	"content_timeline_templates",
	"content_presets",
	"content_motion_presets",
	"content_clip_templates",

	// Project-scoped: tenancy is reached through content_projects.workspace.
	"content_projects",
	"content_storyboards",
	"content_references",
	"content_renders",
	"content_project_outputs",
	"content_project_events",
	"content_assets",
	"project_reference",
	"project_note",
	"project_speaker",
	"asset_suppression",
	"project_style_lock",
	"project_citation",

	// Credit-scoped: an account is keyed by (scope_type, scope_id), which can be a
	// workspace but is not a workspace column.
	"credit_accounts",
	"credit_policies",
	"credit_reservations",
	"credit_transactions",
	"usage_records",

	// The registry itself: `workspaces.name` IS the tenant key, and a campaign spans
	// workspaces through workspaces_json rather than carrying one.
	"workspaces",
	"campaigns",

	// Run-scoped: tenancy is reached through workflow_run.workspace_id.
	"workflow_run",
	"step_run",
	"tool_run",
	"run_artifact",
	"required_action",
];

const WORKSPACE_SCOPED_TABLES = UNIFIED_RUNTIME_TABLES.filter(
	(table) => !NOT_WORKSPACE_SCOPED.includes(table),
);

function freshDb(): Database {
	const db = new Database(":memory:");
	applyUnifiedSchema(db);
	return db;
}

describe("unified-schema", () => {
	it("creates every runtime table", () => {
		const db = freshDb();
		const names = new Set(
			(
				db
					.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
					.all() as { name: string }[]
			).map((r) => r.name),
		);
		for (const t of UNIFIED_RUNTIME_TABLES) {
			expect(names.has(t)).toBe(true);
		}
	});

	it("is idempotent", () => {
		const db = freshDb();
		expect(() => applyUnifiedSchema(db)).not.toThrow();
	});

	it("retires legacy backfill URL uniqueness so deduplicated media keeps every ledger row", () => {
		const db = freshDb();
		db.exec(
			"CREATE UNIQUE INDEX idx_image_ledger_backfill ON image_ledger(project_id, asset_url) WHERE backfilled = 1",
		);
		const insert =
			"INSERT INTO image_ledger (id, workspace, project_id, source, status, asset_url, backfilled, created_at) VALUES (?, 'team', 'project', 'lab', 'completed', ?, 1, 1)";
		db.run(insert, ["one", "/uploads/one.png"]);
		db.run(insert, ["two", "/uploads/two.png"]);
		applyUnifiedSchema(db);
		expect(
			db
				.query(
					"SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_image_ledger_backfill'",
				)
				.get(),
		).toBeNull();
		db.run("UPDATE image_ledger SET asset_url = '/api/media/shared' WHERE project_id = 'project'");
		expect(
			db
				.query<{ count: number }, []>(
					"SELECT count(*) count FROM image_ledger WHERE asset_url = '/api/media/shared'",
				)
				.get()?.count,
		).toBe(2);
	});

	it("workspace-scoped runtime tables carry a workspace column", () => {
		const db = freshDb();
		for (const t of WORKSPACE_SCOPED_TABLES) {
			const cols = (db.query(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(
				(c) => c.name,
			);
			expect(cols).toContain("workspace");
		}
	});

	it("action_id is unique per workspace, not globally", () => {
		const db = freshDb();
		const ins =
			"INSERT INTO drafts (workspace, id, action_id, action, reasoning, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)";
		db.run(ins, ["a", "d1", "act-1", "POST", "r", "draft", 1, 1]);
		// same action_id, different workspace → allowed
		expect(() => db.run(ins, ["b", "d2", "act-1", "POST", "r", "draft", 1, 1])).not.toThrow();
		// same action_id, same workspace → rejected
		expect(() => db.run(ins, ["a", "d3", "act-1", "POST", "r", "draft", 1, 1])).toThrow();
	});

	/* A natural-key table's composite PRIMARY KEY includes `workspace`, so the same
	 * natural key is distinct per workspace and duplicate within one.
	 *
	 * This used to be asserted against `banned_authors` and `mood_state`, which no
	 * module read and which are no longer declared. The rule outlived them, so it
	 * is asserted here against `metrics` — a natural-key table that is still read —
	 * rather than deleted alongside the tables that happened to demonstrate it. */
	it("a natural-key table is keyed per workspace", () => {
		const db = freshDb();
		const ins = "INSERT INTO metrics (workspace, post_id, platform, fetched_at) VALUES (?,?,?,?)";
		db.run(ins, ["a", "p1", "tiktok", 1]);
		// same natural key, different workspace → distinct row
		expect(() => db.run(ins, ["b", "p1", "tiktok", 1])).not.toThrow();
		// same natural key, same workspace → rejected
		expect(() => db.run(ins, ["a", "p1", "tiktok", 1])).toThrow();
		const rows = db.query("SELECT workspace FROM metrics").all();
		expect(rows.length).toBe(2);
	});

	it("drafts has campaign_id for direct campaign linkage", () => {
		const db = freshDb();
		const cols = (db.query("PRAGMA table_info(drafts)").all() as { name: string }[]).map(
			(c) => c.name,
		);
		expect(cols).toContain("campaign_id");
	});

	it("reconciles legacy content_renders before creating output_id index", () => {
		const db = new Database(":memory:");
		db.exec(`
			CREATE TABLE content_renders (
				id TEXT PRIMARY KEY,
				project_id TEXT NOT NULL,
				storyboard_id TEXT,
				draft_id TEXT,
				video_job_id TEXT,
				status TEXT NOT NULL,
				phase TEXT,
				output_path TEXT,
				output_url TEXT,
				manifest_path TEXT,
				duration_sec REAL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
		`);
		expect(() => applyUnifiedSchema(db)).not.toThrow();
		const cols = (db.query("PRAGMA table_info(content_renders)").all() as { name: string }[]).map(
			(c) => c.name,
		);
		expect(cols).toContain("output_id");
	});
});
