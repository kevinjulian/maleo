import { openDb } from "@maleo/db/connection";
import { recordAdminAudit } from "@maleo/db/admin-audit";
import { getWorkspace, listWorkspaces, updateWorkspace } from "@maleo/db/workspaces";
import {
	addWorkspaceMember,
	getWorkspaceMember,
	LastOwnerError,
	listWorkspaceMembers,
	removeWorkspaceMember,
	setWorkspaceMemberRole,
	type WorkspaceRole,
} from "@maleo/db/workspace-members";
import { getInvitation, mintInvitation, revokeInvitation } from "@maleo/db/workspace-invitations";
import { listInFlightRuns } from "@maleo/db/workspace-delete";
import { scaffoldWorkspace } from "./workspace/scaffold.ts";
import { deleteWorkspace, FinalWorkspaceError } from "./workspace/delete.ts";
import { AdminConflict } from "./admin-accounts.ts";
import { MODEL_NAMES } from "@maleo/auth/config";

const missing = async (name: string) => {
	if (!(await getWorkspace(name))) throw new AdminConflict("workspace_not_found", 404);
};

export async function grantAdminMembership(
	actorId: string,
	workspace: string,
	userId: string,
	role: WorkspaceRole,
) {
	await missing(workspace);
	const exists = await openDb().get<{ id: string }>(
		`SELECT id FROM ${MODEL_NAMES.user} WHERE id = ?`,
		[userId],
	);
	if (!exists) throw new AdminConflict("user_not_found", 404);
	return openDb().transaction(async (tx) => {
		const prior = await getWorkspaceMember(workspace, userId, tx);
		if (prior) await setWorkspaceMemberRole(workspace, userId, role, tx);
		else await addWorkspaceMember({ workspace, user_id: userId, role }, tx);
		await recordAdminAudit(
			{
				actor_id: actorId,
				action: prior ? "membership.role" : "membership.grant",
				target_type: "user",
				target_id: userId,
				outcome: "success",
				reason: workspace,
			},
			tx,
		);
		return await getWorkspaceMember(workspace, userId, tx);
	});
}

export async function removeAdminMembership(actorId: string, workspace: string, userId: string) {
	await missing(workspace);
	return openDb().transaction(async (tx) => {
		await removeWorkspaceMember(workspace, userId, tx);
		await recordAdminAudit(
			{
				actor_id: actorId,
				action: "membership.remove",
				target_type: "user",
				target_id: userId,
				outcome: "success",
				reason: workspace,
			},
			tx,
		);
		return { removed: userId };
	});
}

export async function createAdminInvitation(
	actorId: string,
	workspace: string,
	role: WorkspaceRole,
) {
	await missing(workspace);
	return openDb().transaction(async (tx) => {
		const minted = await mintInvitation({ workspace, invitedBy: actorId, role }, tx);
		await recordAdminAudit(
			{
				actor_id: actorId,
				action: "invitation.mint",
				target_type: "invitation",
				target_id: minted.row.id,
				outcome: "success",
				reason: workspace,
			},
			tx,
		);
		return { item: minted.row, token: minted.token };
	});
}

export async function revokeAdminInvitation(actorId: string, workspace: string, id: string) {
	const existing = await getInvitation(id);
	if (!existing || existing.workspace !== workspace)
		throw new AdminConflict("invitation_not_found", 404);
	return openDb().transaction(async (tx) => {
		const revoked = await revokeInvitation(id, tx);
		await recordAdminAudit(
			{
				actor_id: actorId,
				action: "invitation.revoke",
				target_type: "invitation",
				target_id: id,
				outcome: "success",
				reason: workspace,
			},
			tx,
		);
		return { revoked };
	});
}

/* Created with a named owner, like the ordinary route's creator-owns rule: a
 * workspace with no owner cannot be managed from its own surface and breaks
 * the last-owner guarantee from birth. The owner is chosen explicitly so the
 * admin never becomes a member as a side effect. */
export async function createAdminWorkspace(
	actorId: string,
	name: string,
	ownerEmail: string,
	displayName?: string,
) {
	const owner = await openDb().get<{ id: string }>(
		`SELECT id FROM ${MODEL_NAMES.user} WHERE lower(email) = ?`,
		[ownerEmail.trim().toLowerCase()],
	);
	if (!owner) throw new AdminConflict("owner_not_found", 404);
	if (await getWorkspace(name)) throw new AdminConflict("workspace_exists");
	await openDb().transaction(async (tx) => {
		// Re-checked inside: a concurrent create between the check above and here.
		await scaffoldWorkspace(name, { displayName }, tx).catch((error: unknown) => {
			if (error instanceof Error && error.message.includes("already exists"))
				throw new AdminConflict("workspace_exists");
			throw error;
		});
		await addWorkspaceMember({ workspace: name, user_id: owner.id, role: "owner" }, tx);
		await recordAdminAudit(
			{
				actor_id: actorId,
				action: "workspace.create",
				target_type: "workspace",
				target_id: name,
				outcome: "success",
				reason: null,
			},
			tx,
		);
	});
	return getWorkspace(name);
}

export async function updateAdminWorkspace(
	actorId: string,
	name: string,
	patch: { display_name?: string; description?: string | null },
) {
	return openDb().transaction(async (tx) => {
		const updated = await updateWorkspace(name, patch, tx);
		if (!updated) throw new AdminConflict("workspace_not_found", 404);
		await recordAdminAudit(
			{
				actor_id: actorId,
				action: "workspace.update",
				target_type: "workspace",
				target_id: name,
				outcome: "success",
				reason: null,
			},
			tx,
		);
		return updated;
	});
}

export async function adminWorkspaceDeleteImpact(name: string) {
	await missing(name);
	const members = await listWorkspaceMembers(name);
	const losingAccess = await openDb().all<{ id: string; email: string }>(
		`SELECT u.id, u.email FROM workspace_members m
		 JOIN ${MODEL_NAMES.user} u ON u.id = m.user_id
		 WHERE m.workspace = ? AND NOT EXISTS (
			SELECT 1 FROM workspace_members other WHERE other.user_id = m.user_id AND other.workspace <> ?)
		 ORDER BY u.email`,
		[name, name],
	);
	const projects = await openDb().get<{ c: number }>(
		`SELECT count(*) AS c FROM content_projects WHERE workspace = ?`,
		[name],
	);
	const runs = await listInFlightRuns(name);
	return {
		workspace: name,
		affected_accounts: members.length,
		losing_access: losingAccess,
		project_count: projects?.c ?? 0,
		in_flight_runs: runs.length,
		final_workspace: (await listWorkspaces()).length <= 1,
	};
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

/* The caller confirms WHO loses access, not how many: a count survives one
 * account swapping for another between preview and confirmation. */
export async function deleteAdminWorkspace(
	actorId: string,
	name: string,
	confirmedLosingAccess: readonly string[],
) {
	const impact = await adminWorkspaceDeleteImpact(name);
	if (impact.final_workspace) throw new AdminConflict("last_workspace");
	if (
		!sameIds(
			impact.losing_access.map((a) => a.id),
			confirmedLosingAccess,
		)
	)
		throw new AdminConflict("deletion_impact_changed");
	try {
		const report = await deleteWorkspace(name);
		await recordAdminAudit({
			actor_id: actorId,
			action: "workspace.delete",
			target_type: "workspace",
			target_id: name,
			outcome: "success",
			reason: null,
		});
		return { ...impact, ...report };
	} catch (error) {
		if (error instanceof FinalWorkspaceError) throw new AdminConflict("last_workspace");
		throw error;
	}
}

export { LastOwnerError };
