/* WP3 run repository — DB-first bridge between the in-memory AgentJob and the
 * durable workflow_run table. Runs are always durable (single flow): saveRun
 * snapshots the whole job (job is plain serializable data) into
 * workflow_run.snapshot_json so a run rehydrates with full fidelity on ANY
 * instance — running, awaiting_input, done, or error. session-store consults
 * these getters on a cache miss; loadRun rebuilds the AgentJob and the caller
 * re-seeds the JOBS cache. Workflow and provider-effect writes fail closed: a
 * run must never claim progress that exists only in one process's memory. */
import { textOf } from "@maleo/shared";
import { settleJobArtifacts } from "./artifact-store.ts";
import type { AgentJob } from "./model.ts";
import type { ToolResult, ToolReplay } from "./types.ts";
import {
	upsertWorkflowRun,
	getWorkflowRun,
	getLatestActiveWorkflowRun,
	getLatestRunningWorkflowRun,
	insertToolRun,
	updateToolRun,
	insertStepRun,
	insertRunArtifact,
	insertVersionedRunArtifact,
	insertRequiredAction,
	listPendingRequiredActions,
	resolveRequiredAction,
	getToolRunByIdempotencyKey,
	type WorkflowRunRow,
	type ToolRunRow,
} from "@maleo/db/workflow-run-db";

// A durable-write failure must never break the run loop, but it must not be
// silent either — a swallowed error means the run quietly degraded to
// memory-only, which undermines the DB-as-source-of-truth guarantee. Log it so
// the failure is observable (and alertable in prod) without throwing.
function warnPersistFailure(op: string, runId: string, err: unknown): void {
	console.warn(
		`[run-repository] ${op} failed for run ${runId} — run degraded to memory-only: ${err instanceof Error ? err.message : String(err)}`,
	);
}

// Persist the full job as the durable source of truth. Callers must surface a DB
// failure instead of continuing with memory-only progress.
export async function saveRun(job: AgentJob): Promise<void> {
	await upsertWorkflowRun({
		id: job.id,
		project_id: job.projectId,
		content_type: job.contentType,
		status: job.status,
		cursor: job.run?.step ?? 0,
		instruction: job.run?.instruction ?? "",
		snapshot: job,
		created_at: job.startedAt,
	});
}

// A run whose workflow_run row hasn't advanced (updated_at bumped on every
// persist() — i.e. every tool) within this window is treated as orphaned: the
// process or the Inngest server restarted and nothing is driving it anymore. The
// window is generous — longer than the slowest single tool (a BrowserOS
// generate can take minutes) so a slow-but-alive run is never falsely reaped.
const STALE_RUN_MS = 15 * 60_000;

// Reap an orphaned run so the UI never spins forever. If the job is still
// "running" but its DB row is stale, flip it to error (interrupted) and persist,
// mutating the passed job in place. The full snapshot stays in workflow_run, so
// Resume can start it again on the agent runtime. Returns true
// when it reaped. No-op for terminal, actively-progressing, or locally-live runs.
// `liveInProcess` (JOBS.has) must be false to reap: a run being driven in THIS
// process is alive even if its row is momentarily stale (a long single tool goes
// minutes between persists), so we must never reap it.
export async function reapIfStale(job: AgentJob, liveInProcess: boolean): Promise<boolean> {
	if (job.status !== "running" || liveInProcess) return false;
	try {
		const row = await getWorkflowRun(job.id);
		if (!row || Date.now() - row.updated_at < STALE_RUN_MS) return false;
	} catch {
		return false;
	}
	job.status = "error";
	job.error = "Run interrupted — the server or Inngest restarted mid-run. Retry to continue.";
	await saveRun(job);
	return true;
}

// Mark a run terminally abandoned (waitForEvent timeout) — flip a non-terminal
// run to error so it stops dangling in "running"/"awaiting_input". Loads the
// snapshot so the full job is preserved (a later manual resume is still possible).
export async function markRunAbandoned(runId: string, reason: string): Promise<void> {
	try {
		const job = await loadRun(runId);
		if (!job || job.status === "done" || job.status === "needs_attention" || job.status === "error")
			return;
		job.status = "error";
		job.error = `Run abandoned — ${reason}. Retry to continue.`;
		// The run is gone; what it was producing is the project's latest state.
		settleJobArtifacts(job);
		await saveRun(job);
	} catch (err) {
		warnPersistFailure("markRunAbandoned", runId, err);
	}
}

// The stored snapshot IS a serialized AgentJob (we control the shape on write), so
// reconstruction is a validated cast rather than the field-by-field rebuild the
// event-log path needs. Returns undefined when the row is missing or malformed.
function jobFromRow(row: WorkflowRunRow | null): AgentJob | undefined {
	if (!row || !row.snapshot) return undefined;
	const snap = row.snapshot;
	if (typeof snap.id !== "string" || typeof snap.projectId !== "string") return undefined;
	return snap as unknown as AgentJob;
}

/* Does this run belong to this project?
 *
 * Used to check the provenance a memory entry claims. An entry citing a run from
 * another project is dropped rather than trusted — otherwise one project's
 * conversation could be replayed as context for another's. An unknown run id
 * answers false, which is the safe direction: unverifiable provenance is not
 * provenance. */
export async function runBelongsToProject(runId: string, projectId: string): Promise<boolean> {
	try {
		return (await getWorkflowRun(runId))?.project_id === projectId;
	} catch {
		return false;
	}
}

export async function loadRun(runId: string): Promise<AgentJob | undefined> {
	try {
		return jobFromRow(await getWorkflowRun(runId));
	} catch {
		return undefined;
	}
}

export async function loadLatestActiveRun(projectId: string): Promise<AgentJob | undefined> {
	try {
		return jobFromRow(await getLatestActiveWorkflowRun(projectId));
	} catch {
		return undefined;
	}
}

export async function loadLatestRunningRun(projectId: string): Promise<AgentJob | undefined> {
	try {
		return jobFromRow(await getLatestRunningWorkflowRun(projectId));
	} catch {
		return undefined;
	}
}

// Cap a stored JSON blob so a tool_run row never balloons (large prompts / data
// urls). Over the limit we store a marker instead of the full value.
function capBlob(value: unknown): unknown {
	if (value === undefined) return undefined;
	try {
		const json = JSON.stringify(value);
		if (json.length > 8_192) return { truncated: true, bytes: json.length };
		return value;
	} catch {
		return { unserializable: true };
	}
}

// Stable per-call fingerprint: <runId>:step:<idx>:tool:<name>:<argsHash>. Stamped
// on every tool_run for observability and as the dedupe handle a future
// replayable-output path (return the stored asset instead of re-billing a
// provider) will key on. Cheap FNV-1a hash over the canonical args JSON.
export function toolIdempotencyKey(
	runId: string,
	stepIndex: number,
	tool: string,
	args: Record<string, unknown>,
	phase?: string,
): string {
	let argsJson = "";
	try {
		argsJson = JSON.stringify(args);
	} catch {
		argsJson = String(Date.now());
	}
	const base = `${runId}:step:${stepIndex}:tool:${tool}:${fnv1a(argsJson)}`;
	/* A two-phase tool runs twice at the SAME step with the SAME args — that is
	 * what makes it one call — so without the phase both attempts hash to one key
	 * and the second is rejected as an uncertain duplicate of the first. The suffix
	 * is appended only when a phase exists, so every existing key, including those
	 * already written for in-flight runs, is byte-identical to what it was. */
	return phase ? `${base}:phase:${phase}` : base;
}

function fnv1a(s: string): string {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(36);
}

// Replayable-output dedupe: if this exact (run, step, tool, args) already
// completed with a replayable result, return it so the executor re-applies the
// stored mutation (set the frame/slide image) instead of calling the provider.
// Returns null → the executor runs the tool normally. Only a completed row that
// carries a `replay` qualifies; a note-only or truncated output falls through.
export async function lookupToolReplay(
	runId: string,
	stepIndex: number,
	tool: string,
	args: Record<string, unknown>,
): Promise<ToolResult | null> {
	try {
		const key = toolIdempotencyKey(runId, stepIndex, tool, args);
		const prior = await getToolRunByIdempotencyKey(key);
		if (!prior || prior.status !== "completed") return null;
		const out = prior.output as { note?: string; thumbs?: string[]; replay?: ToolReplay } | null;
		if (!out || !out.replay || typeof out.replay.kind !== "string") return null;
		return { note: out.note ?? "", thumbs: out.thumbs, replay: out.replay };
	} catch {
		return null;
	}
}

export interface BegunToolRun {
	row: ToolRunRow;
	created: boolean;
}

// Write-ahead intent record. This must succeed before a handler can invoke an
// external provider. An existing non-completed row means the previous attempt's
// outcome is uncertain, so the executor stops instead of risking double billing —
// unless the tool is reentrant (it reuses its finished work by input hash).
export async function beginToolRun(input: {
	runId: string;
	tool: string;
	args: Record<string, unknown>;
	stepIndex: number;
	phase?: string;
}): Promise<BegunToolRun> {
	const idempotencyKey = toolIdempotencyKey(
		input.runId,
		input.stepIndex,
		input.tool,
		input.args,
		input.phase,
	);
	try {
		return {
			row: await insertToolRun({
				workflow_run_id: input.runId,
				tool_name: input.tool,
				status: "planned",
				input: capBlob(input.args),
				idempotency_key: idempotencyKey,
			}),
			created: true,
		};
	} catch (error) {
		const existing = await getToolRunByIdempotencyKey(idempotencyKey);
		if (existing) return { row: existing, created: false };
		throw error;
	}
}

export async function markToolRunRunning(rowId: string): Promise<ToolRunRow> {
	return await updateToolRun(rowId, { status: "running" });
}

function artifactLogicalRef(result: ToolResult, _index: number): string | null {
	if (result.replay?.kind === "scene_frame") return `scene:${result.replay.index}:visual`;
	return null;
}

async function persistToolArtifacts(
	projectId: string,
	toolRunId: string,
	result: ToolResult,
): Promise<void> {
	if (result.artifacts?.length) {
		for (const artifact of result.artifacts) {
			await insertVersionedRunArtifact({
				project_id: projectId,
				tool_run_id: toolRunId,
				logical_ref: artifact.logicalRef,
				kind: artifact.kind,
				public_url: artifact.url,
				metadata: artifact.metadata,
			});
		}
		return;
	}
	for (const [index, url] of (result.thumbs ?? []).entries()) {
		const logicalRef = artifactLogicalRef(result, index);
		if (logicalRef) {
			await insertVersionedRunArtifact({
				project_id: projectId,
				tool_run_id: toolRunId,
				logical_ref: logicalRef,
				kind: "image",
				public_url: url,
			});
		} else {
			await insertRunArtifact({
				project_id: projectId,
				tool_run_id: toolRunId,
				kind: "image",
				public_url: url,
			});
		}
	}
}

export async function completeToolRun(input: {
	rowId: string;
	projectId: string;
	startedAt: number;
	result: ToolResult;
}): Promise<ToolRunRow> {
	// Artifact lineage is part of the effect commit. Persist it before marking the
	// tool completed so a failed artifact write cannot leave a replayable success
	// whose output is permanently detached from its durable artifact.
	await persistToolArtifacts(input.projectId, input.rowId, input.result);
	return await updateToolRun(input.rowId, {
		status: "completed",
		output: capBlob(input.result),
		artifacts: input.result.artifacts?.length
			? input.result.artifacts
			: input.result.thumbs?.length
				? input.result.thumbs
				: undefined,
		latency_ms: Date.now() - input.startedAt,
	});
}

export async function failToolRun(input: {
	rowId: string;
	startedAt: number;
	error: unknown;
}): Promise<ToolRunRow> {
	return await updateToolRun(input.rowId, {
		status: "failed",
		error: { message: input.error instanceof Error ? input.error.message : String(input.error) },
		latency_ms: Date.now() - input.startedAt,
	});
}

// WP5: write a durable tool_run record for one tool call (input/output/error/
// latency/idempotencyKey) plus a run_artifact row per media output (thumbs),
// linked to the tool_run. Best-effort — recording must never break the tool. The
// full ToolResult (including any `replay`) is stored in output, so
// lookupToolReplay can re-apply a generate mutation on retry without re-billing.
export async function recordToolRun(input: {
	runId: string;
	projectId: string;
	tool: string;
	args: Record<string, unknown>;
	startedAt: number;
	stepIndex?: number;
	result?: ToolResult;
	error?: unknown;
}): Promise<void> {
	try {
		const idempotencyKey =
			input.stepIndex === undefined
				? null
				: toolIdempotencyKey(input.runId, input.stepIndex, input.tool, input.args);
		const row = await insertToolRun({
			workflow_run_id: input.runId,
			tool_name: input.tool,
			status: input.error ? "failed" : "completed",
			input: capBlob(input.args),
			output: input.error ? undefined : capBlob(input.result),
			error: input.error
				? {
						message:
							input.error instanceof Error
								? input.error.message
								: textOf(input.error, JSON.stringify(input.error)),
					}
				: undefined,
			artifacts: input.result?.thumbs?.length ? input.result.thumbs : undefined,
			latency_ms: Date.now() - input.startedAt,
			idempotency_key: idempotencyKey,
		});
		// First-class artifact rows: each media thumb becomes a queryable run_artifact
		// linked to this tool_run (WP5 step 4).
		if (!input.error && input.result?.thumbs?.length)
			await persistToolArtifacts(input.projectId, row.id, input.result);
	} catch (err) {
		warnPersistFailure("recordToolRun", input.runId, err);
	}
}

// WP3: a durable human-action prompt. When a run suspends (ask_user / approval)
// we record a required_action row so the pending prompt is first-class and
// queryable, not only implicit in the snapshot. Returns the row id (the caller
// stores it on job.pendingActionId so the resume wait can match runId + actionId).
export async function recordRequiredAction(
	job: AgentJob,
	type: "ask_user" | "approve" | "edit_prompt",
): Promise<string | undefined> {
	try {
		const row = await insertRequiredAction({
			workflow_run_id: job.id,
			type,
			step: job.run?.step ?? null,
			// The batch rides the existing JSON payload — one question batch in one
			// required_action row, so a parked clarification is queryable and restorable
			// without a new table or a migration.
			payload: job.pendingQuestion
				? {
						question: job.pendingQuestion.question,
						options: job.pendingQuestion.options ?? null,
						batch: job.pendingQuestion.batch ?? null,
					}
				: null,
		});
		return row.id;
	} catch (err) {
		warnPersistFailure("recordRequiredAction", job.id, err);
		return undefined;
	}
}

// Resolve every open required_action for a run — called when the user's answer
// releases the suspension.
export async function resolveRequiredActions(runId: string): Promise<void> {
	try {
		for (const a of await listPendingRequiredActions(runId)) await resolveRequiredAction(a.id);
	} catch (err) {
		warnPersistFailure("resolveRequiredActions", runId, err);
	}
}

// WP3: a durable per-tool step record. Written alongside the tool_run so the run
// exposes an ordered step model (idx = the loop cursor).
export async function recordStepRun(
	job: AgentJob,
	tool: string,
	status: "completed" | "failed",
	detail?: { error?: unknown },
): Promise<void> {
	try {
		await insertStepRun({
			workflow_run_id: job.id,
			idx: job.run?.step ?? 0,
			tool_name: tool,
			status,
			error_message: detail?.error
				? detail.error instanceof Error
					? detail.error.message
					: textOf(detail.error, JSON.stringify(detail.error))
				: null,
		});
	} catch (err) {
		warnPersistFailure("recordStepRun", job.id, err);
	}
}
