import { del, get, patch, post, put, request } from "./client.ts";
import { agentTemplateCatalogSchema } from "@maleo/shared";

export async function getAgentTemplates() {
	const response = await request("/api/admin/agent-templates", {}, { richError: true });
	return agentTemplateCatalogSchema.parse(await response.json());
}

export interface AdminUser {
	id: string;
	email: string;
	name: string;
	role: string;
	suspended: boolean;
	created_at: string;
	workspaces?: Array<{ name: string; role: "owner" | "member"; sole_owner: boolean }>;
}
export interface AdminWorkspace {
	name: string;
	display_name: string;
	status: string;
	description: string | null;
	project_count: number;
	created_at: number;
	last_activity?: number | null;
	members?: Array<{
		user_id: string;
		email: string | null;
		name: string | null;
		role: "owner" | "member";
	}>;
	invitations?: Array<{ id: string; role: string; expires_at: number }>;
}
export interface AdminProject {
	id: string;
	workspace: string;
	title: string;
	type: string;
	status: string;
	created_at: number;
	updated_at: number;
}
export interface AdminAudit {
	id: string;
	actor_id: string;
	action: string;
	target_type: string;
	target_id: string;
	outcome: "success" | "refused";
	reason: string | null;
	created_at: number;
}
export interface Page<T> {
	items: T[];
	total: number;
}
export type Directory = "users" | "workspaces" | "projects";
export type DirectoryItem = AdminUser | AdminWorkspace | AdminProject;

/** One page of any admin directory; the API caps it at 100. */
export const ADMIN_PAGE_SIZE = 20;

export interface DeleteImpact {
	workspace: string;
	affected_accounts: number;
	losing_access: Array<{ id: string; email: string }>;
	project_count: number;
	in_flight_runs: number;
	final_workspace: boolean;
}

const path = (part: string) => `/api/admin/${part}`;
const segment = (value: string) => encodeURIComponent(value);

export function listDirectory<T extends DirectoryItem>(
	kind: Directory,
	q: string,
	offset: number,
): Promise<Page<T>> {
	return get<Page<T>>(path(`${kind}?q=${segment(q)}&offset=${offset}&limit=${ADMIN_PAGE_SIZE}`));
}
export function getDetail<T extends DirectoryItem>(
	kind: Directory,
	id: string,
): Promise<{ item: T }> {
	return get<{ item: T }>(path(`${kind}/${segment(id)}`));
}
export const getAudit = (offset = 0) =>
	get<Page<AdminAudit>>(path(`audit?offset=${offset}&limit=${ADMIN_PAGE_SIZE}`));
export const getRegistrationPolicy = () =>
	get<{
		policy: {
			stored: "open" | "invitation_only";
			effective: "open" | "invitation_only";
			source: "stored" | "environment";
		};
	}>(path("authentication"));
export const saveRegistrationPolicy = (policy: "open" | "invitation_only") =>
	put(path("authentication"), { policy });
export const setUserRole = (id: string, role: "instance_owner" | "member") =>
	patch(path(`users/${segment(id)}/role`), { role });
export const setUserSuspended = (id: string, suspended: boolean) =>
	patch(path(`users/${segment(id)}/status`), { suspended });
export const revokeUserSessions = (id: string) =>
	post(path(`users/${segment(id)}/revoke-sessions`));
export const deleteUser = (id: string, confirm_email: string) =>
	del(path(`users/${segment(id)}`), { confirm_email });
export const grantMember = (name: string, id: string, role: "owner" | "member") =>
	put(path(`workspaces/${segment(name)}/members/${segment(id)}`), { role });
export const removeMember = (name: string, id: string) =>
	del(path(`workspaces/${segment(name)}/members/${segment(id)}`));
export const mintInvite = (name: string, role: "owner" | "member") =>
	post<{ item: { item: { id: string; role: string; expires_at: number }; token: string } }>(
		path(`workspaces/${segment(name)}/invitations`),
		{ role },
	);
export const revokeInvite = (name: string, id: string) =>
	del(path(`workspaces/${segment(name)}/invitations/${segment(id)}`));
export const createWorkspace = (name: string, owner_email: string, display_name: string) =>
	post(path("workspaces"), { name, owner_email, display_name });
export const updateWorkspace = (
	name: string,
	body: { display_name?: string; description?: string | null },
) => patch(path(`workspaces/${segment(name)}`), body);
export const getWorkspaceDeleteImpact = (name: string) =>
	get<{ item: DeleteImpact }>(path(`workspaces/${segment(name)}/delete-impact`));
/** Confirms the accounts that lose access by id, so a swapped account between
 *  preview and confirmation is refused rather than matched by count. */
export const deleteWorkspace = (name: string, losingAccess: readonly string[]) =>
	del(path(`workspaces/${segment(name)}`), {
		confirm_name: name,
		confirm_losing_access: losingAccess,
	});
