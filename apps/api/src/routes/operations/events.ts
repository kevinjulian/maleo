/* Per-project event log: list, agent trace (grouped runs), and manual record. */
import type { Hono } from "hono";
import { listContentProjectEvents, recordContentProjectEvent } from "@maleo/db/events";
import { getContentProject } from "@maleo/db/project-detail";
import { buildAgentTrace } from "../../lib/agent-trace.ts";
import {
	listRunArtifacts,
	listToolRuns,
	listWorkflowRunsForProject,
} from "@maleo/db/workflow-run-db";
import { buildProjectQualityReport } from "../../modules/agents/core/quality-report.ts";
import { feedbackBody, recordEventBody } from "./request-schemas.ts";

export function registerEventRoutes(app: Hono): void {
	app.get("/projects/:id/events", async (c) => {
		const detail = await getContentProject(c.req.param("id"));
		if (!detail) return c.json({ error: "project_not_found" }, 404);
		return c.json({ items: await listContentProjectEvents(c.req.param("id")) });
	});

	// Agent audit trail grouped into runs: one user message → its tool calls →
	// result. Powers the chat Trace panel ("what changed, why, with what").
	app.get("/projects/:id/trace", async (c) => {
		const projectId = c.req.param("id");
		const detail = await getContentProject(projectId);
		if (!detail) return c.json({ error: "project_not_found" }, 404);
		const workflowRuns = await listWorkflowRunsForProject(projectId);
		const durable = new Map(workflowRuns.map((run) => [run.id, run.snapshot]));
		const artifacts = await listRunArtifacts(projectId);
		const tools = (await Promise.all(workflowRuns.map((run) => listToolRuns(run.id)))).flat();
		const projectEvents = await listContentProjectEvents(projectId);
		const sessions = buildAgentTrace(projectEvents).map((session) => {
			const snapshot = durable.get(session.jobId);
			return {
				...session,
				outcomeContract: snapshot?.outcomeContract ?? null,
				outcomeEvaluation: snapshot?.outcomeEvaluation ?? null,
			};
		});
		// Latest storyboard: the story plan persisted there is where the visual-beat
		// signals are counted from.
		const storyboard = detail.storyboards?.[0]?.storyboard_json;
		return c.json({
			sessions,
			artifacts,
			quality: buildProjectQualityReport({
				runs: workflowRuns,
				tools,
				artifacts,
				renders: detail.renders,
				events: projectEvents,
				storyboard,
			}),
		});
	});

	app.post("/projects/:id/feedback", async (c) => {
		const projectId = c.req.param("id");
		if (!(await getContentProject(projectId))) return c.json({ error: "project_not_found" }, 404);
		const parsed = feedbackBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		if (body.action !== "accept" && body.action !== "regenerate" && body.action !== "rollback")
			return c.json({ error: "invalid_feedback_action" }, 400);
		if (
			body.action === "accept" &&
			(!body.run_id ||
				!(await listWorkflowRunsForProject(projectId)).some((run) => run.id === body.run_id))
		) {
			return c.json({ error: "invalid_feedback_run" }, 400);
		}
		if (body.action !== "accept" && !body.target_ref?.trim())
			return c.json({ error: "feedback_target_required" }, 400);
		const event = await recordContentProjectEvent({
			project_id: projectId,
			actor_type: "operator",
			actor_id: "dashboard",
			kind: "agent.feedback",
			summary: `Operator ${body.action} feedback.`,
			payload_json: {
				action: body.action,
				run_id: body.run_id ?? null,
				target_ref: body.target_ref?.trim() ?? null,
			},
		});
		return c.json({ ok: true, event }, 201);
	});

	app.post("/projects/:id/events", async (c) => {
		const parsed = recordEventBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		if (!body.actor_type?.trim()) return c.json({ error: "actor_type required" }, 400);
		if (!body.kind?.trim()) return c.json({ error: "kind required" }, 400);
		if (!body.summary?.trim()) return c.json({ error: "summary required" }, 400);
		const event = await recordContentProjectEvent({
			project_id: c.req.param("id"),
			output_id: typeof body.output_id === "string" ? body.output_id : null,
			storyboard_id: typeof body.storyboard_id === "string" ? body.storyboard_id : null,
			actor_type: body.actor_type.trim(),
			actor_id: typeof body.actor_id === "string" ? body.actor_id : null,
			kind: body.kind.trim(),
			summary: body.summary.trim(),
			payload_json:
				body.payload_json && typeof body.payload_json === "object" ? body.payload_json : null,
		});
		if (!event) return c.json({ error: "project_not_found" }, 404);
		return c.json({ ok: true, event }, 201);
	});
}
