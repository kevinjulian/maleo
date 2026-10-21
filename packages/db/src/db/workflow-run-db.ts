/* WP3 DB-first run model — low-level table access for the durable agent run
 * store. workflow_run is the source of truth for a run (snapshot_json carries the
 * full serialized job for full-fidelity rehydration on any instance); step_run,
 * tool_run, run_artifact, and required_action give durable per-step / per-tool
 * records (WP5). Mirrors the maleo-db.ts row-map conventions: typed *Row
 * interfaces + map*Row helpers that parse JSON columns. The dashboard's
 * agent/run-repository.ts maps between these rows and the AgentJob domain type. */
import { randomUUID } from "node:crypto";
import { openDb } from "./connection.ts";
import { serialize, type Db } from "./handle.ts";
import { readBack } from "./row-json.ts";

function parseJson<T>(raw: string | null, fallback: T): T {
	if (raw === null) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

export type WorkflowRunStatus = "running" | "done" | "needs_attention" | "error" | "awaiting_input";

/** The fields readers name on a run's stored snapshot.
 *
 *  Deliberately NOT the whole `AgentJob` this column holds. That interface is
 *  fifty-odd fields of nested arrays, `workflow_run` holds four rows, and a
 *  schema that large verified against that little is a parse backed by nothing.
 *  What is declared here is what consumers actually read by name; the run
 *  reconstruction that needs the rest owns its own claim, at `jobFromRow`. */
export interface WorkflowRunSnapshot {
	id?: string;
	projectId?: string;
	outcomeContract?: unknown;
	outcomeEvaluation?: unknown;
	/* Everything else the writer stored. Not decoration: `workflow-run-db.bun.test.ts`
	 * asserts that an arbitrary snapshot round-trips key for key, which is the
	 * column's actual contract. Declaring only the named fields would make the
	 * type disagree with the test and with the data. */
	[key: string]: unknown;
}

export interface WorkflowRunRow {
	id: string;
	project_id: string;
	workspace_id: string | null;
	content_type: string;
	status: string;
	cursor: number;
	instruction: string;
	snapshot: WorkflowRunSnapshot | null;
	created_at: number;
	updated_at: number;
}

export interface StepRunRow {
	id: string;
	workflow_run_id: string;
	idx: number;
	tool_name: string;
	status: string;
	attempt: number;
	input: unknown;
	output: unknown;
	error_code: string | null;
	error_message: string | null;
	retry_at: number | null;
	created_at: number;
	updated_at: number;
}

export interface ToolRunRow {
	id: string;
	step_run_id: string | null;
	workflow_run_id: string;
	tool_name: string;
	status: string;
	input: unknown;
	output: unknown;
	error: unknown;
	cost: number | null;
	idempotency_key: string | null;
	artifacts: unknown;
	latency_ms: number | null;
	created_at: number;
	updated_at: number;
}

export interface RunArtifactRow {
	id: string;
	project_id: string;
	tool_run_id: string | null;
	logical_ref: string | null;
	parent_artifact_id: string | null;
	kind: string;
	status: string;
	storage_key: string | null;
	public_url: string | null;
	metadata: Record<string, unknown> | null;
	version: number;
	active: number;
	created_at: number;
}

export interface RequiredActionRow {
	id: string;
	workflow_run_id: string;
	type: string;
	step: number | null;
	status: string;
	payload: Record<string, unknown> | null;
	created_at: number;
	resolved_at: number | null;
}

type WorkflowRunDbRow = Omit<WorkflowRunRow, "snapshot"> & { snapshot_json: string | null };
type StepRunDbRow = Omit<StepRunRow, "input" | "output"> & {
	input_json: string | null;
	output_json: string | null;
};
type ToolRunDbRow = Omit<ToolRunRow, "input" | "output" | "error" | "artifacts"> & {
	input_json: string | null;
	output_json: string | null;
	error_json: string | null;
	artifacts_json: string | null;
};
type RunArtifactDbRow = Omit<RunArtifactRow, "metadata"> & { metadata_json: string | null };
type RequiredActionDbRow = Omit<RequiredActionRow, "payload"> & { payload_json: string | null };

function mapWorkflowRun(row: WorkflowRunDbRow): WorkflowRunRow {
	const { snapshot_json, ...rest } = row;
	return { ...rest, snapshot: parseJson<WorkflowRunSnapshot | null>(snapshot_json, null) };
}

function mapStepRun(row: StepRunDbRow): StepRunRow {
	const { input_json, output_json, ...rest } = row;
	return {
		...rest,
		input: parseJson<unknown>(input_json, null),
		output: parseJson<unknown>(output_json, null),
	};
}

function mapToolRun(row: ToolRunDbRow): ToolRunRow {
	const { input_json, output_json, error_json, artifacts_json, ...rest } = row;
	return {
		...rest,
		input: parseJson<unknown>(input_json, null),
		output: parseJson<unknown>(output_json, null),
		error: parseJson<unknown>(error_json, null),
		artifacts: parseJson<unknown>(artifacts_json, null),
	};
}

function mapRunArtifact(row: RunArtifactDbRow): RunArtifactRow {
	const { metadata_json, ...rest } = row;
	return { ...rest, metadata: parseJson<Record<string, unknown> | null>(metadata_json, null) };
}

function mapRequiredAction(row: RequiredActionDbRow): RequiredActionRow {
	const { payload_json, ...rest } = row;
	return { ...rest, payload: parseJson<Record<string, unknown> | null>(payload_json, null) };
}

// ---- workflow_run ---------------------------------------------------------

export interface UpsertWorkflowRunInput {
	id: string;
	project_id: string;
	workspace_id?: string | null;
	content_type: string;
	status: WorkflowRunStatus;
	cursor?: number;
	instruction?: string;
	/** Serialized as-is. Declared `unknown` rather than a dictionary because this
	 *  is the WRITE side of a JSON column: it is stringified, never read here, so
	 *  asking callers for an index signature only made them cast a domain object
	 *  into one on the way past. */
	snapshot?: unknown;
	created_at?: number;
}

// Idempotent upsert: insert on first write, overwrite mutable fields (status,
// cursor, snapshot) on later writes for the same run id. created_at is preserved.
export async function upsertWorkflowRun(input: UpsertWorkflowRunInput): Promise<WorkflowRunRow> {
	const db = openDb();
	const now = Date.now();
	const createdAt = input.created_at ?? now;
	const snapshotJson =
		input.snapshot === undefined || input.snapshot === null ? null : JSON.stringify(input.snapshot);
	await db.run(
		`INSERT INTO workflow_run
		   (id, project_id, workspace_id, content_type, status, cursor, instruction, snapshot_json, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   status = excluded.status,
		   cursor = excluded.cursor,
		   instruction = excluded.instruction,
		   snapshot_json = excluded.snapshot_json,
		   workspace_id = excluded.workspace_id,
		   updated_at = excluded.updated_at`,
		[
			input.id,
			input.project_id,
			input.workspace_id ?? null,
			input.content_type,
			input.status,
			input.cursor ?? 0,
			input.instruction ?? "",
			snapshotJson,
			createdAt,
			now,
		],
	);
	const saved = await db.get<WorkflowRunDbRow>(`SELECT * FROM workflow_run WHERE id = ?`, [
		input.id,
	]);
	return mapWorkflowRun(readBack(saved, "workflow_run"));
}

export async function getWorkflowRun(id: string): Promise<WorkflowRunRow | null> {
	const db = openDb();
	const row = await db.get<WorkflowRunDbRow>(`SELECT * FROM workflow_run WHERE id = ?`, [id]);
	return row ? mapWorkflowRun(row) : null;
}

// Latest still-active (running or awaiting_input) run for a project — the DB-first
// analogue of session-store's getLatestActiveJobForProject.
export async function getLatestActiveWorkflowRun(
	projectId: string,
): Promise<WorkflowRunRow | null> {
	const db = openDb();
	const row = await db.get<WorkflowRunDbRow>(
		`SELECT * FROM workflow_run
		 WHERE project_id = ? AND status IN ('running', 'awaiting_input')
		 ORDER BY updated_at DESC LIMIT 1`,
		[projectId],
	);
	return row ? mapWorkflowRun(row) : null;
}

export async function getLatestRunningWorkflowRun(
	projectId: string,
): Promise<WorkflowRunRow | null> {
	const db = openDb();
	const row = await db.get<WorkflowRunDbRow>(
		`SELECT * FROM workflow_run
		 WHERE project_id = ? AND status = 'running'
		 ORDER BY updated_at DESC LIMIT 1`,
		[projectId],
	);
	return row ? mapWorkflowRun(row) : null;
}

/** Runs that have waited on the user since before `cutoff` (ms) — ids only. */
export async function listWorkflowRunIdsAwaitingSince(cutoff: number): Promise<string[]> {
	const rows = await openDb().all<{ id: string }>(
		`SELECT id FROM workflow_run
		 WHERE status = 'awaiting_input' AND updated_at < ?
		 ORDER BY updated_at ASC`,
		[cutoff],
	);
	return rows.map((r) => r.id);
}

/** Every run id a project owns — ids only, so no snapshot is read. */
export async function listWorkflowRunIds(projectId: string): Promise<string[]> {
	const rows = await openDb().all<{ id: string }>(
		`SELECT id FROM workflow_run WHERE project_id = ?`,
		[projectId],
	);
	return rows.map((r) => r.id);
}

export async function listWorkflowRunsForProject(
	projectId: string,
	limit = 50,
): Promise<WorkflowRunRow[]> {
	const db = openDb();
	const rows = await db.all<WorkflowRunDbRow>(
		`SELECT * FROM workflow_run WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?`,
		[projectId, limit],
	);
	return rows.map(mapWorkflowRun);
}

// ---- step_run -------------------------------------------------------------

export interface UpsertStepRunInput {
	id?: string;
	workflow_run_id: string;
	idx: number;
	tool_name: string;
	status: string;
	attempt?: number;
	input?: unknown;
	output?: unknown;
	error_code?: string | null;
	error_message?: string | null;
	retry_at?: number | null;
}

export async function insertStepRun(input: UpsertStepRunInput): Promise<StepRunRow> {
	const db = openDb();
	const now = Date.now();
	const id = input.id ?? randomUUID();
	await db.run(
		`INSERT INTO step_run
		   (id, workflow_run_id, idx, tool_name, status, attempt, input_json, output_json, error_code, error_message, retry_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			input.workflow_run_id,
			input.idx,
			input.tool_name,
			input.status,
			input.attempt ?? 0,
			input.input === undefined ? null : JSON.stringify(input.input),
			input.output === undefined ? null : JSON.stringify(input.output),
			input.error_code ?? null,
			input.error_message ?? null,
			input.retry_at ?? null,
			now,
			now,
		],
	);
	const saved = await db.get<StepRunDbRow>(`SELECT * FROM step_run WHERE id = ?`, [id]);
	return mapStepRun(readBack(saved, "step_run"));
}

export async function listStepRuns(workflowRunId: string): Promise<StepRunRow[]> {
	const db = openDb();
	const rows = await db.all<StepRunDbRow>(
		`SELECT * FROM step_run WHERE workflow_run_id = ? ORDER BY idx ASC`,
		[workflowRunId],
	);
	return rows.map(mapStepRun);
}

// ---- tool_run -------------------------------------------------------------

export interface InsertToolRunInput {
	id?: string;
	step_run_id?: string | null;
	workflow_run_id: string;
	tool_name: string;
	status: string;
	input?: unknown;
	output?: unknown;
	error?: unknown;
	cost?: number | null;
	idempotency_key?: string | null;
	artifacts?: unknown;
	latency_ms?: number | null;
}

export async function insertToolRun(input: InsertToolRunInput): Promise<ToolRunRow> {
	const db = openDb();
	const now = Date.now();
	const id = input.id ?? randomUUID();
	await db.run(
		`INSERT INTO tool_run
		   (id, step_run_id, workflow_run_id, tool_name, status, input_json, output_json, error_json, cost, idempotency_key, artifacts_json, latency_ms, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			input.step_run_id ?? null,
			input.workflow_run_id,
			input.tool_name,
			input.status,
			input.input === undefined ? null : JSON.stringify(input.input),
			input.output === undefined ? null : JSON.stringify(input.output),
			input.error === undefined ? null : JSON.stringify(input.error),
			input.cost ?? null,
			input.idempotency_key ?? null,
			input.artifacts === undefined ? null : JSON.stringify(input.artifacts),
			input.latency_ms ?? null,
			now,
			now,
		],
	);
	const saved = await db.get<ToolRunDbRow>(`SELECT * FROM tool_run WHERE id = ?`, [id]);
	return mapToolRun(readBack(saved, "tool_run"));
}

export interface UpdateToolRunInput {
	status: string;
	output?: unknown;
	error?: unknown;
	artifacts?: unknown;
	latency_ms?: number | null;
}

export async function updateToolRun(id: string, input: UpdateToolRunInput): Promise<ToolRunRow> {
	const db = openDb();
	await db.run(
		`UPDATE tool_run SET status = ?, output_json = ?, error_json = ?, artifacts_json = ?, latency_ms = ?, updated_at = ? WHERE id = ?`,
		[
			input.status,
			input.output === undefined ? null : JSON.stringify(input.output),
			input.error === undefined ? null : JSON.stringify(input.error),
			input.artifacts === undefined ? null : JSON.stringify(input.artifacts),
			input.latency_ms ?? null,
			Date.now(),
			id,
		],
	);
	const saved = await db.get<ToolRunDbRow>(`SELECT * FROM tool_run WHERE id = ?`, [id]);
	if (!saved) throw new Error(`tool_run ${id} not found`);
	return mapToolRun(saved);
}

// Idempotency short-circuit (WP5): return a prior completed tool_run for this key
// so an expensive tool is safe to re-invoke under retry.
export async function getToolRunByIdempotencyKey(key: string): Promise<ToolRunRow | null> {
	const db = openDb();
	const row = await db.get<ToolRunDbRow>(`SELECT * FROM tool_run WHERE idempotency_key = ?`, [key]);
	return row ? mapToolRun(row) : null;
}

export async function listToolRuns(workflowRunId: string): Promise<ToolRunRow[]> {
	const db = openDb();
	const rows = await db.all<ToolRunDbRow>(
		`SELECT * FROM tool_run WHERE workflow_run_id = ? ORDER BY created_at ASC`,
		[workflowRunId],
	);
	return rows.map(mapToolRun);
}

// ---- run_artifact ---------------------------------------------------------

export interface InsertRunArtifactInput {
	id?: string;
	project_id: string;
	tool_run_id?: string | null;
	logical_ref?: string | null;
	parent_artifact_id?: string | null;
	kind: string;
	status?: string;
	storage_key?: string | null;
	public_url?: string | null;
	metadata?: Record<string, unknown> | null;
	version?: number;
	active?: boolean;
}

export async function insertRunArtifact(
	input: InsertRunArtifactInput,
	db: Db = openDb(),
): Promise<RunArtifactRow> {
	const now = Date.now();
	const id = input.id ?? randomUUID();
	await db.run(
		`INSERT INTO run_artifact
		   (id, project_id, tool_run_id, logical_ref, parent_artifact_id, kind, status, storage_key, public_url, metadata_json, version, active, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			input.project_id,
			input.tool_run_id ?? null,
			input.logical_ref ?? null,
			input.parent_artifact_id ?? null,
			input.kind,
			input.status ?? "ready",
			input.storage_key ?? null,
			input.public_url ?? null,
			input.metadata === undefined || input.metadata === null
				? null
				: JSON.stringify(input.metadata),
			input.version ?? 1,
			input.active === false ? 0 : 1,
			now,
		],
	);
	const saved = await db.get<RunArtifactDbRow>(`SELECT * FROM run_artifact WHERE id = ?`, [id]);
	return mapRunArtifact(readBack(saved, "run_artifact"));
}

export async function insertVersionedRunArtifact(
	input: Omit<InsertRunArtifactInput, "version" | "parent_artifact_id" | "active"> & {
		logical_ref: string;
	},
): Promise<RunArtifactRow> {
	return await openDb().transaction(async (tx) => {
		// Two writers must not both read the same active version.
		await serialize(tx, `run-artifact:${input.project_id}:${input.logical_ref}`);
		const previous = await tx.get<RunArtifactDbRow>(
			`SELECT * FROM run_artifact WHERE project_id = ? AND logical_ref = ? AND active = 1 ORDER BY version DESC LIMIT 1`,
			[input.project_id, input.logical_ref],
		);
		if (previous) await tx.run(`UPDATE run_artifact SET active = 0 WHERE id = ?`, [previous.id]);
		return insertRunArtifact(
			{
				...input,
				parent_artifact_id: previous?.id ?? null,
				version: (previous?.version ?? 0) + 1,
				active: true,
			},
			tx,
		);
	});
}

export async function listRunArtifacts(projectId: string, limit = 100): Promise<RunArtifactRow[]> {
	const db = openDb();
	const rows = await db.all<RunArtifactDbRow>(
		`SELECT * FROM run_artifact WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
		[projectId, limit],
	);
	return rows.map(mapRunArtifact);
}

// ---- required_action ------------------------------------------------------

export interface InsertRequiredActionInput {
	id?: string;
	workflow_run_id: string;
	type: string;
	step?: number | null;
	status?: string;
	payload?: Record<string, unknown> | null;
}

export async function insertRequiredAction(
	input: InsertRequiredActionInput,
): Promise<RequiredActionRow> {
	const db = openDb();
	const now = Date.now();
	const id = input.id ?? randomUUID();
	await db.run(
		`INSERT INTO required_action
		   (id, workflow_run_id, type, step, status, payload_json, created_at, resolved_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			input.workflow_run_id,
			input.type,
			input.step ?? null,
			input.status ?? "pending",
			input.payload === undefined || input.payload === null ? null : JSON.stringify(input.payload),
			now,
			null,
		],
	);
	const saved = await db.get<RequiredActionDbRow>(`SELECT * FROM required_action WHERE id = ?`, [
		id,
	]);
	return mapRequiredAction(readBack(saved, "required_action"));
}

export async function resolveRequiredAction(id: string): Promise<void> {
	const db = openDb();
	await db.run(`UPDATE required_action SET status = 'resolved', resolved_at = ? WHERE id = ?`, [
		Date.now(),
		id,
	]);
}

export async function listPendingRequiredActions(
	workflowRunId: string,
): Promise<RequiredActionRow[]> {
	const db = openDb();
	const rows = await db.all<RequiredActionDbRow>(
		`SELECT * FROM required_action WHERE workflow_run_id = ? AND status = 'pending' ORDER BY created_at ASC`,
		[workflowRunId],
	);
	return rows.map(mapRequiredAction);
}

// Test-only: wipe all run tables (mirrors clearAgentJobsForTests for the DB path).
export async function clearWorkflowRunsForTests(): Promise<void> {
	const db = openDb();
	await db.run(`DELETE FROM required_action`);
	await db.run(`DELETE FROM run_artifact`);
	await db.run(`DELETE FROM tool_run`);
	await db.run(`DELETE FROM step_run`);
	await db.run(`DELETE FROM workflow_run`);
}
