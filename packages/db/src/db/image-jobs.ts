/* Image generation jobs — the producer-side record a client polls.
 *
 * Was `packages/api/src/lib/image-jobs.ts`, writing SQL through a pass-through
 * that handed back the shared connection and ignored its workspace argument. */
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";

/* Re-tracking a job id starts it over. This was INSERT OR REPLACE, which deletes
 * the old row and inserts a fresh one — so every column the insert does not name
 * returns to its default, and the upsert says so column by column. */
export async function trackJob(
	workspace: string,
	jobId: string,
	prompt: string,
	db: Db = openDb(),
): Promise<void> {
	await db.run(
		`INSERT INTO image_jobs (workspace, job_id, prompt, status, created_at)
	   VALUES (?, ?, ?, 'pending', ?)
	   ON CONFLICT(job_id) DO UPDATE SET
	     workspace = excluded.workspace, prompt = excluded.prompt, status = 'pending',
	     image_url = NULL, created_at = excluded.created_at, completed_at = NULL`,
		[workspace, jobId, prompt, Date.now()],
	);
}

export async function markJobDone(
	workspace: string,
	jobId: string,
	imageUrl: string,
	db: Db = openDb(),
): Promise<void> {
	await db.run(
		`UPDATE image_jobs SET status = 'done', image_url = ?, completed_at = ? WHERE workspace = ? AND job_id = ?`,
		[imageUrl, Date.now(), workspace, jobId],
	);
}

export async function markJobFailed(
	workspace: string,
	jobId: string,
	db: Db = openDb(),
): Promise<void> {
	await db.run(
		`UPDATE image_jobs SET status = 'failed', completed_at = ? WHERE workspace = ? AND job_id = ?`,
		[Date.now(), workspace, jobId],
	);
}

export interface ImageJob {
	job_id: string;
	workspace: string;
	prompt: string;
	status: string;
	image_url: string | null;
	created_at: number;
	completed_at: number | null;
}

export function getJob(
	workspace: string,
	jobId: string,
	db: Db = openDb(),
): Promise<ImageJob | null> {
	return db.get<ImageJob>(
		`SELECT job_id, workspace, prompt, status, image_url, created_at, completed_at
	   FROM image_jobs WHERE workspace = ? AND job_id = ?`,
		[workspace, jobId],
	);
}

export function listActiveJobs(workspace: string, db: Db = openDb()): Promise<ImageJob[]> {
	return db.all<ImageJob>(
		`SELECT job_id, workspace, prompt, status, image_url, created_at, completed_at
	   FROM image_jobs WHERE workspace = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 50`,
		[workspace],
	);
}

export async function pruneOldJobs(
	workspace: string,
	maxAgeDays = 7,
	db: Db = openDb(),
): Promise<void> {
	const cutoff = Date.now() - maxAgeDays * 86_400_000;
	await db.run(
		`DELETE FROM image_jobs WHERE workspace = ? AND completed_at IS NOT NULL AND completed_at < ?`,
		[workspace, cutoff],
	);
}
