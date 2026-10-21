/* Workspace membership — which accounts may act in which workspace.
 *
 * `workspace` is the same tenant key every other family scopes by, and
 * `user_id` is the auth library's user id held as a plain column. No foreign
 * key in either direction: the two schemas migrate independently. See
 * AUTH_OWNED_TABLES in unified-schema.ts.
 *
 * Membership is the authorisation boundary. Workspace SCOPING — what a surface
 * chooses to display — is not, and the two must not be confused: a route that
 * filters by the active workspace without calling in here is open. */
import { openDb } from "./connection.ts";
import { serialize, type Db } from "./handle.ts";

export type WorkspaceRole = "owner" | "member";

export interface WorkspaceMemberRow {
	workspace: string;
	user_id: string;
	role: WorkspaceRole;
	created_at: number;
}

export async function addWorkspaceMember(
	input: { workspace: string; user_id: string; role?: WorkspaceRole },
	db: Db = openDb(),
): Promise<WorkspaceMemberRow> {
	await db.run(
		`INSERT INTO workspace_members (workspace, user_id, role, created_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(workspace, user_id) DO UPDATE SET role = excluded.role`,
		[input.workspace, input.user_id, input.role ?? "member", Date.now()],
	);
	return (await getWorkspaceMember(input.workspace, input.user_id, db))!;
}

export async function getWorkspaceMember(
	workspace: string,
	userId: string,
	db: Db = openDb(),
): Promise<WorkspaceMemberRow | null> {
	return (
		(await db.get<WorkspaceMemberRow>(
			`SELECT workspace, user_id, role, created_at
				 FROM workspace_members
				 WHERE workspace = ? AND user_id = ?`,
			[workspace, userId],
		)) ?? null
	);
}

export async function isWorkspaceMember(
	workspace: string,
	userId: string,
	db: Db = openDb(),
): Promise<boolean> {
	return (await getWorkspaceMember(workspace, userId, db)) !== null;
}

/** The workspaces an account may act in. This is what a workspace listing is
 *  scoped to — never the full registry. */
export async function listWorkspacesForUser(userId: string, db: Db = openDb()): Promise<string[]> {
	return (
		await db.all<{ workspace: string }>(
			`SELECT workspace FROM workspace_members WHERE user_id = ? ORDER BY workspace ASC`,
			[userId],
		)
	).map((r) => r.workspace);
}

export async function listWorkspaceMembers(
	workspace: string,
	db: Db = openDb(),
): Promise<WorkspaceMemberRow[]> {
	return await db.all<WorkspaceMemberRow>(
		`SELECT workspace, user_id, role, created_at
			 FROM workspace_members
			 WHERE workspace = ?
			 ORDER BY created_at ASC`,
		[workspace],
	);
}

export class LastOwnerError extends Error {
	constructor(workspace: string) {
		super(`refusing to leave workspace "${workspace}" with no owner`);
		this.name = "LastOwnerError";
	}
}

async function ownerCount(workspace: string, db: Db): Promise<number> {
	return (
		(
			await db.get<{ c: number }>(
				`SELECT count(*) AS c FROM workspace_members WHERE workspace = ? AND role = 'owner'`,
				[workspace],
			)
		)?.c ?? 0
	);
}

/* Removal and demotion are the same operation from the owner count's point of
 * view, so they share one guard. Checked and applied inside a transaction: two
 * concurrent removals that each saw two owners would otherwise both proceed and
 * leave zero. */
export function removeWorkspaceMember(
	workspace: string,
	userId: string,
	db: Db = openDb(),
): Promise<void> {
	return db.transaction(async (tx) => {
		await serialize(tx, `owners:${workspace}`);
		const existing = await getWorkspaceMember(workspace, userId, tx);
		if (!existing) return;
		if (existing.role === "owner" && (await ownerCount(workspace, tx)) <= 1) {
			throw new LastOwnerError(workspace);
		}
		await tx.run(`DELETE FROM workspace_members WHERE workspace = ? AND user_id = ?`, [
			workspace,
			userId,
		]);
	});
}

export function setWorkspaceMemberRole(
	workspace: string,
	userId: string,
	role: WorkspaceRole,
	db: Db = openDb(),
): Promise<void> {
	return db.transaction(async (tx) => {
		await serialize(tx, `owners:${workspace}`);
		const existing = await getWorkspaceMember(workspace, userId, tx);
		if (!existing) return;
		if (existing.role === "owner" && role !== "owner" && (await ownerCount(workspace, tx)) <= 1) {
			throw new LastOwnerError(workspace);
		}
		await tx.run(`UPDATE workspace_members SET role = ? WHERE workspace = ? AND user_id = ?`, [
			role,
			workspace,
			userId,
		]);
	});
}

/* Called by the workspace registry sync. A membership naming a workspace that
 * no longer exists is already unreachable — the registry check refuses the
 * request before membership is read — so this keeps the table from
 * accumulating rows nothing can reach, rather than closing a hole. */
export async function pruneMembershipsOutsideRegistry(db: Db = openDb()): Promise<number> {
	const result = await db.run(
		`DELETE FROM workspace_members
		 WHERE workspace NOT IN (SELECT name FROM workspaces)`,
	);
	return result.changes;
}
