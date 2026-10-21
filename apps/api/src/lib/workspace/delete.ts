/* Deleting a workspace: its rows, then its files, in that order.
 *
 * THE ORDER IS THE POINT, and it is not a preference.
 *
 * Files first would mean a transaction that rolls back after the media is gone
 * — leaving a workspace whose rows are intact and whose every screen renders
 * broken. Every query would call it healthy. Rows first means the worst a crash
 * can do is leave files on disk that nothing references any more: invisible,
 * recoverable by a later sweep, and harmless in the meantime.
 *
 * So: collect the references, commit the row deletion, and only then unlink.
 * There is no step that can reorder these without the comment above it
 * becoming false.
 */
import { rmSync } from "node:fs";
import { openDb } from "@maleo/db/connection";
import { serialize } from "@maleo/db/handle";
import { getWorkspace } from "@maleo/db/workspaces";
import {
	collectWorkspaceFileRefs,
	deleteWorkspaceRows,
	listInFlightRuns,
} from "@maleo/db/workspace-delete";
import { resolveUploadFilePath } from "../upload-files.ts";
import { cancelAgentRun } from "../../modules/agents/core/service.ts";

/** Deleting would leave the deployment with no workspace at all. */
export class FinalWorkspaceError extends Error {
	constructor() {
		super("final_workspace");
	}
}

export interface WorkspaceDeletionReport {
	workspace: string;
	/** Runs cancelled before the rows went, so none wakes up to missing data. */
	runsCancelled: number;
	/** Files removed from disk after the rows were committed. */
	filesRemoved: number;
	/** The workspace's own directory, if it had one on disk. */
	directoryRemoved: boolean;
}

/* A stored reference resolved to a path we are willing to delete, or null.
 *
 * `resolveUploadFilePath` is the same function the upload route uses, and it
 * refuses anything with a path separator or a `..` in it. That refusal is what
 * makes this safe: a row whose `src` is "../../etc/passwd" resolves to null
 * here rather than to a file, so a poisoned column cannot turn a workspace
 * deletion into an arbitrary unlink.
 *
 * A reference to somebody else's server — a stock image URL, a provider's CDN —
 * resolves to null too, because it does not start with `/uploads/`. Those are
 * not ours to delete and never were. */
function deletableUpload(ref: string): string | null {
	try {
		// A stored value may be absolute ("http://host/uploads/x.png") or relative
		// ("/uploads/x.png"). Only the path matters.
		const pathname = ref.startsWith("http") ? new URL(ref).pathname : ref;
		return resolveUploadFilePath(pathname);
	} catch {
		return null;
	}
}

/**
 * Remove a workspace and everything it owns.
 *
 * Returns what was removed. A workspace that does not exist deletes nothing and
 * is not an error — the caller asked for it to be gone, and it is.
 */
export async function deleteWorkspace(workspace: string): Promise<WorkspaceDeletionReport> {
	const row = await getWorkspace(workspace);

	/* Stop the runs FIRST. A run still executing on the durable host would keep
	 * calling tools against a workspace that is going away; stopping it on the
	 * product record makes every further effect refuse (modules/agents/core/service.ts).
	 *
	 * A failure to stop one does NOT stop the deletion: the operator asked for
	 * this workspace to be gone. Its execution state is pruned by the sweep. */
	const inFlight = row ? await listInFlightRuns(workspace) : [];
	for (const run of inFlight) {
		try {
			await cancelAgentRun(run.runId);
		} catch {
			/* See above: best effort, never a blocker. */
		}
	}

	// Read the file references while the rows that hold them still exist. After
	// the transaction below there is nothing left to ask.
	const refs = row ? await collectWorkspaceFileRefs(workspace) : [];
	const uploads = [...new Set(refs.map(deletableUpload).filter((p): p is string => p !== null))];

	/* Commit point. Everything after this is cleanup of things nothing
	 * references any more.
	 *
	 * Serialised across every deletion path: two concurrent deletions of the
	 * last two workspaces would each see another one left and together leave
	 * none. Under the lock, the second one sees the truth and is refused. */
	await openDb().transaction(async (tx) => {
		await serialize(tx, "workspace-deletion");
		const remaining = await tx.get<{ c: number }>(
			`SELECT count(*) AS c FROM workspaces WHERE name <> ?`,
			[workspace],
		);
		if (row && (remaining?.c ?? 0) < 1) throw new FinalWorkspaceError();
		await deleteWorkspaceRows(workspace, tx);
	});

	let filesRemoved = 0;
	for (const path of uploads) {
		try {
			rmSync(path, { force: true });
			filesRemoved += 1;
		} catch {
			/* A file we cannot remove is an orphan, not a failure. The rows that
			   named it are already gone, so reporting this as an error would make a
			   completed deletion look like it had not happened. */
		}
	}

	let directoryRemoved = false;
	if (row?.workspace_dir) {
		try {
			rmSync(row.workspace_dir, { recursive: true, force: true });
			directoryRemoved = true;
		} catch {
			/* Same reasoning as above. */
		}
	}

	return { workspace, runsCancelled: inFlight.length, filesRemoved, directoryRemoved };
}
