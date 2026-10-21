/* Workspaces — the tenant registry. `workspaces.name` IS the tenant key every
 * other family scopes by. */
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";

export interface WorkspaceRow {
	name: string;
	display_name: string;
	status: "active" | "paused" | "archived";
	workspace_dir: string;
	created_at: number;
	updated_at: number;
	last_synced_at: number | null;
	// Visual identity (source of truth for dashboard theming). Nullable on
	// rows written before branding migration; callers derive a fallback.
	color: string | null;
	color_bright: string | null;
	color_deep: string | null;
	tagline: string | null;
	initials: string | null;
	/* Prose the owner wrote. Null until someone writes it, and never derived —
	 * see the column comment in unified-schema.ts for why this is not tagline. */
	description: string | null;
}

export async function upsertWorkspace(
	input: {
		name: string;
		display_name?: string;
		status?: WorkspaceRow["status"];
		workspace_dir: string;
		last_synced_at?: number | null;
		branding?: {
			color?: string | null;
			color_bright?: string | null;
			color_deep?: string | null;
			tagline?: string | null;
			initials?: string | null;
		} | null;
	},
	db: Db = openDb(),
): Promise<WorkspaceRow> {
	const now = Date.now();
	const b = input.branding ?? null;
	await db.run(
		`INSERT INTO workspaces
		 (name, display_name, status, workspace_dir, created_at, updated_at, last_synced_at,
		  color, color_bright, color_deep, tagline, initials)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(name) DO UPDATE SET
		 	display_name = excluded.display_name,
		 	status = excluded.status,
		 	workspace_dir = excluded.workspace_dir,
		 	updated_at = excluded.updated_at,
		 	last_synced_at = excluded.last_synced_at,
		 	color = COALESCE(excluded.color, workspaces.color),
		 	color_bright = COALESCE(excluded.color_bright, workspaces.color_bright),
		 	color_deep = COALESCE(excluded.color_deep, workspaces.color_deep),
		 	tagline = COALESCE(excluded.tagline, workspaces.tagline),
		 	initials = COALESCE(excluded.initials, workspaces.initials)`,
		[
			input.name,
			input.display_name ?? input.name,
			input.status ?? "active",
			input.workspace_dir,
			now,
			now,
			input.last_synced_at ?? null,
			b?.color ?? null,
			b?.color_bright ?? null,
			b?.color_deep ?? null,
			b?.tagline ?? null,
			b?.initials ?? null,
		],
	);
	return (await getWorkspace(input.name, db))!;
}

export async function getWorkspace(name: string, db: Db = openDb()): Promise<WorkspaceRow | null> {
	return (
		(await db.get<WorkspaceRow>(
			`SELECT name, display_name, status, workspace_dir, created_at, updated_at, last_synced_at,
		        color, color_bright, color_deep, tagline, initials, description
		 FROM workspaces
		 WHERE name = ?`,
			[name],
		)) ?? null
	);
}

export async function listWorkspaces(db: Db = openDb()): Promise<WorkspaceRow[]> {
	return await db.all<WorkspaceRow>(`SELECT name, display_name, status, workspace_dir, created_at, updated_at, last_synced_at,
		        color, color_bright, color_deep, tagline, initials, description
		 FROM workspaces
		 ORDER BY name ASC`);
}

/* Edit what an operator controls: the display name and the description.
 *
 * Deliberately NOT upsertWorkspace. That one is the registry sync's entry
 * point -- it takes a directory, a config path and derived branding, and it
 * runs on every boot. An owner renaming their workspace supplies two fields and
 * must not have to restate the rest, and a sync must never overwrite a
 * description because it did not know one existed.
 *
 * `name` is the partition key and is not editable here. Changing it would mean
 * rewriting every row in nineteen tables plus everything reachable through
 * them; renaming is a display concern and stops at display_name. */
export async function updateWorkspace(
	name: string,
	patch: { display_name?: string; description?: string | null },
	db: Db = openDb(),
): Promise<WorkspaceRow | null> {
	const existing = await getWorkspace(name, db);
	if (!existing) return null;
	// COALESCE on the bound value, not on the column: an omitted field keeps
	// what is stored, while an explicit null clears the description.
	await db.run(
		`UPDATE workspaces
		 SET display_name = ?, description = ?, updated_at = ?
		 WHERE name = ?`,
		[
			patch.display_name?.trim() || existing.display_name,
			patch.description === undefined ? existing.description : patch.description?.trim() || null,
			Date.now(),
			name,
		],
	);
	return getWorkspace(name, db);
}
