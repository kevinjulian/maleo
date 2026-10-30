/* WP5 first-class run/tool output — DB-backed read API. Exposes durable run state
 * (workflow_run + step_run + tool_run + run_artifact) so a client can render a
 * run's step/tool history from the DB instead of the in-memory job.events shape.
 * Read-only; the durable Inngest path owns writes. */
import type { Hono } from "hono";
import { capturedTextSelectionSchema } from "@maleo/shared";
import { getContentProject } from "@maleo/db/project-detail";
import {
	getWorkflowRun,
	listWorkflowRunsForProject,
	listStepRuns,
	listToolRuns,
	listRunArtifacts,
} from "@maleo/db/workflow-run-db";

export function registerRunRoutes(app: Hono): void {
	// List a project's runs (newest first) — lightweight meta, no snapshot blob.
	app.get("/projects/:id/runs", async (c) => {
		const projectId = c.req.param("id");
		if (!(await getContentProject(projectId))?.project)
			return c.json({ error: "project_not_found" }, 404);
		const runs = (await listWorkflowRunsForProject(projectId)).map((r) => ({
			id: r.id,
			status: r.status,
			contentType: r.content_type,
			cursor: r.cursor,
			instruction: r.instruction,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
			textSelection: capturedTextSelectionSchema.safeParse(r.snapshot?.textSelection).data
				?.selection,
		}));
		return c.json({ runs });
	});

	// One run with its full durable detail: steps, tool calls, and artifacts.
	app.get("/projects/:id/runs/:runId", async (c) => {
		const projectId = c.req.param("id");
		const runId = c.req.param("runId");
		const run = await getWorkflowRun(runId);
		if (!run || run.project_id !== projectId) return c.json({ error: "run_not_found" }, 404);
		const tools = await listToolRuns(runId);
		const toolRunIds = new Set(tools.map((t) => t.id));
		return c.json({
			run: {
				id: run.id,
				projectId: run.project_id,
				status: run.status,
				contentType: run.content_type,
				cursor: run.cursor,
				instruction: run.instruction,
				createdAt: run.created_at,
				updatedAt: run.updated_at,
				textSelection: capturedTextSelectionSchema.safeParse(run.snapshot?.textSelection).data
					?.selection,
				outcomeContract: run.snapshot?.outcomeContract ?? null,
				outcomeEvaluation: run.snapshot?.outcomeEvaluation ?? null,
			},
			steps: (await listStepRuns(runId)).map((s) => ({
				id: s.id,
				idx: s.idx,
				tool: s.tool_name,
				status: s.status,
				attempt: s.attempt,
				errorCode: s.error_code,
				errorMessage: s.error_message,
				createdAt: s.created_at,
			})),
			tools: tools.map((t) => ({
				id: t.id,
				tool: t.tool_name,
				status: t.status,
				input: t.input,
				output: t.output,
				error: t.error,
				cost: t.cost,
				idempotencyKey: t.idempotency_key,
				artifacts: t.artifacts,
				latencyMs: t.latency_ms,
				createdAt: t.created_at,
			})),
			artifacts: (await listRunArtifacts(projectId))
				.filter((a) => a.tool_run_id !== null && toolRunIds.has(a.tool_run_id))
				.map((a) => ({
					id: a.id,
					toolRunId: a.tool_run_id,
					kind: a.kind,
					status: a.status,
					publicUrl: a.public_url,
					storageKey: a.storage_key,
					metadata: a.metadata,
					version: a.version,
					createdAt: a.created_at,
				})),
		});
	});
}
