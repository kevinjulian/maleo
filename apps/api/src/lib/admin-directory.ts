import { openDb } from "@maleo/db/connection";
import { MODEL_NAMES } from "@maleo/auth/config";
import { getWorkspace } from "@maleo/db/workspaces";
import { listWorkspaceMembers } from "@maleo/db/workspace-members";
import { listPendingInvitations } from "@maleo/db/workspace-invitations";
import { accountLabels } from "@maleo/auth/accounts";

/* Search text is matched literally: `%` and `_` are LIKE wildcards, and a
 * search for "a_b" should not match "axb". Backslash is Postgres's default
 * LIKE escape. */
export const likePattern = (q: string) => `%${q.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;

export interface AdminAccount {
	id: string;
	email: string;
	name: string;
	role: string;
	suspended: boolean;
	created_at: Date;
}

export async function listAdminUsers(q: string, limit: number, offset: number) {
	const db = openDb();
	const match = likePattern(q);
	const where = `WHERE lower(email) LIKE ? OR lower(name) LIKE ?`;
	const [items, count] = await Promise.all([
		db.all<AdminAccount>(
			`SELECT id, email, name, role, suspended, "createdAt" AS created_at FROM ${MODEL_NAMES.user} ${where} ORDER BY "createdAt" DESC, id DESC LIMIT ? OFFSET ?`,
			[match, match, limit, offset],
		),
		db.get<{ c: number }>(`SELECT count(*) AS c FROM ${MODEL_NAMES.user} ${where}`, [match, match]),
	]);
	return { items, total: count?.c ?? 0 };
}

export async function getAdminUser(id: string) {
	const user = await openDb().get<AdminAccount>(
		`SELECT id, email, name, role, suspended, "createdAt" AS created_at FROM ${MODEL_NAMES.user} WHERE id = ?`,
		[id],
	);
	if (!user) return null;
	/* `sole_owner` is what blocks deletion; the UI names these workspaces and
	 * offers the transfer path instead of a delete it would refuse. */
	const workspaces = await openDb().all<{
		name: string;
		role: "owner" | "member";
		sole_owner: boolean;
	}>(
		`SELECT m.workspace AS name, m.role,
		        (m.role = 'owner' AND NOT EXISTS (
		          SELECT 1 FROM workspace_members o
		          WHERE o.workspace = m.workspace AND o.role = 'owner' AND o.user_id <> m.user_id)) AS sole_owner
		 FROM workspace_members m WHERE m.user_id = ? ORDER BY m.workspace`,
		[id],
	);
	return { ...user, workspaces };
}

export async function listAdminWorkspaces(q: string, limit: number, offset: number) {
	const db = openDb();
	const match = likePattern(q);
	const where = `WHERE lower(name) LIKE ? OR lower(display_name) LIKE ?`;
	const [items, count] = await Promise.all([
		db.all<{
			name: string;
			display_name: string;
			status: string;
			description: string | null;
			created_at: number;
			project_count: number;
		}>(
			`SELECT w.name, w.display_name, w.status, w.description, w.created_at, count(p.id) AS project_count
			 FROM workspaces w LEFT JOIN content_projects p ON p.workspace = w.name
			 ${where} GROUP BY w.name ORDER BY w.name LIMIT ? OFFSET ?`,
			[match, match, limit, offset],
		),
		db.get<{ c: number }>(`SELECT count(*) AS c FROM workspaces ${where}`, [match, match]),
	]);
	return { items, total: count?.c ?? 0 };
}

export async function getAdminWorkspace(name: string) {
	const row = await getWorkspace(name);
	if (!row) return null;
	const members = await listWorkspaceMembers(name);
	const labels = await accountLabels(members.map((m) => m.user_id));
	const counts = await openDb().get<{ project_count: number; last_activity: number | null }>(
		`SELECT count(*) AS project_count, max(updated_at) AS last_activity FROM content_projects WHERE workspace = ?`,
		[name],
	);
	return {
		name: row.name,
		display_name: row.display_name,
		status: row.status,
		description: row.description,
		created_at: row.created_at,
		project_count: counts?.project_count ?? 0,
		last_activity: counts?.last_activity ?? null,
		members: members.map((m) => ({
			...m,
			email: labels.get(m.user_id)?.email ?? null,
			name: labels.get(m.user_id)?.name ?? null,
		})),
		invitations: await listPendingInvitations(name),
	};
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

export async function listAdminProjects(q: string, limit: number, offset: number) {
	const db = openDb();
	const match = likePattern(q);
	const where = `WHERE lower(id) LIKE ? OR lower(title) LIKE ? OR lower(workspace) LIKE ?`;
	const params = [match, match, match];
	const [items, count] = await Promise.all([
		db.all<AdminProject>(
			`SELECT id, workspace, title, type, status, created_at, updated_at FROM content_projects ${where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
			[...params, limit, offset],
		),
		db.get<{ c: number }>(`SELECT count(*) AS c FROM content_projects ${where}`, params),
	]);
	return { items, total: count?.c ?? 0 };
}

export async function getAdminProject(id: string): Promise<AdminProject | null> {
	return await openDb().get<AdminProject>(
		`SELECT id, workspace, title, type, status, created_at, updated_at FROM content_projects WHERE id = ?`,
		[id],
	);
}
