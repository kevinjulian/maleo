/* `render_comparisons`: one row per shadow job (OpenSpec p2-export E7, E8). */
import crypto from "node:crypto";
import { db } from "./db";
import type { ComparisonRow, ComparisonStatus, Resolution } from "./comparison-window";

db.exec(`
  CREATE TABLE IF NOT EXISTS render_comparisons (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    shadow_job_id TEXT NOT NULL UNIQUE,
    authority TEXT NOT NULL,
    shadow_renderer TEXT NOT NULL,
    config_version INTEGER,
    status TEXT NOT NULL,
    summary TEXT,
    failures TEXT NOT NULL DEFAULT '[]',
    scores TEXT,
    artifacts TEXT,
    cause TEXT,
    resolution TEXT,
    resolution_ref TEXT,
    fix_deployed_at INTEGER,
    explained_by TEXT,
    explained_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_comparisons_created ON render_comparisons(created_at);
`);

export interface Comparison extends ComparisonRow {
	job_id: string;
	shadow_job_id: string;
	authority: string;
	shadow_renderer: string;
	config_version: number | null;
	/** JSON array of failure lines. */
	failures: string;
	/** JSON of the comparison result, without the kept files. */
	scores: string | null;
	artifacts: string | null;
	cause: string | null;
	resolution_ref: string | null;
	explained_by: string | null;
	explained_at: number | null;
}

export function insertComparison(row: {
	jobId: string;
	shadowJobId: string;
	authority: string;
	shadowRenderer: string;
	status: ComparisonStatus;
	configVersion?: number | null;
	failures?: string[];
	scores?: unknown;
	artifacts?: string | null;
	summary?: string | null;
}): Comparison {
	const id = crypto.randomUUID();
	const failures = row.failures ?? [];
	db.run(
		`INSERT INTO render_comparisons
       (id, job_id, shadow_job_id, authority, shadow_renderer, config_version, status, summary, failures, scores, artifacts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			row.jobId,
			row.shadowJobId,
			row.authority,
			row.shadowRenderer,
			row.configVersion ?? null,
			row.status,
			row.summary ?? failures[0] ?? null,
			JSON.stringify(failures),
			row.scores === undefined ? null : JSON.stringify(row.scores),
			row.artifacts ?? null,
			Date.now(),
		],
	);
	return getComparison(id)!;
}

export function getComparison(id: string): Comparison | null {
	return (
		db.query<Comparison, [string]>("SELECT * FROM render_comparisons WHERE id = ?").get(id) ?? null
	);
}

export function listComparisons(): Comparison[] {
	return db.query<Comparison, []>("SELECT * FROM render_comparisons ORDER BY created_at ASC").all();
}

export class ExplainRefused extends Error {}

/** Records why a failed comparison diverged. A `rust-fix` names its commit and deployment. */
export function explainComparison(
	id: string,
	explanation: {
		cause: string;
		resolution: Resolution;
		ref?: string | null;
		deployedAt?: number | null;
		by: string;
	},
): Comparison | null {
	const row = getComparison(id);
	if (!row) return null;
	if (row.status !== "failed")
		throw new ExplainRefused(`comparison ${id} is ${row.status}, not failed`);
	if (explanation.resolution === "rust-fix" && (!explanation.ref || explanation.deployedAt == null))
		throw new ExplainRefused("a rust-fix explanation names its commit and deployment time");
	db.run(
		`UPDATE render_comparisons
       SET cause = ?, resolution = ?, resolution_ref = ?, fix_deployed_at = ?, explained_by = ?, explained_at = ?
     WHERE id = ?`,
		[
			explanation.cause,
			explanation.resolution,
			explanation.ref ?? null,
			explanation.resolution === "rust-fix" ? (explanation.deployedAt ?? null) : null,
			explanation.by,
			Date.now(),
			id,
		],
	);
	return getComparison(id);
}
