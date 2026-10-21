/* Deleting a workspace leaves NOTHING behind.
 *
 * This test is the specification and the delete function is an implementation
 * of it. The interesting rows are the ones that carry no workspace column at
 * all: a storyboard belongs to a project, a step belongs to a run, a credit
 * transaction belongs to an account. Every one of them belongs to the
 * workspace, and none of them says so.
 *
 * The final assertion is deliberately blunt and generic — it walks every
 * runtime table and fails if any row anywhere still mentions the workspace, by
 * key or by id. A per-table assertion list would pass the day someone adds a
 * table and forgets it here, which is the exact failure this guards.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openTestDb, type TestDb } from "./handle-testing.ts";
import type { Db } from "./handle.ts";
import { RUNTIME_TABLES } from "./schema.ts";
import { upsertWorkspace } from "./workspaces.ts";
import { addWorkspaceMember } from "./workspace-members.ts";
import { deleteWorkspaceRows } from "./workspace-delete.ts";

let db: Db;
let t: TestDb;

const PROJECT = "p-alpha";
const RUN = "wr-alpha";
const TOOL_RUN = "tr-alpha";
const ACCOUNT = "acct-alpha";
const STORYBOARD = "sb-alpha";
const OUTPUT = "out-alpha";

/** A table's columns, as the migrated database has them. */
async function columnsOf(table: string): Promise<string[]> {
	const rows = await db.all<{ name: string }>(
		`SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?`,
		[table],
	);
	return rows.map((r) => r.name);
}

/** Every table that carries the partition key directly. */
async function directlyScoped(): Promise<string[]> {
	const out: string[] = [];
	for (const table of RUNTIME_TABLES)
		if ((await columnsOf(table)).includes("workspace")) out.push(table);
	return out;
}

/* Seed one row in every table a workspace owns, direct and indirect.
 *
 * Written as raw inserts rather than through the family modules on purpose:
 * this is about what is ON DISK, and a family module that quietly skipped a
 * column would make the test agree with the bug. */
async function seedWorkspace(ws: string, suffix: string): Promise<void> {
	const now = Date.now();
	const id = (base: string): string => `${base}-${suffix}`;

	await upsertWorkspace({ name: ws, workspace_dir: `/tmp/${ws}` }, db);
	await addWorkspaceMember({ workspace: ws, user_id: `u-${suffix}`, role: "owner" }, db);

	await db.run(
		`INSERT INTO workspace_invitations (id, workspace, token_hash, role, invited_by, created_at, expires_at)
		 VALUES (?, ?, ?, 'member', ?, ?, ?)`,
		[id("inv"), ws, id("hash"), `u-${suffix}`, now, now + 3600_000],
	);

	// The project subtree.
	await db.run(
		`INSERT INTO content_projects (id, workspace, title, type, status, created_at, updated_at)
		 VALUES (?, ?, 'Seeded', 'video', 'draft', ?, ?)`,
		[id(PROJECT), ws, now, now],
	);
	await db.run(
		`INSERT INTO content_storyboards (id, project_id, version, storyboard_json, created_at)
		 VALUES (?, ?, 1, '{}', ?)`,
		[id(STORYBOARD), id(PROJECT), now],
	);
	await db.run(
		`INSERT INTO content_project_outputs (id, project_id, storyboard_id, title, created_at, updated_at)
		 VALUES (?, ?, ?, 'Output', ?, ?)`,
		[id(OUTPUT), id(PROJECT), id(STORYBOARD), now, now],
	);
	await db.run(
		`INSERT INTO content_renders (id, project_id, output_id, storyboard_id, status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 'done', ?, ?)`,
		[id("rnd"), id(PROJECT), id(OUTPUT), id(STORYBOARD), now, now],
	);
	await db.run(
		`INSERT INTO content_project_events (id, project_id, actor_type, kind, summary, created_at)
		 VALUES (?, ?, 'system', 'project.created', 'Seeded.', ?)`,
		[id("evt"), id(PROJECT), now],
	);
	await db.run(
		`INSERT INTO project_note (id, project_id, label, created_at, updated_at) VALUES (?, ?, 'n', ?, ?)`,
		[id("note"), id(PROJECT), now, now],
	);
	await db.run(
		`INSERT INTO project_speaker (id, project_id, voice_key, name, created_at) VALUES (?, ?, 'vk', 'sp', ?)`,
		[id("spk"), id(PROJECT), now],
	);
	await db.run(
		`INSERT INTO project_citation (id, project_id, url, title, created_at) VALUES (?, ?, 'https://x', 'T', ?)`,
		[id("cit"), id(PROJECT), now],
	);
	await db.run(`INSERT INTO project_style_lock (project_id, updated_at) VALUES (?, ?)`, [
		id(PROJECT),
		now,
	]);

	// The durable run subtree.
	await db.run(
		`INSERT INTO workflow_run (id, project_id, content_type, status, created_at, updated_at)
		 VALUES (?, ?, 'video', 'running', ?, ?)`,
		[id(RUN), id(PROJECT), now, now],
	);
	await db.run(
		`INSERT INTO tool_run (id, workflow_run_id, tool_name, status, created_at, updated_at)
		 VALUES (?, ?, 'x', 'done', ?, ?)`,
		[id(TOOL_RUN), id(RUN), now, now],
	);
	await db.run(
		`INSERT INTO step_run (id, workflow_run_id, idx, tool_name, status, created_at, updated_at)
		 VALUES (?, ?, 1, 'x', 'done', ?, ?)`,
		[id("step"), id(RUN), now, now],
	);
	await db.run(
		`INSERT INTO required_action (id, workflow_run_id, type, created_at)
		 VALUES (?, ?, 'approval', ?)`,
		[id("act"), id(RUN), now],
	);
	await db.run(
		`INSERT INTO run_artifact (id, project_id, tool_run_id, kind, created_at)
		 VALUES (?, ?, ?, 'image', ?)`,
		[id("art"), id(PROJECT), id(TOOL_RUN), now],
	);

	// Credits: scoped by scope_id, then reached by account_id.
	await db.run(
		`INSERT INTO credit_accounts (id, scope_type, scope_id, available_credits, reserved_credits, created_at, updated_at)
		 VALUES (?, 'workspace', ?, 100, 0, ?, ?)`,
		[id(ACCOUNT), ws, now, now],
	);
	await db.run(
		`INSERT INTO credit_policies (id, scope_type, scope_id, created_at, updated_at)
		 VALUES (?, 'workspace', ?, ?, ?)`,
		[id("pol"), ws, now, now],
	);
	await db.run(
		`INSERT INTO credit_transactions (id, account_id, type, amount_credits, balance_available_after, balance_reserved_after, created_at)
		 VALUES (?, ?, 'grant', 100, 100, 0, ?)`,
		[id("ctx"), id(ACCOUNT), now],
	);
	await db.run(
		`INSERT INTO credit_reservations (id, account_id, reference_type, reference_id, requested_credits, reserved_credits, captured_credits, status, created_at, updated_at)
		 VALUES (?, ?, 'run', 'r1', 10, 10, 0, 'open', ?, ?)`,
		[id("res"), id(ACCOUNT), now, now],
	);
	await db.run(
		`INSERT INTO usage_records (id, account_id, operation, quantity, unit, charged_credits, pricing_version, created_at)
		 VALUES (?, ?, 'image', 1, 'image', 5, 'v1', ?)`,
		[id("use"), id(ACCOUNT), now],
	);

	// A sample of the directly-scoped tables that hold real work.
	await db.run(
		`INSERT INTO reference_entity (id, workspace, role, label, created_at, updated_at) VALUES (?, ?, 'character', 'ref', ?, ?)`,
		[id("ref"), ws, now, now],
	);
	await db.run(
		`INSERT INTO voice_clone (id, workspace, provider_id, label, lang, ref_url, created_at, updated_at) VALUES (?, ?, 'p', 'v', 'en', 'https://x', ?, ?)`,
		[id("vc"), ws, now, now],
	);
	await db.run(
		`INSERT INTO content_materials (id, workspace, name, material_group, created_at, updated_at) VALUES (?, ?, 'mat', 'story', ?, ?)`,
		[id("mat"), ws, now, now],
	);
	await db.run(
		`INSERT INTO content_assets (id, workspace, kind, label, src, created_at, updated_at) VALUES (?, ?, 'image', 'a', 'https://x', ?, ?)`,
		[id("ast"), ws, now, now],
	);
}

/** Every row anywhere that still mentions this workspace, by key or by id. */
async function traces(ws: string, suffix: string): Promise<string[]> {
	const found: string[] = [];
	for (const table of RUNTIME_TABLES) {
		const cols = await columnsOf(table);
		if (cols.includes("workspace")) {
			const n =
				(
					await db.get<{ c: number }>(`SELECT count(*) AS c FROM ${table} WHERE workspace = ?`, [
						ws,
					])
				)?.c ?? 0;
			if (n) found.push(`${table} (workspace=${ws}): ${n}`);
		}
		if (table === "workspaces") {
			const n =
				(await db.get<{ c: number }>(`SELECT count(*) AS c FROM workspaces WHERE name = ?`, [ws]))
					?.c ?? 0;
			if (n) found.push(`workspaces (name=${ws}): ${n}`);
		}
		if (cols.includes("scope_id")) {
			const n =
				(await db.get<{ c: number }>(`SELECT count(*) AS c FROM ${table} WHERE scope_id = ?`, [ws]))
					?.c ?? 0;
			if (n) found.push(`${table} (scope_id=${ws}): ${n}`);
		}
		// Indirect rows carry the seed suffix in their id, which is how a row
		// reachable only through a project or a run is caught here at all.
		if (cols.includes("id")) {
			const n =
				(
					await db.get<{ c: number }>(
						`SELECT count(*) AS c FROM ${table} WHERE CAST(id AS text) LIKE ?`,
						[`%-${suffix}`],
					)
				)?.c ?? 0;
			if (n) found.push(`${table} (id ~ ${suffix}): ${n}`);
		}
	}
	return found;
}

beforeEach(async () => {
	t = await openTestDb("postgres");
	db = t.db;
});
afterEach(() => t.close());

describe("deleting a workspace removes everything partitioned by it", () => {
	test("a workspace with work in it leaves no trace", async () => {
		await seedWorkspace("alpha", "a");
		// Sanity: the seed actually put something everywhere.
		expect((await traces("alpha", "a")).length).toBeGreaterThan(15);

		await deleteWorkspaceRows("alpha", db);

		expect(await traces("alpha", "a")).toEqual([]);
	});

	test("another workspace is untouched", async () => {
		await seedWorkspace("alpha", "a");
		await seedWorkspace("beta", "b");
		const before = await traces("beta", "b");

		await deleteWorkspaceRows("alpha", db);

		expect(await traces("beta", "b")).toEqual(before);
		expect(before.length).toBeGreaterThan(15);
	});

	test("the workspace row itself is gone", async () => {
		await seedWorkspace("alpha", "a");

		await deleteWorkspaceRows("alpha", db);

		expect(
			(await db.get<{ c: number }>(`SELECT count(*) AS c FROM workspaces WHERE name = 'alpha'`))?.c,
		).toBe(0);
	});

	test("deleting a workspace that does not exist is not an error", async () => {
		await expect(deleteWorkspaceRows("ghost", db)).resolves.toBeUndefined();
	});
});

describe("the table set is derived, not hand-kept", () => {
	test("every directly-scoped table is cleared without naming it here", async () => {
		await seedWorkspace("alpha", "a");

		await deleteWorkspaceRows("alpha", db);

		// Walks the schema rather than a list: a workspace-partitioned table added
		// tomorrow is covered by this assertion the day it is declared.
		for (const table of await directlyScoped()) {
			const n =
				(
					await db.get<{ c: number }>(`SELECT count(*) AS c FROM ${table} WHERE workspace = ?`, [
						"alpha",
					])
				)?.c ?? 0;
			expect(`${table}:${n}`).toBe(`${table}:0`);
		}
	});

	test("a newly declared workspace-partitioned table is covered", async () => {
		// Stands in for a future schema addition the delete module has never heard
		// of. It is created outside UNIFIED_SCHEMA, so if the implementation reads
		// the live database rather than a hardcoded list, it is cleared.
		await db.exec(`CREATE TABLE future_feature (id TEXT PRIMARY KEY, workspace TEXT NOT NULL)`);
		await db.run(`INSERT INTO future_feature (id, workspace) VALUES ('f1', 'alpha')`);
		await seedWorkspace("alpha", "a");

		await deleteWorkspaceRows("alpha", db);

		expect(
			(
				await db.get<{ c: number }>(
					`SELECT count(*) AS c FROM future_feature WHERE workspace = 'alpha'`,
				)
			)?.c,
		).toBe(0);
	});
});
