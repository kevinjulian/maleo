/* Render record creation + reconcile (pull latest status from the video job). */
import type { Hono } from "hono";
import { getContentProject } from "@maleo/db/project-detail";
import { addContentRender, reconcileContentRender } from "@maleo/db/renders";
import { getJob as getVideoJob } from "../../lib/video-client.ts";
import { createRenderBody } from "./request-schemas.ts";
import { resolveRenderMedia } from "../../lib/video-media.ts";

export function registerRenderRoutes(app: Hono): void {
	app.post("/projects/:id/renders", async (c) => {
		const parsed = createRenderBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		const render = await addContentRender({
			project_id: c.req.param("id"),
			output_id: typeof body.output_id === "string" ? body.output_id : null,
			storyboard_id: typeof body.storyboard_id === "string" ? body.storyboard_id : null,
			draft_id: typeof body.draft_id === "string" ? body.draft_id : null,
			video_job_id: typeof body.video_job_id === "string" ? body.video_job_id : null,
			status: typeof body.status === "string" ? body.status : "queued",
			phase: typeof body.phase === "string" ? body.phase : null,
			duration_sec:
				typeof body.duration_sec === "number" && Number.isFinite(body.duration_sec)
					? body.duration_sec
					: null,
		});
		if (!render) return c.json({ error: "project_not_found" }, 404);
		return c.json({ ok: true, render }, 201);
	});

	app.post("/projects/:id/renders/:renderId/reconcile", async (c) => {
		const detail = await getContentProject(c.req.param("id"));
		if (!detail) return c.json({ error: "project_not_found" }, 404);
		const render = detail.renders.find((item) => item.id === c.req.param("renderId"));
		if (!render) return c.json({ error: "render_not_found" }, 404);
		if (!render.video_job_id) return c.json({ error: "render_job_missing" }, 400);
		try {
			const raw = await getVideoJob(render.video_job_id);
			if (!raw || raw.workspace !== detail.project.workspace)
				return c.json({ error: "video_job_not_found" }, 404);
			const job = await resolveRenderMedia(raw);
			await reconcileContentRender(c.req.param("id"), job);
			const next = (await getContentProject(c.req.param("id")))?.renders.find(
				(item) => item.id === c.req.param("renderId"),
			);
			if (!next) return c.json({ error: "render_not_found" }, 404);
			return c.json({ ok: true, render: next, video_job: job });
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
		}
	});
}
