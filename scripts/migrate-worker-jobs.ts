/** One-time worker result cutover. Stop worker writers and back up its SQLite DB
 * before --apply. Old cache bytes remain for rollback until the operator moves them. */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { resolveLegacySqlitePath } from "../packages/db/src/db/legacy-sqlite.ts";
import { mediaWorkerCacheDir, mediaWorkerDbPath } from "../packages/media/src/paths.ts";
import { mediaStorageMode, putMedia } from "../packages/storage/src/storage.ts";

type LegacyJob = { id: string; kind: string; output_path: string };
type Plan = { job: LegacyJob; workspace: string | null; reason: "unowned" | "missing" | null };

export async function migrateWorkerJobs(input: {
	main: Database;
	worker: Database;
	cacheDir: string;
	apply: boolean;
}): Promise<{
	migrateable: number;
	retiredUnowned: number;
	retiredMissing: number;
	migrated: number;
	retired: number;
}> {
	const plan: Plan[] = [];
	const cacheDir = resolve(input.cacheDir);
	for (const job of input.worker
		.query<LegacyJob, []>(
			"SELECT id, kind, output_path FROM jobs WHERE status = 'done' AND output_path IS NOT NULL AND storage_key IS NULL ORDER BY id",
		)
		.iterate()) {
		const owners = new Set<string>();
		for (const row of input.main
			.query<{ workspace: string }, [string]>("SELECT workspace FROM image_ledger WHERE job_id = ?")
			.all(job.id))
			owners.add(row.workspace);
		for (const row of input.main
			.query<{ workspace: string }, [string]>("SELECT workspace FROM image_jobs WHERE job_id = ?")
			.all(job.id))
			owners.add(row.workspace);
		if (owners.size > 1) throw new Error(`conflicting workspace owners for worker job ${job.id}`);
		const workspace = owners.values().next().value ?? null;
		if (workspace && job.kind !== "image")
			throw new Error(`unexpected owned worker job kind: ${job.id}`);
		const path = resolve(job.output_path);
		const rel = relative(cacheDir, path);
		if (workspace && (rel === ".." || rel.startsWith("../") || isAbsolute(rel)))
			throw new Error(`worker output outside cache: ${job.id}`);
		const reason = !workspace ? "unowned" : !existsSync(path) ? "missing" : null;
		if (!reason && ![".jpg", ".jpeg", ".png"].includes(extname(path).toLowerCase()))
			throw new Error(`unsupported legacy image type: ${job.id}`);
		plan.push({ job, workspace, reason });
	}
	const report = {
		migrateable: plan.filter((row) => !row.reason).length,
		retiredUnowned: plan.filter((row) => row.reason === "unowned").length,
		retiredMissing: plan.filter((row) => row.reason === "missing").length,
		migrated: 0,
		retired: 0,
	};
	if (!input.apply) return report;
	for (const { job, workspace, reason } of plan) {
		if (reason) continue;
		const file = Bun.file(job.output_path);
		if (!(await file.exists())) throw new Error(`legacy worker output vanished: ${job.id}`);
		const contentType =
			extname(job.output_path).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
		const stored = await putMedia({
			workspace: workspace!,
			kind: "image",
			body: file,
			contentType,
			filename: basename(job.output_path),
		});
		const updated = input.worker.run(
			"UPDATE jobs SET output_path = NULL, storage_key = ?, storage_hash = ?, storage_size = ?, storage_content_type = ? WHERE id = ? AND status = 'done' AND storage_key IS NULL",
			[stored.key, stored.hash, stored.size, stored.contentType, job.id],
		);
		if (updated.changes !== 1) throw new Error(`worker job changed during cutover: ${job.id}`);
		report.migrated++;
	}
	for (const { job, reason } of plan) {
		if (!reason) continue;
		const error =
			reason === "unowned"
				? "Legacy result retired: no trusted workspace owner."
				: "Legacy result missing before object-storage cutover.";
		const updated = input.worker.run(
			"UPDATE jobs SET status = 'failed', output_path = NULL, error = ? WHERE id = ? AND status = 'done' AND storage_key IS NULL",
			[error, job.id],
		);
		if (updated.changes !== 1) throw new Error(`worker job changed during cutover: ${job.id}`);
		report.retired++;
	}
	return report;
}

if (import.meta.main) {
	const apply = process.argv.includes("--apply");
	if (apply && mediaStorageMode() !== "s3") throw new Error("worker cutover requires S3 storage");
	const main = new Database(resolveLegacySqlitePath(), { readonly: true });
	const worker = apply
		? new Database(mediaWorkerDbPath())
		: new Database(mediaWorkerDbPath(), { readonly: true });
	try {
		console.log(
			JSON.stringify(
				await migrateWorkerJobs({ main, worker, cacheDir: mediaWorkerCacheDir(), apply }),
			),
		);
	} finally {
		main.close();
		worker.close();
	}
}
