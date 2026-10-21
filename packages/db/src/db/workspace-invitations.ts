/* Invitations to a workspace.
 *
 * THE TOKEN IS NEVER STORED. `mintInvitation` returns the plaintext exactly
 * once — that return value is the only copy that will ever exist — and the row
 * keeps sha256 of it. This is a credential that creates accounts, so a database
 * read must not hand out working invitations to every workspace on the
 * deployment, for the same reason `auth_account` holds a verifier and not a
 * password.
 *
 * Four things can be wrong with a presented token, and all four answer the same
 * way: forged, expired, already redeemed, revoked. `findRedeemable` returns
 * null for every one of them rather than saying which, because the difference
 * is only useful to somebody probing.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";
import type { WorkspaceRole } from "./workspace-members.ts";

/* Forty-eight hours, not the seven days a session gets.
 *
 * A session is held by someone who has already proved who they are. An
 * invitation is held by someone who has not, sitting in an inbox or a chat
 * neither end controls, and it CREATES an account. The exposure window is the
 * whole risk. An expired invitation costs an owner one click to replace; an
 * over-long one costs an account nobody meant to exist. */
export const INVITATION_LIFETIME_MS = 48 * 60 * 60 * 1000;

export interface WorkspaceInvitationRow {
	id: string;
	workspace: string;
	role: WorkspaceRole;
	invited_by: string;
	created_at: number;
	expires_at: number;
	redeemed_at: number | null;
	redeemed_by: string | null;
	revoked_at: number | null;
}

export interface MintedInvitation {
	row: WorkspaceInvitationRow;
	/** The only copy. Not stored, not recoverable — put it in the link now. */
	token: string;
}

export const hashInvitationToken = (token: string): string =>
	createHash("sha256").update(token).digest("hex");

const SELECT = `SELECT id, workspace, role, invited_by, created_at, expires_at,
                       redeemed_at, redeemed_by, revoked_at
                FROM workspace_invitations`;

export async function mintInvitation(
	input: { workspace: string; invitedBy: string; role?: WorkspaceRole; lifetimeMs?: number },
	db: Db = openDb(),
): Promise<MintedInvitation> {
	// 32 bytes of CSPRNG, base64url. Not a short code an operator reads aloud:
	// a guessable invitation is an account-creation endpoint anyone can brute.
	const token = randomBytes(32).toString("base64url");
	const now = Date.now();
	const id = crypto.randomUUID();

	await db.run(
		`INSERT INTO workspace_invitations
		 (id, workspace, token_hash, role, invited_by, created_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			input.workspace,
			hashInvitationToken(token),
			input.role ?? "member",
			input.invitedBy,
			now,
			now + (input.lifetimeMs ?? INVITATION_LIFETIME_MS),
		],
	);

	return { row: (await getInvitation(id, db))!, token };
}

export async function getInvitation(
	id: string,
	db: Db = openDb(),
): Promise<WorkspaceInvitationRow | null> {
	return (await db.get<WorkspaceInvitationRow>(`${SELECT} WHERE id = ?`, [id])) ?? null;
}

/** Invitations still worth showing an owner: not redeemed, not revoked. */
export async function listPendingInvitations(
	workspace: string,
	db: Db = openDb(),
): Promise<WorkspaceInvitationRow[]> {
	return await db.all<WorkspaceInvitationRow>(
		`${SELECT} WHERE workspace = ? AND redeemed_at IS NULL AND revoked_at IS NULL
			 ORDER BY created_at DESC`,
		[workspace],
	);
}

/**
 * The invitation this token redeems, or null.
 *
 * Null covers forged, expired, spent and revoked without distinguishing them.
 * A caller that reported which would be telling a prober whether a workspace
 * had ever issued an invitation, and when.
 */
export async function findRedeemable(
	token: string,
	db: Db = openDb(),
	now: number = Date.now(),
): Promise<WorkspaceInvitationRow | null> {
	const presented = hashInvitationToken(token);
	const row = await db.get<WorkspaceInvitationRow & { token_hash: string }>(
		`${SELECT.replace("SELECT id,", "SELECT token_hash, id,")} WHERE token_hash = ?`,
		[presented],
	);
	if (!row) return null;

	/* Constant-time even though the lookup above was an indexed equality match.
	 * The index already leaked nothing useful — both are hashes of the same
	 * length — but a later refactor that scans instead of indexes would silently
	 * become timing-sensitive, and this line is what stops that. */
	const a = Buffer.from(presented);
	const b = Buffer.from(row.token_hash);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

	if (row.revoked_at !== null) return null;
	if (row.redeemed_at !== null) return null;
	if (row.expires_at <= now) return null;
	return row;
}

/**
 * Mark an invitation spent, and say whether this call is the one that did it.
 *
 * The UPDATE carries the "still pending" condition rather than checking first:
 * two redemptions racing would both pass a separate check and both create an
 * account. Here the database decides, and exactly one sees a row change.
 */
export async function markRedeemed(
	id: string,
	userId: string,
	db: Db = openDb(),
): Promise<boolean> {
	const result = await db.run(
		`UPDATE workspace_invitations
		 SET redeemed_at = ?, redeemed_by = ?
		 WHERE id = ? AND redeemed_at IS NULL AND revoked_at IS NULL`,
		[Date.now(), userId, id],
	);
	return result.changes === 1;
}

/* Record who actually redeemed an invitation.
 *
 * Separate from `markRedeemed` because the claim has to happen BEFORE the
 * account exists — two redemptions racing must produce one winner, and the only
 * way to decide that is to claim the row first. At that moment there is no user
 * id to write. This is the second half of that trade, called once the account
 * has been created. */
export async function setInvitationRedeemer(
	id: string,
	userId: string,
	db: Db = openDb(),
): Promise<void> {
	await db.run(`UPDATE workspace_invitations SET redeemed_by = ? WHERE id = ?`, [userId, id]);
}

export async function revokeInvitation(id: string, db: Db = openDb()): Promise<boolean> {
	const result = await db.run(
		`UPDATE workspace_invitations SET revoked_at = ?
		 WHERE id = ? AND redeemed_at IS NULL AND revoked_at IS NULL`,
		[Date.now(), id],
	);
	return result.changes === 1;
}
