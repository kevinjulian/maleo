import { Database } from "bun:sqlite";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const DB_PATH = process.env.MALEO_VIDEO_DB ?? path.resolve("data/jobs.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");

// Canonical render_jobs shape. Beyond the original lifecycle columns this now
// carries operational metadata so jobs are retryable, leasable by concurrent
// workers, dedupable, traceable back to a draft, and surface a phase + final
// artifact (path/url/duration/thumbnail/manifest) as a first-class result.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS render_jobs (
    id TEXT PRIMARY KEY,
    product_json TEXT NOT NULL,
    preset TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    phase TEXT NOT NULL DEFAULT 'queued',
    phase_detail TEXT,
    output_path TEXT,
    output_url TEXT,
    thumbnail_path TEXT,
    manifest_path TEXT,
    image_status TEXT,
    duration_sec REAL,
    error TEXT,
    error_code TEXT,
    cost_usd REAL,
    progress REAL NOT NULL DEFAULT 0,
    backend TEXT NOT NULL DEFAULT 'local',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    retry_images INTEGER NOT NULL DEFAULT 0,
    worker_id TEXT,
    leased_at INTEGER,
    input_hash TEXT,
    draft_id TEXT,
    workspace TEXT,
    project_id TEXT,
    output_storage TEXT,
    manifest_storage TEXT,
    thumbnail_storage TEXT,
    preset_source TEXT,
    renderer TEXT NOT NULL DEFAULT 'remotion',
    renderer_note TEXT,
    shadow_of TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON render_jobs(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_jobs_input_hash ON render_jobs(input_hash, created_at);
`;

db.exec(SCHEMA);
reconcileColumns(db);
// Rows from before the renderer column were all Remotion renders (p2-export 3.4).
db.exec("UPDATE render_jobs SET renderer = 'remotion' WHERE renderer IS NULL");

// CREATE TABLE IF NOT EXISTS never adds columns to a pre-existing table, so an
// older jobs.db is missing every column added above. Diff against the canonical
// shape (built in a scratch in-memory DB) and ALTER-add what's missing — added
// nullable since existing rows can't satisfy NOT NULL without a default.
function reconcileColumns(database: Database): void {
	const scratch = new Database(":memory:");
	try {
		scratch.exec(SCHEMA);
		const cols = (t: string) =>
			database.query<{ name: string; type: string }, []>(`PRAGMA table_info(${t})`).all();
		const existing = new Set(cols("render_jobs").map((c) => c.name));
		if (existing.size === 0) return;
		for (const col of scratch
			.query<{ name: string; type: string }, []>(`PRAGMA table_info(render_jobs)`)
			.all()) {
			if (existing.has(col.name)) continue;
			const type = col.type?.trim() || "TEXT";
			try {
				database.exec(`ALTER TABLE render_jobs ADD COLUMN ${col.name} ${type}`);
			} catch {
				/* raced in or unaddable — skip */
			}
		}
	} finally {
		scratch.close();
	}
}

// Lifecycle status. `done_with_fallback` = rendered but degraded (e.g. silent
// because TTS was unreachable); `cancelled` = operator-cancelled.
export type JobStatus =
	| "queued"
	| "running"
	| "done"
	| "done_with_fallback"
	| "error"
	| "cancelled";

// Pipeline phase within a running job — lets operators see where a job is (and
// where it died) instead of an opaque "running"/"error".
export type JobPhase =
	| "queued"
	| "validating"
	| "preparing_images"
	| "synthesizing_audio"
	| "bundling"
	| "rendering"
	| "finalizing"
	| "done"
	| "failed";

export type Job = {
	id: string;
	product_json: string;
	preset: string;
	status: JobStatus;
	phase: JobPhase;
	phase_detail: string | null;
	output_path: string | null;
	output_url: string | null;
	thumbnail_path: string | null;
	manifest_path: string | null;
	// JSON array of { label, status } for pending image generation — drives the
	// per-scene pill strip in the dashboard. Null until/unless images are generated.
	image_status: string | null;
	duration_sec: number | null;
	error: string | null;
	// Machine-readable failure classification (see lib/error-codes.ts). Null
	// unless status is 'error'. Drives the dashboard's retry affordance + copy.
	error_code: string | null;
	cost_usd: number | null;
	progress: number;
	backend: "local" | "lambda";
	attempts: number;
	max_attempts: number;
	// 1 when the next run should re-attempt cached placeholder images (set by a
	// "Retry images" re-render, cleared by the worker after prep).
	retry_images: number;
	worker_id: string | null;
	leased_at: number | null;
	input_hash: string | null;
	draft_id: string | null;
	workspace: string | null;
	project_id: string | null;
	output_storage: string | null;
	manifest_storage: string | null;
	thumbnail_storage: string | null;
	preset_source: string | null;
	/** The renderer that produced (or is producing) the output (p2-export E6). */
	renderer: "remotion" | "rust";
	/** Why a job did not take the authoritative renderer, e.g. its coverage reason. */
	renderer_note: string | null;
	/** Set on a shadow comparison render: the authoritative job it shadows (task 4.1). */
	shadow_of: string | null;
	created_at: number;
	started_at: number | null;
	finished_at: number | null;
};

export function insertJob(j: {
	id: string;
	productJson: string;
	preset: string;
	backend: "local" | "lambda";
	inputHash?: string | null;
	draftId?: string | null;
	workspace?: string | null;
	projectId?: string | null;
	presetSource?: string | null;
	maxAttempts?: number;
}): Job {
	const now = Date.now();
	db.run(
		`INSERT INTO render_jobs
       (id, product_json, preset, backend, input_hash, draft_id, workspace, project_id, preset_source, max_attempts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			j.id,
			j.productJson,
			j.preset,
			j.backend,
			j.inputHash ?? null,
			j.draftId ?? null,
			j.workspace ?? null,
			j.projectId ?? null,
			j.presetSource ?? null,
			j.maxAttempts ?? 3,
			now,
		],
	);
	return getJob(j.id)!;
}

export function getJob(id: string): Job | null {
	return db.query<Job, [string]>(`SELECT * FROM render_jobs WHERE id = ?`).get(id) ?? null;
}

/** A job an operator can see: shadow comparison renders read as missing. */
export function getVisibleJob(id: string): Job | null {
	const job = getJob(id);
	return job && job.shadow_of == null ? job : null;
}

/** Queues a shadow render of a finished authoritative job on the other renderer
 * (p2-export E6). `productJson` is the prepared input, so preparation does not
 * run again. One attempt: a failed shadow is a comparison result, not a retry. */
export function insertShadowJob(of: Job, renderer: Job["renderer"], productJson: string): Job {
	const id = crypto.randomUUID();
	db.run(
		`INSERT INTO render_jobs
       (id, product_json, preset, backend, workspace, project_id, renderer, shadow_of, max_attempts, created_at)
     VALUES (?, ?, ?, 'local', ?, ?, ?, ?, 1, ?)`,
		[id, productJson, of.preset, of.workspace, of.project_id, renderer, of.id, Date.now()],
	);
	return getJob(id)!;
}

export interface JobFilters {
	workspace?: string;
	projectIds?: string[];
	legacyJobIds?: string[];
	statuses?: JobStatus[];
}

function jobWhere(filters: JobFilters) {
	// Shadow comparison renders are never operator-facing (p2-export E6).
	const clauses: string[] = ["shadow_of IS NULL"];
	const values: string[] = [];
	const projects = JSON.stringify(filters.projectIds ?? []);
	const legacy = JSON.stringify(filters.legacyJobIds ?? []);
	if (filters.workspace != null) {
		clauses.push(
			"(workspace = ? OR (workspace IS NULL AND (project_id IN (SELECT value FROM json_each(?)) OR id IN (SELECT value FROM json_each(?)))))",
		);
		values.push(filters.workspace, projects, legacy);
	}
	if (filters.projectIds != null) {
		clauses.push(
			"(project_id IN (SELECT value FROM json_each(?)) OR (workspace IS NULL AND id IN (SELECT value FROM json_each(?))))",
		);
		values.push(projects, legacy);
	}
	if (filters.statuses != null) {
		clauses.push("status IN (SELECT value FROM json_each(?))");
		values.push(JSON.stringify(filters.statuses));
	}
	return { sql: ` WHERE ${clauses.join(" AND ")}`, values };
}

export function listJobs(limit = 50, offset = 0, filters: JobFilters = {}): Job[] {
	const where = jobWhere(filters);
	return db
		.query<Job, (string | number)[]>(
			`SELECT * FROM render_jobs${where.sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
		)
		.all(...where.values, limit, offset);
}

export function countJobs(filters: JobFilters = {}): number {
	const where = jobWhere(filters);
	// COUNT(*) with no GROUP BY returns exactly one row; `?? 0` states what the
	// assertion used to claim.
	return (
		db
			.query<{ c: number }, string[]>(`SELECT COUNT(*) AS c FROM render_jobs${where.sql}`)
			.get(...where.values)?.c ?? 0
	);
}

// Dedupe window: a job with the same input_hash + preset submitted within
// `windowMs` and not in a terminal-failed state is considered a duplicate.
export function findRecentByHash(inputHash: string, preset: string, windowMs: number): Job | null {
	const since = Date.now() - windowMs;
	return (
		db
			.query<Job, [string, string, number]>(
				`SELECT * FROM render_jobs
         WHERE input_hash = ? AND preset = ? AND created_at >= ?
           AND status IN ('queued','running','done','done_with_fallback')
         ORDER BY created_at DESC LIMIT 1`,
			)
			.get(inputHash, preset, since) ?? null
	);
}

// Atomically lease the oldest queued job to a worker. A shadow job leases only
// when no authoritative job is queued (p2-export E6). Uses a guarded UPDATE so
// two concurrent workers never grab the same row (the WHERE status='queued'
// fails for the loser). Returns the leased job or null.
export function leaseNext(workerId: string): Job | null {
	const tx = db.transaction((): Job | null => {
		const candidate = db
			.query<{ id: string }, []>(
				`SELECT id FROM render_jobs WHERE status = 'queued'
         ORDER BY (shadow_of IS NOT NULL) ASC, created_at ASC LIMIT 1`,
			)
			.get();
		if (!candidate) return null;
		const now = Date.now();
		const res = db.run(
			`UPDATE render_jobs
         SET status = 'running', phase = 'validating', worker_id = ?, leased_at = ?,
             started_at = COALESCE(started_at, ?), attempts = attempts + 1
       WHERE id = ? AND status = 'queued'`,
			[workerId, now, now, candidate.id],
		);
		if (res.changes === 0) return null; // lost the race
		return getJob(candidate.id);
	});
	return tx();
}

export function updateJob(id: string, patch: Partial<Job>): void {
	// SAFETY: `patch` is a `Partial<Job>` built by this package's own callers, so
	// its keys are `Job` columns and the SQL below is safe to build from them.
	// `Object.keys` returns `string[]` because a runtime object may carry keys its
	// type never declared. `@maleo/shared` has `keysOf` for exactly this, but this
	// package cannot import it (see `src/exports.ts`), so the claim is stated here.
	const keys = Object.keys(patch) as (keyof Job)[];
	if (keys.length === 0) return;
	const set = keys.map((k) => `${k} = ?`).join(", ");
	const values = keys.map((k) => patch[k] ?? null);
	db.run(`UPDATE render_jobs SET ${set} WHERE id = ?`, [...values, id]);
}

// Every phase or progress report renews a running job's lease, so `reclaimStale`
// takes only a job whose worker stopped reporting, not a long render.
export function setPhase(id: string, phase: JobPhase, detail?: string): void {
	db.run(
		`UPDATE render_jobs SET phase = ?, phase_detail = ?,
       leased_at = CASE WHEN status = 'running' THEN ? ELSE leased_at END
     WHERE id = ?`,
		[phase, detail ?? null, Date.now(), id],
	);
}

// Re-queue a job for retry: only if it has attempts left and isn't terminal-ok.
// Clears the lease so a worker can pick it up again. Returns the job or null if
// not retryable.
export function requeueJob(id: string, opts?: { force?: boolean }): Job | null {
	const job = getJob(id);
	if (!job) return null;
	if (job.status === "running") return null; // in flight — don't yank it
	if (!opts?.force && job.attempts >= job.max_attempts) return null;
	db.run(
		`UPDATE render_jobs
       SET status = 'queued', phase = 'queued', phase_detail = NULL, error = NULL,
           error_code = NULL, progress = 0, worker_id = NULL, leased_at = NULL,
           finished_at = NULL,
           max_attempts = CASE WHEN ? THEN attempts + 3 ELSE max_attempts END
     WHERE id = ?`,
		[opts?.force ? 1 : 0, id],
	);
	return getJob(id);
}

export function cancelJob(id: string): Job | null {
	const job = getJob(id);
	if (!job) return null;
	if (job.status === "done" || job.status === "done_with_fallback") return job; // already terminal-ok
	// Record the cause so the UI shows "cancelled", not a generic "Render failed".
	db.run(
		`UPDATE render_jobs
       SET status = 'cancelled', phase = 'failed', error = 'Render cancelled',
           error_code = 'CANCELLED', phase_detail = NULL, finished_at = ?
     WHERE id = ? AND status IN ('queued','running')`,
		[Date.now(), id],
	);
	return getJob(id);
}

// Reclaim jobs whose worker died mid-flight: status 'running' but lease older
// than `staleMs`. Re-queued if attempts remain, else marked error. Run on boot
// and periodically so a crashed worker doesn't strand jobs forever.
export function reclaimStale(staleMs: number): number {
	const cutoff = Date.now() - staleMs;
	const stale = db
		.query<Job, [number]>(
			`SELECT * FROM render_jobs WHERE status = 'running' AND leased_at IS NOT NULL AND leased_at < ?`,
		)
		.all(cutoff);
	for (const job of stale) {
		if (job.attempts < job.max_attempts) {
			db.run(
				`UPDATE render_jobs
           SET status = 'queued', phase = 'queued', phase_detail = NULL, error = NULL,
               error_code = NULL, progress = 0, worker_id = NULL, leased_at = NULL,
               finished_at = NULL
         WHERE id = ?`,
				[job.id],
			);
		} else {
			updateJob(job.id, {
				status: "error",
				phase: "failed",
				error: "worker lease expired (presumed crashed)",
				error_code: "WORKER_CRASHED",
				finished_at: Date.now(),
			});
		}
	}
	return stale.length;
}

// Retention: keep the most recent `keep` jobs, delete older terminal rows so the
// table doesn't grow unbounded. Never deletes active (queued/running) jobs.
export function pruneJobs(keep: number): number {
	const res = db.run(
		`DELETE FROM render_jobs
     WHERE status NOT IN ('queued','running')
       AND id NOT IN (
         SELECT id FROM render_jobs ORDER BY created_at DESC LIMIT ?
       )`,
		[keep],
	);
	return Number(res.changes);
}

export function jobOwners(filters: JobFilters) {
	const where = jobWhere(filters);
	const projects = db
		.query<{ project_id: string | null }, string[]>(
			`SELECT DISTINCT project_id FROM render_jobs${where.sql}`,
		)
		.all(...where.values);
	const legacy = db
		.query<{ id: string }, string[]>(
			`SELECT id FROM render_jobs${where.sql} AND project_id IS NULL`,
		)
		.all(...where.values);
	return {
		project_ids: projects.flatMap((r) => (r.project_id ? [r.project_id] : [])),
		legacy_job_ids: legacy.map((r) => r.id),
	};
}
