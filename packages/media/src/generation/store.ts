/* Result store — the durable record of a generation job, polled by the producer.
 * Self-contained SQLite (no dependency on the legacy packages/image queue), so
 * this worker owns its lifecycle end to end. Inngest is the queue; this table is
 * only the result the client polls. */
import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import { ensureParentDir, mediaWorkerDbPath } from "../paths.ts";
import type { StoredMedia } from "@maleo/storage";
import { CAPTION_JOB_LIMITS } from "@maleo/shared";
import {
	ProcessingJobSchema,
	ProcessingRequestSchema,
	ProcessingResultSchema,
	ProcessingStageSchema,
	isCaptionProcessingJob,
	type ProcessingJob,
	type ProcessingRequest,
	type ProcessingResult,
} from "../api/processing.ts";

const DB_PATH = mediaWorkerDbPath();
ensureParentDir(DB_PATH);

export type JobStatus = "queued" | "processing" | "done" | "failed";
export type JobKind = "image" | "tts" | "video";

export interface JobRecord {
	id: string;
	kind: JobKind;
	prompt: string;
	style_json: string | null;
	status: JobStatus;
	output_path: string | null;
	storage_key: string | null;
	storage_hash: string | null;
	storage_size: number | null;
	storage_content_type: string | null;
	poster_storage_key: string | null;
	poster_storage_hash: string | null;
	poster_storage_size: number | null;
	poster_storage_content_type: string | null;
	from_cache: number | null;
	provider_id: string | null;
	provider_source: string | null;
	model: string | null;
	cost: number | null;
	latency_ms: number | null;
	duration_sec: number | null;
	idempotency_key: string | null;
	error: string | null;
	created_at: number;
	started_at: number | null;
	finished_at: number | null;
}

const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec(`
	CREATE TABLE IF NOT EXISTS processing_jobs (
		id TEXT PRIMARY KEY,
		workspace_id TEXT NOT NULL,
		project_id TEXT NOT NULL,
		idempotency_key TEXT NOT NULL,
		request_json TEXT NOT NULL,
		status TEXT NOT NULL,
		result_json TEXT,
		error TEXT,
		created_at INTEGER NOT NULL,
		started_at INTEGER,
		finished_at INTEGER,
		UNIQUE(workspace_id, project_id, idempotency_key)
	);
	CREATE TABLE IF NOT EXISTS jobs (
		id TEXT PRIMARY KEY,
		kind TEXT NOT NULL,
		prompt TEXT NOT NULL,
		style_json TEXT,
		status TEXT NOT NULL,
		output_path TEXT,
		storage_key TEXT,
		storage_hash TEXT,
		storage_size INTEGER,
		storage_content_type TEXT,
		poster_storage_key TEXT,
		poster_storage_hash TEXT,
		poster_storage_size INTEGER,
		poster_storage_content_type TEXT,
		from_cache INTEGER,
		provider_id TEXT,
		provider_source TEXT,
		model TEXT,
		cost REAL,
		latency_ms INTEGER,
		error TEXT,
		created_at INTEGER NOT NULL,
		started_at INTEGER,
		finished_at INTEGER
	);
	CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
`);
for (const statement of [
	"ALTER TABLE jobs ADD COLUMN provider_id TEXT",
	"ALTER TABLE jobs ADD COLUMN provider_source TEXT",
	"ALTER TABLE jobs ADD COLUMN model TEXT",
	"ALTER TABLE jobs ADD COLUMN cost REAL",
	"ALTER TABLE jobs ADD COLUMN latency_ms INTEGER",
	"ALTER TABLE jobs ADD COLUMN storage_key TEXT",
	"ALTER TABLE jobs ADD COLUMN storage_hash TEXT",
	"ALTER TABLE jobs ADD COLUMN storage_size INTEGER",
	"ALTER TABLE jobs ADD COLUMN storage_content_type TEXT",
	"ALTER TABLE jobs ADD COLUMN poster_storage_key TEXT",
	"ALTER TABLE jobs ADD COLUMN poster_storage_hash TEXT",
	"ALTER TABLE jobs ADD COLUMN poster_storage_size INTEGER",
	"ALTER TABLE jobs ADD COLUMN poster_storage_content_type TEXT",
	"ALTER TABLE jobs ADD COLUMN duration_sec REAL",
	"ALTER TABLE jobs ADD COLUMN idempotency_key TEXT",
	"ALTER TABLE processing_jobs ADD COLUMN stage TEXT",
]) {
	try {
		db.exec(statement);
	} catch {
		/* existing column */
	}
}

db.exec(
	"CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL",
);

interface ProcessingRow {
	id: string;
	request_json: string;
	status: string;
	stage: string | null;
	result_json: string | null;
	error: string | null;
	created_at: number;
	started_at: number | null;
	finished_at: number | null;
}

export function getProcessingJob(id: string): ProcessingJob | null {
	const row = db
		.query<ProcessingRow, [string]>("SELECT * FROM processing_jobs WHERE id = ?")
		.get(id);
	if (!row) return null;
	return ProcessingJobSchema.parse({
		id: row.id,
		status: row.status,
		stage: row.stage,
		request: JSON.parse(row.request_json),
		result: row.result_json ? JSON.parse(row.result_json) : null,
		error: row.error,
		createdAt: row.created_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
	});
}

export function createProcessingJob(input: ProcessingRequest): ProcessingJob {
	const request = ProcessingRequestSchema.parse(input);
	const encoded = JSON.stringify(request);
	return db.transaction(() => {
		const existing = db
			.query<ProcessingRow, [string, string, string]>(
				"SELECT * FROM processing_jobs WHERE workspace_id = ? AND project_id = ? AND idempotency_key = ?",
			)
			.get(request.workspaceId, request.projectId, request.idempotencyKey);
		if (existing) {
			if (existing.request_json !== encoded)
				throw new Error("Processing retry does not match original source");
			return getProcessingJob(existing.id)!;
		}
		if ("type" in request) {
			const active = db
				.query<{ count: number }, [string, string]>(
					`SELECT COUNT(*) AS count FROM processing_jobs
				 WHERE workspace_id = ? AND project_id = ? AND status IN ('queued', 'processing')
				 AND json_extract(request_json, '$.type') = 'captions'`,
				)
				.get(request.workspaceId, request.projectId)!.count;
			if (active >= CAPTION_JOB_LIMITS.maxActivePerProject)
				throw new Error("A caption job is already active for this project");
		}
		const id = randomUUID();
		db.prepare(`INSERT INTO processing_jobs
		(id, workspace_id, project_id, idempotency_key, request_json, status, created_at)
		VALUES (?, ?, ?, ?, ?, 'queued', ?)`).run(
			id,
			request.workspaceId,
			request.projectId,
			request.idempotencyKey,
			encoded,
			Date.now(),
		);
		return getProcessingJob(id)!;
	})();
}

export function setProcessingStage(
	id: string,
	stage: NonNullable<ProcessingJob["stage"]>,
): boolean {
	const parsed = ProcessingStageSchema.parse(stage);
	return (
		db
			.prepare("UPDATE processing_jobs SET stage = ? WHERE id = ? AND status = 'processing'")
			.run(parsed, id).changes > 0
	);
}

/** Retry resumes persisted work; it never clears a cancellation or completed result. */
export function startProcessingJob(id: string): boolean {
	return db.transaction(() => {
		const job = getProcessingJob(id);
		if (job && isCaptionProcessingJob(job)) {
			const other = db
				.query<{ id: string }, [string, string, string]>(
					`SELECT id FROM processing_jobs WHERE workspace_id = ? AND project_id = ? AND id != ?
				 AND status IN ('queued', 'processing') AND json_extract(request_json, '$.type') = 'captions' LIMIT 1`,
				)
				.get(job.request.workspaceId, job.request.projectId, id);
			if (other) return false;
		}
		return (
			db
				.prepare(`UPDATE processing_jobs SET status = 'processing', error = NULL, finished_at = NULL, started_at = COALESCE(started_at, ?)
		WHERE id = ? AND status IN ('queued', 'processing', 'failed')`)
				.run(Date.now(), id).changes > 0
		);
	})();
}

export function finishProcessingJob(id: string, result: ProcessingResult): boolean {
	const parsed = ProcessingResultSchema.parse(result);
	const job = getProcessingJob(id);
	if (!job) return false;
	if (isCaptionProcessingJob(job) !== ("type" in parsed && parsed.type === "captions"))
		throw new Error("Processing result does not match request kind");
	const encoded = JSON.stringify(parsed);
	return (
		db
			.prepare(`UPDATE processing_jobs SET status = 'done', stage = 'ready', result_json = ?, error = NULL, finished_at = ?
		WHERE id = ? AND status = 'processing'`)
			.run(encoded, Date.now(), id).changes > 0
	);
}

export function failProcessingJob(id: string, error: string): void {
	db.prepare(`UPDATE processing_jobs SET status = 'failed', error = ?, finished_at = ?
		WHERE id = ? AND status IN ('queued', 'processing')`).run(error.slice(0, 500), Date.now(), id);
}

export function cancelProcessingJob(id: string): boolean {
	// Cancelling a done job drops its result so unadmitted outputs become unreachable for cleanup.
	return (
		db
			.prepare(`UPDATE processing_jobs SET status = 'cancelled', result_json = NULL, finished_at = ?
		WHERE id = ? AND status IN ('queued', 'processing', 'failed', 'done')`)
			.run(Date.now(), id).changes > 0
	);
}

export function createJob(
	kind: JobKind,
	prompt: string,
	styleJson?: string,
	meta: { providerId?: string; providerSource?: string; idempotencyKey?: string } = {},
): JobRecord {
	if (meta.idempotencyKey) {
		const prior = db
			.query<JobRecord, [string]>("SELECT * FROM jobs WHERE idempotency_key = ?")
			.get(meta.idempotencyKey);
		if (prior) {
			if (
				prior.kind !== kind ||
				prior.prompt !== prompt ||
				prior.style_json !== (styleJson ?? null) ||
				prior.provider_id !== (meta.providerId ?? null)
			)
				throw new Error("Video retry does not match original request");
			return prior;
		}
	}
	const id = randomUUID().slice(0, 12);
	db.prepare(
		`INSERT INTO jobs (id, kind, prompt, style_json, status, provider_id, provider_source, idempotency_key, created_at)
		 VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
	).run(
		id,
		kind,
		prompt,
		styleJson ?? null,
		meta.providerId ?? null,
		meta.providerSource ?? null,
		meta.idempotencyKey ?? null,
		Date.now(),
	);
	return getJob(id)!;
}

export function getJob(id: string): JobRecord | null {
	return db.query<JobRecord, [string]>("SELECT * FROM jobs WHERE id = ?").get(id) ?? null;
}

export function markStarted(id: string): void {
	db.prepare("UPDATE jobs SET status = 'processing', started_at = ? WHERE id = ?").run(
		Date.now(),
		id,
	);
}

export function markProviderSelected(id: string, providerId: string, providerSource: string): void {
	db.prepare("UPDATE jobs SET provider_id = ?, provider_source = ? WHERE id = ?").run(
		providerId,
		providerSource,
		id,
	);
}

export function markDone(
	id: string,
	outputPath: string,
	fromCache = false,
	meta: {
		providerId?: string;
		providerSource?: string;
		model?: string;
		cost?: number;
		latencyMs?: number;
		durationSec?: number;
		stored?: StoredMedia;
		poster?: StoredMedia;
	} = {},
): void {
	db.prepare(
		"UPDATE jobs SET status = 'done', output_path = ?, storage_key = ?, storage_hash = ?, storage_size = ?, storage_content_type = ?, poster_storage_key = ?, poster_storage_hash = ?, poster_storage_size = ?, poster_storage_content_type = ?, from_cache = ?, provider_id = COALESCE(?, provider_id), provider_source = COALESCE(?, provider_source), model = ?, cost = ?, latency_ms = ?, duration_sec = ?, finished_at = ? WHERE id = ?",
	).run(
		outputPath,
		meta.stored?.key ?? null,
		meta.stored?.hash ?? null,
		meta.stored?.size ?? null,
		meta.stored?.contentType ?? null,
		meta.poster?.key ?? null,
		meta.poster?.hash ?? null,
		meta.poster?.size ?? null,
		meta.poster?.contentType ?? null,
		fromCache ? 1 : 0,
		meta.providerId ?? null,
		meta.providerSource ?? null,
		meta.model ?? null,
		meta.cost ?? null,
		meta.latencyMs ?? null,
		meta.durationSec ?? null,
		Date.now(),
		id,
	);
}

export function markFailed(id: string, error: string): void {
	db.prepare("UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(
		error.slice(0, 500),
		Date.now(),
		id,
	);
}

export interface ProviderMetric {
	provider_id: string;
	attempts: number;
	successes: number;
	usable_rate_pct: number;
	cache_rate_pct: number;
	avg_latency_ms: number | null;
	avg_cost: number | null;
}

export function listProviderMetrics(): ProviderMetric[] {
	const rows = db
		.query<
			{
				provider_id: string;
				attempts: number;
				successes: number;
				cache_rate: number | null;
				avg_latency_ms: number | null;
				avg_cost: number | null;
			},
			[]
		>(`
		SELECT provider_id,
		       COUNT(*) AS attempts,
		       SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS successes,
		       AVG(CASE WHEN status = 'done' THEN COALESCE(from_cache, 0) END) AS cache_rate,
		       AVG(latency_ms) AS avg_latency_ms,
		       AVG(cost) AS avg_cost
		FROM jobs
		WHERE provider_id IS NOT NULL
		GROUP BY provider_id
		ORDER BY successes DESC, provider_id ASC
	`)
		.all();
	return rows.map((row) => ({
		provider_id: row.provider_id,
		attempts: row.attempts,
		successes: row.successes,
		usable_rate_pct: row.attempts ? Math.round((row.successes / row.attempts) * 1000) / 10 : 0,
		cache_rate_pct: Math.round((row.cache_rate ?? 0) * 1000) / 10,
		avg_latency_ms: row.avg_latency_ms == null ? null : Math.round(row.avg_latency_ms),
		avg_cost: row.avg_cost == null ? null : Math.round(row.avg_cost * 10000) / 10000,
	}));
}
