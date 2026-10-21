/* Workspace configuration — the document each workspace is configured by.
 *
 * Stored as the YAML text an operator edits (see 0002_workspace_config.sql for
 * why text and not re-serialised JSON). This module stores and returns it;
 * validating it against the workspace schema is the API's job, before it calls
 * `putWorkspaceConfigText`, because the schema lives with the code that reads
 * the configuration. */
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";

export async function getWorkspaceConfigText(
	workspace: string,
	db: Db = openDb(),
): Promise<string | null> {
	const row = await db.get<{ config_yaml: string }>(
		"SELECT config_yaml FROM workspace_config WHERE workspace = ?",
		[workspace],
	);
	return row?.config_yaml ?? null;
}

export async function putWorkspaceConfigText(
	workspace: string,
	text: string,
	db: Db = openDb(),
): Promise<void> {
	await db.run(
		`INSERT INTO workspace_config (workspace, config_yaml, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(workspace) DO UPDATE SET config_yaml = excluded.config_yaml, updated_at = excluded.updated_at`,
		[workspace, text, Date.now()],
	);
}
