/** One-time reclaim of storyboard history written before retention existed.
 *
 * Dry run by default: reports, per project, the versions and bytes the retention
 * policy would drop, and removes nothing. `--apply` removes them in small
 * transactions, so an interrupted run leaves the database consistent and a re-run
 * finishes the work — the plan is recomputed each time, and dropping versions the
 * policy does not keep never changes which versions it does keep.
 *
 * Deleting rows does not shrink the file. `--vacuum` runs VACUUM afterwards; it
 * needs free disk space about the size of the retained database and holds the
 * write lock throughout, so stop the api and workers first. */
import { sqliteDb } from "../packages/db/src/db/handle";
import { Database } from "bun:sqlite";
import { resolveLegacySqlitePath } from "../packages/db/src/db/legacy-sqlite.ts";
import {
	deleteStoryboardVersions,
	planStoryboardPrune,
	storyboardRetentionPolicy,
} from "../packages/db/src/db/storyboard-retention.ts";

export interface ProjectReclaim {
	readonly projectId: string;
	readonly versions: number;
	readonly prunable: number;
	readonly bytes: number;
}

export interface ReclaimReport {
	readonly apply: boolean;
	readonly window: number;
	readonly projects: ProjectReclaim[];
	readonly prunableRows: number;
	readonly prunableBytes: number;
	readonly deletedRows: number;
}

const DEFAULT_BATCH = 500;

export async function reclaimStoryboardHistory(input: {
	db: Database;
	window: number;
	apply: boolean;
	batchSize?: number;
	/** Called after each committed batch; tests use it to interrupt a run. */
	onBatch?: (deletedSoFar: number) => void;
}): Promise<ReclaimReport> {
	const batchSize = input.batchSize ?? DEFAULT_BATCH;
	const candidates = input.db
		.query<{ project_id: string; n: number }, [number]>(
			`SELECT project_id, COUNT(*) AS n FROM content_storyboards GROUP BY project_id HAVING COUNT(*) > ?`,
		)
		.all(input.window);
	const projects: ProjectReclaim[] = [];
	let deletedRows = 0;
	for (const { project_id: projectId, n } of candidates) {
		const plan = await planStoryboardPrune(sqliteDb(input.db), projectId, input.window);
		if (plan.ids.length === 0) continue;
		projects.push({ projectId, versions: n, prunable: plan.ids.length, bytes: plan.bytes });
		if (!input.apply) continue;
		for (let i = 0; i < plan.ids.length; i += batchSize) {
			const batch = plan.ids.slice(i, i + batchSize);
			deletedRows += await sqliteDb(input.db).transaction((tx) =>
				deleteStoryboardVersions(tx, batch),
			);
			input.onBatch?.(deletedRows);
		}
	}
	projects.sort((a, b) => b.bytes - a.bytes);
	return {
		apply: input.apply,
		window: input.window,
		projects,
		prunableRows: projects.reduce((sum, p) => sum + p.prunable, 0),
		prunableBytes: projects.reduce((sum, p) => sum + p.bytes, 0),
		deletedRows,
	};
}

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

if (import.meta.main) {
	const apply = process.argv.includes("--apply");
	const vacuum = process.argv.includes("--vacuum");
	if (vacuum && !apply) throw new Error("--vacuum only runs with --apply");
	const { window } = storyboardRetentionPolicy();
	if (window === null) throw new Error("storyboard retention is off; nothing to reclaim against");
	const path = resolveLegacySqlitePath();
	const db = apply ? new Database(path) : new Database(path, { readonly: true });
	try {
		const report = await reclaimStoryboardHistory({ db, window, apply });
		for (const p of report.projects) {
			console.log(
				`${p.projectId}  versions ${p.versions}  ${apply ? "dropped" : "would drop"} ${p.prunable}  ${mb(p.bytes)}`,
			);
		}
		console.log(
			`\n${apply ? "Dropped" : "Would drop"} ${report.prunableRows} versions across ${report.projects.length} projects, ${mb(report.prunableBytes)} of document text (window ${window}).`,
		);
		if (!apply)
			console.log(
				"Dry run: nothing removed. Re-run with --apply to remove, --apply --vacuum to also shrink the file.",
			);
		if (vacuum) {
			console.log("VACUUM…");
			db.exec("VACUUM");
			console.log("VACUUM done.");
		}
	} finally {
		db.close();
	}
}
