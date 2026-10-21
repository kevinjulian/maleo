import { getWorkspace, listWorkspaces } from "@maleo/db/workspaces";
import { pruneMembershipsOutsideRegistry } from "@maleo/db/workspace-members";
import { DEFAULT_CONTENT_WORKSPACE } from "@maleo/db/schema";
import { scaffoldWorkspace } from "./scaffold.ts";

/* `default` owns every content project written before tenancy was read — 18,159
 * of them — and had no registry row, so the tenant holding all of the data was
 * the one tenant that could not be selected. It is created like any other
 * workspace, by the ordinary path, so it is not a special case anywhere else.
 * Nothing is rewritten: the tenant the projects already name becomes reachable. */
export async function ensureDefaultWorkspace(): Promise<void> {
	if (await getWorkspace(DEFAULT_CONTENT_WORKSPACE)) return;
	try {
		await scaffoldWorkspace(DEFAULT_CONTENT_WORKSPACE, { displayName: "Default" });
	} catch (error) {
		// Another process created it between the check and the write.
		if (!(error instanceof Error && error.message.includes("already exists"))) throw error;
	}
}

/* The registry is the `workspaces` table itself; there is no directory to scan.
 * What remains is housekeeping: membership rows naming a workspace that is no
 * longer registered are unreachable, and are removed rather than accumulated. */
export async function syncWorkspaceRegistry(): Promise<string[]> {
	await pruneMembershipsOutsideRegistry();
	return (await listWorkspaces()).map((w) => w.name);
}
