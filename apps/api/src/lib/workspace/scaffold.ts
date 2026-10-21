import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "@maleo/db/connection";
import type { Db } from "@maleo/db/handle";
import { getWorkspace, upsertWorkspace } from "@maleo/db/workspaces";
import { writeWorkspaceConfigText } from "../config-yaml.ts";
import { deriveBranding } from "./branding.ts";
import { assertValidWorkspaceName, resolveWorkspacesDir } from "./paths.ts";

export const WORKSPACE_TEMPLATE = (name: string, displayName = name) => `name: ${name}
display_name: ${displayName}
character:
  type: real
voice:
  forbidden_words: []
  punctuation_style: standard
  emoji_usage: moderate
image_generation:
  enabled: false
`;

/* A workspace is its registry row and its configuration row, written in one
 * transaction: a failure in either leaves neither, so there is never a
 * selectable workspace without configuration. The directory beside them holds
 * the workspace's files (collections, uploads) and is created only after the
 * rows commit — an empty directory is harmless, a half-created workspace is not. */
export async function scaffoldWorkspace(
	name: string,
	options: { displayName?: string } = {},
	db: Db = openDb(),
): Promise<string> {
	assertValidWorkspaceName(name);
	const dir = join(resolveWorkspacesDir(), name);
	await db.transaction(async (tx) => {
		if (await getWorkspace(name, tx)) throw new Error(`workspace already exists: ${name}`);
		await upsertWorkspace(
			{
				name,
				display_name: options.displayName ?? name,
				workspace_dir: dir,
				last_synced_at: Date.now(),
				branding: deriveBranding(name),
			},
			tx,
		);
		await writeWorkspaceConfigText(name, WORKSPACE_TEMPLATE(name, options.displayName), tx);
	});
	mkdirSync(dir, { recursive: true });
	return dir;
}
