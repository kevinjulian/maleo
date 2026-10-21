import { openDb } from "@maleo/db/connection";
import { serialize, type Db } from "@maleo/db/handle";
import { recordAdminAudit } from "@maleo/db/admin-audit";
import { INSTANCE_OWNER, MEMBER, MODEL_NAMES } from "@maleo/auth/config";

export class AdminConflict extends Error {
	constructor(
		public readonly reason: string,
		public readonly status: 404 | 409 = 409,
	) {
		super(reason);
	}
}

interface AccountState {
	id: string;
	role: string;
	suspended: boolean;
}
const account = (id: string, db: Db) =>
	db.get<AccountState>(`SELECT id, role, suspended FROM ${MODEL_NAMES.user} WHERE id = ?`, [id]);
const activeOwnerCount = async (db: Db) =>
	(
		await db.get<{ c: number }>(
			`SELECT count(*) AS c FROM ${MODEL_NAMES.user} WHERE role = ? AND suspended = false`,
			[INSTANCE_OWNER],
		)
	)?.c ?? 0;

async function lastInstanceOwnerGuard(
	current: AccountState,
	nextRole: string,
	nextSuspended: boolean,
	db: Db,
) {
	if (
		current.role === INSTANCE_OWNER &&
		!current.suspended &&
		(nextRole !== INSTANCE_OWNER || nextSuspended)
	) {
		if ((await activeOwnerCount(db)) <= 1) throw new AdminConflict("last_instance_owner");
	}
}

export async function setAccountRole(
	actorId: string,
	id: string,
	role: typeof INSTANCE_OWNER | typeof MEMBER,
) {
	return openDb().transaction(async (tx) => {
		await serialize(tx, "instance-owners");
		const current = await account(id, tx);
		if (!current) throw new AdminConflict("user_not_found", 404);
		if (role === INSTANCE_OWNER && current.suspended) throw new AdminConflict("suspended_account");
		await lastInstanceOwnerGuard(current, role, current.suspended, tx);
		await tx.run(`UPDATE ${MODEL_NAMES.user} SET role = ? WHERE id = ?`, [role, id]);
		await recordAdminAudit(
			{
				actor_id: actorId,
				action: "account.role",
				target_type: "user",
				target_id: id,
				outcome: "success",
				reason: null,
			},
			tx,
		);
		return { id, role, suspended: current.suspended };
	});
}

export async function setAccountSuspended(actorId: string, id: string, suspended: boolean) {
	return openDb().transaction(async (tx) => {
		await serialize(tx, "instance-owners");
		const current = await account(id, tx);
		if (!current) throw new AdminConflict("user_not_found", 404);
		await lastInstanceOwnerGuard(current, current.role, suspended, tx);
		await tx.run(
			`UPDATE ${MODEL_NAMES.user} SET suspended = ${suspended ? "true" : "false"} WHERE id = ?`,
			[id],
		);
		if (suspended) await tx.run(`DELETE FROM ${MODEL_NAMES.session} WHERE "userId" = ?`, [id]);
		await recordAdminAudit(
			{
				actor_id: actorId,
				action: suspended ? "account.suspend" : "account.restore",
				target_type: "user",
				target_id: id,
				outcome: "success",
				reason: null,
			},
			tx,
		);
		return { id, role: current.role, suspended };
	});
}

export async function revokeAccountSessions(actorId: string, id: string) {
	return openDb().transaction(async (tx) => {
		if (!(await account(id, tx))) throw new AdminConflict("user_not_found", 404);
		const result = await tx.run(`DELETE FROM ${MODEL_NAMES.session} WHERE "userId" = ?`, [id]);
		await recordAdminAudit(
			{
				actor_id: actorId,
				action: "account.sessions.revoke",
				target_type: "user",
				target_id: id,
				outcome: "success",
				reason: null,
			},
			tx,
		);
		return { revoked: result.changes };
	});
}

export async function deleteAccount(actorId: string, id: string) {
	return openDb().transaction(async (tx) => {
		await serialize(tx, "instance-owners");
		const current = await account(id, tx);
		if (!current) throw new AdminConflict("user_not_found", 404);
		await lastInstanceOwnerGuard(current, MEMBER, true, tx);
		const owned = await tx.all<{ workspace: string }>(
			`SELECT workspace FROM workspace_members WHERE user_id = ? AND role = 'owner' ORDER BY workspace`,
			[id],
		);
		for (const { workspace } of owned) {
			await serialize(tx, `owners:${workspace}`);
			const count =
				(
					await tx.get<{ c: number }>(
						`SELECT count(*) AS c FROM workspace_members WHERE workspace = ? AND role = 'owner'`,
						[workspace],
					)
				)?.c ?? 0;
			if (count <= 1) throw new AdminConflict(`last_workspace_owner:${workspace}`);
		}
		await tx.run(`DELETE FROM ${MODEL_NAMES.session} WHERE "userId" = ?`, [id]);
		await tx.run(`DELETE FROM ${MODEL_NAMES.account} WHERE "userId" = ?`, [id]);
		await tx.run(`DELETE FROM workspace_members WHERE user_id = ?`, [id]);
		await tx.run(`DELETE FROM ${MODEL_NAMES.user} WHERE id = ?`, [id]);
		await recordAdminAudit(
			{
				actor_id: actorId,
				action: "account.delete",
				target_type: "user",
				target_id: id,
				outcome: "success",
				reason: null,
			},
			tx,
		);
		return { deleted: id };
	});
}
