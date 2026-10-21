import { existsSync } from "node:fs";
import { listWorkspaces } from "@maleo/db/workspaces";
import { join } from "node:path";
import { resolveWorkspacesDir } from "./workspace/paths.ts";

// Workspaces live under the centralized repo data root (MALEO_DATA_DIR/workspaces,
// default <repo>/data/workspaces). Resolution is API-owned.
export function workspacesDir(): string {
	const dir = resolveWorkspacesDir();
	if (!existsSync(dir)) {
		throw new Error(`workspaces dir does not exist: ${dir}`);
	}
	return dir;
}

/** Every registered workspace, by name. The registry is the database; a
 *  directory under data/workspaces is not a workspace unless it is registered. */
export async function listWorkspaceNames(): Promise<string[]> {
	return (await listWorkspaces()).map((w) => w.name).sort();
}

export function workspacePath(name: string, ...parts: string[]): string {
	return join(workspacesDir(), name, ...parts);
}

export function activityPath(name: string): string {
	return workspacePath(name, "activity.jsonl");
}

export function workspaceMdPath(name: string): string {
	return workspacePath(name, "workspace.md");
}
