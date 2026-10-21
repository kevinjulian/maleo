/* The Manage surface's calls.
 *
 * Separate from `workspaces.ts` (the switcher's listing) because these are
 * administrative: they answer 403 to a member, and the surface needs that
 * refusal as an answer rather than as a thrown error to swallow. */
import { del, get, patch, post } from "./client.ts";

export interface WorkspaceDetail {
	name: string;
	display_name: string;
	description: string | null;
	status: string;
	project_count: number;
	/** The caller's own role here, so the surface knows what to offer. */
	viewer_role: "owner" | "member" | null;
}

export interface WorkspaceMember {
	user_id: string;
	/** Null when the account is gone but the membership row survived it. */
	email: string | null;
	name: string | null;
	role: "owner" | "member";
	created_at: number;
	is_you: boolean;
}

export interface PendingInvitation {
	id: string;
	role: "owner" | "member";
	created_at: number;
	expires_at: number;
}

export interface MembersView {
	items: WorkspaceMember[];
	invitations: PendingInvitation[];
	viewer_role: "owner" | "member";
}

export const readWorkspace = (name: string): Promise<{ item: WorkspaceDetail }> =>
	get(`/api/workspaces/${encodeURIComponent(name)}`);

export const saveWorkspace = (
	name: string,
	patchBody: { display_name?: string; description?: string | null },
): Promise<{ item: WorkspaceDetail }> =>
	patch(`/api/workspaces/${encodeURIComponent(name)}`, patchBody);

export const readMembers = (name: string): Promise<MembersView> =>
	get(`/api/workspaces/${encodeURIComponent(name)}/members`);

export const removeMember = (name: string, userId: string): Promise<unknown> =>
	del(`/api/workspaces/${encodeURIComponent(name)}/members/${encodeURIComponent(userId)}`);

/* The token comes back exactly once. It is not stored in plaintext anywhere, so
 * a caller that loses this response mints another invitation rather than
 * looking the old one up. */
export const createInvitation = (
	name: string,
	role: "owner" | "member" = "member",
): Promise<{ item: PendingInvitation; token: string }> =>
	post(`/api/workspaces/${encodeURIComponent(name)}/invitations`, { role });

export const revokeInvitation = (name: string, id: string): Promise<unknown> =>
	del(`/api/workspaces/${encodeURIComponent(name)}/invitations/${encodeURIComponent(id)}`);

/** Deletion names what it destroys — the API refuses a mismatch. */
export const deleteWorkspace = (name: string, confirmName: string): Promise<unknown> =>
	del(`/api/workspaces/${encodeURIComponent(name)}`, { confirm_name: confirmName });
