/* Removing a workspace and everything that belongs to it.
 *
 * The hard part is not the workspace's own rows. It is the rows that belong to
 * it and never say so: a storyboard belongs to a project, a step belongs to a
 * run, a credit transaction belongs to an account. Each is two or three joins
 * from the partition key, and each is invisible to a `DELETE ... WHERE
 * workspace = ?`.
 *
 * Two rules hold this together.
 *
 * FIRST, the directly-scoped tables are read from the LIVE DATABASE, not from a
 * list in this file. A feature that adds a workspace-partitioned table and
 * forgets to come here would otherwise leave rows that no query can reach and
 * no operator can see — the silent half of a deletion bug, discovered months
 * later by someone counting rows. Asking the database which tables have a
 * `workspace` column means the answer is always current.
 *
 * SECOND, the indirect subtrees are deleted leaf-first and named explicitly,
 * because their shape is a fact about this schema rather than something
 * derivable: only a human knows that `step_run` reaches a workspace through
 * `workflow_run` and `content_projects`. Each one is a subquery against its
 * parent rather than a collected list of ids, so a workspace with ten thousand
 * projects is still one statement.
 *
 * ROWS ONLY. Files are the caller's second step, and must happen after this
 * commits — see the header of `deleteWorkspaceFiles` in the API layer for why
 * that order is not negotiable.
 */
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";

/* The live catalogue, asked of whichever engine this is. Discovered rather than
 * listed, so a table added later is covered without an edit here. */
async function liveTables(db: Db): Promise<string[]> {
	const rows =
		db.dialect === "postgres"
			? await db.all<{ name: string }>(`SELECT table_name AS name FROM information_schema.tables
			 WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`)
			: await db.all<{ name: string }>(
					`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
				);
	return rows.map((r) => r.name);
}

async function liveColumns(db: Db, table: string): Promise<string[]> {
	const rows =
		db.dialect === "postgres"
			? await db.all<{ name: string }>(
					`SELECT column_name AS name FROM information_schema.columns
			 WHERE table_schema = current_schema() AND table_name = ?`,
					[table],
				)
			: await db.all<{ name: string }>(`SELECT name FROM pragma_table_info(?)`, [table]);
	return rows.map((r) => r.name);
}

/** Tables in the live database carrying a `workspace` column. */
async function directlyScopedTables(db: Db): Promise<string[]> {
	const out: string[] = [];
	for (const table of await liveTables(db)) {
		// `workspaces` itself is keyed by `name`, not scoped by `workspace`. It is
		// deleted last, on its own, once everything pointing at it is gone.
		if (table === "workspaces") continue;
		if ((await liveColumns(db, table)).includes("workspace")) out.push(table);
	}
	return out;
}

/** Tables carrying a credit-style `scope_id` that can name a workspace. */
async function scopeScopedTables(db: Db): Promise<string[]> {
	const out: string[] = [];
	for (const table of await liveTables(db)) {
		const cols = await liveColumns(db, table);
		if (cols.includes("scope_id") && cols.includes("scope_type")) out.push(table);
	}
	return out;
}

/* Column names that hold a reference to a file.
 *
 * Matched by shape rather than listed, for the same reason the table set is:
 * a feature that adds `thumbnail_path` should not have to remember this file.
 * The cost of the pattern being too broad is a value that resolves to no file
 * and is skipped; the cost of it being too narrow is media left on disk with
 * nothing left in the database that names it. */
const FILE_COLUMN = /(^|_)(src|url|path)$/;

/**
 * Every file reference held by this workspace's rows, as stored.
 *
 * Read BEFORE deleting, because after deletion there is nothing left to ask.
 * Returns raw column values — resolving them to paths on disk, and deciding
 * which are ours to remove, is the caller's job: this package does not touch
 * the filesystem.
 */
export async function collectWorkspaceFileRefs(
	workspace: string,
	db: Db = openDb(),
): Promise<string[]> {
	const refs = new Set<string>();

	const collect = async (table: string, where: string, params: unknown[]): Promise<void> => {
		const cols = (await liveColumns(db, table)).filter((name) => FILE_COLUMN.test(name));
		if (cols.length === 0) return;
		/* SAFETY: `cols` came from the live catalogue for this same table, so every
		 * name is a real column and the row shape is a record of them. The values
		 * are read defensively below — only strings are kept — because a column
		 * matching FILE_COLUMN may still hold a number or null. */
		const rows = (await db.all(
			`SELECT ${cols.join(", ")} FROM ${table} WHERE ${where}`,
			params as never[],
		)) as Record<string, unknown>[];
		for (const row of rows) {
			for (const value of Object.values(row)) {
				if (typeof value === "string" && value.trim()) refs.add(value);
			}
		}
	};

	for (const table of await directlyScopedTables(db))
		await collect(table, "workspace = ?", [workspace]);

	const projects = `SELECT id FROM content_projects WHERE workspace = ?`;
	for (const table of [
		"content_renders",
		"run_artifact",
		"project_style_lock",
		"project_citation",
	]) {
		await collect(table, `project_id IN (${projects})`, [workspace]);
	}

	return [...refs];
}

/**
 * Runs still in flight for this workspace, as {runId, projectId}.
 *
 * Read before deleting so the caller can cancel them. Inngest holds run state
 * of its own: left alone, a run whose rows have vanished wakes up, fails on a
 * project that is not there, and retries — noise for something that was
 * deliberately destroyed. Cancelling first turns that into a clean stop.
 */
export async function listInFlightRuns(
	workspace: string,
	db: Db = openDb(),
): Promise<{ runId: string; projectId: string }[]> {
	return await db.all<{ runId: string; projectId: string }>(
		`SELECT wr.id AS runId, wr.project_id AS projectId
			 FROM workflow_run wr
			 JOIN content_projects p ON p.id = wr.project_id
			 WHERE p.workspace = ? AND wr.status IN ('running', 'awaiting_input')`,
		[workspace],
	);
}

/**
 * Delete every row belonging to `workspace`, in one transaction.
 *
 * A workspace that does not exist is not an error — the rows are already gone,
 * which is what the caller asked for.
 */
export function deleteWorkspaceRows(workspace: string, db: Db = openDb()): Promise<void> {
	return db.transaction(async (db) => {
		/* Leaf-first, three levels deep.
		 *
		 * `step_run`, `tool_run` and `required_action` hang off a run; the run and
		 * the project-linked tables hang off a project; the project carries the
		 * workspace. Deleting the project first would strand all of them. */
		const runsOfWorkspace = `
			SELECT wr.id FROM workflow_run wr
			JOIN content_projects p ON p.id = wr.project_id
			WHERE p.workspace = ?`;
		const projectsOfWorkspace = `SELECT id FROM content_projects WHERE workspace = ?`;

		for (const table of ["step_run", "tool_run", "required_action"]) {
			await db.run(`DELETE FROM ${table} WHERE workflow_run_id IN (${runsOfWorkspace})`, [
				workspace,
			]);
		}
		await db.run(`DELETE FROM workflow_run WHERE project_id IN (${projectsOfWorkspace})`, [
			workspace,
		]);

		for (const table of [
			"content_renders",
			"content_project_outputs",
			"content_project_events",
			"content_storyboards",
			"project_reference",
			"project_note",
			"project_speaker",
			"project_style_lock",
			"project_citation",
			"run_artifact",
		]) {
			await db.run(`DELETE FROM ${table} WHERE project_id IN (${projectsOfWorkspace})`, [
				workspace,
			]);
		}

		/* Credits hang off an account, and the account is the only row that knows
		 * which workspace it belongs to. */
		const accountsOfWorkspace = `
			SELECT id FROM credit_accounts WHERE scope_type = 'workspace' AND scope_id = ?`;
		for (const table of ["credit_transactions", "usage_records", "credit_reservations"]) {
			await db.run(`DELETE FROM ${table} WHERE account_id IN (${accountsOfWorkspace})`, [
				workspace,
			]);
		}

		// Everything carrying the partition key, discovered rather than listed.
		for (const table of await directlyScopedTables(db)) {
			await db.run(`DELETE FROM ${table} WHERE workspace = ?`, [workspace]);
		}

		// Credit accounts and policies, which name the workspace as a scope.
		for (const table of await scopeScopedTables(db)) {
			await db.run(`DELETE FROM ${table} WHERE scope_type = 'workspace' AND scope_id = ?`, [
				workspace,
			]);
		}

		// The registry row last: until here, something still pointed at it.
		await db.run(`DELETE FROM workspaces WHERE name = ?`, [workspace]);
	});
}
