/* Per-project output (deliverable) list / create / update. */
import type { Hono } from "hono";
import {
	createContentProjectOutput,
	listContentProjectOutputs,
	updateContentProjectOutput,
} from "@maleo/db/outputs";
import { getContentProject } from "@maleo/db/project-detail";
import { createOutputBody, patchOutputBody } from "./request-schemas.ts";

export function registerOutputRoutes(app: Hono): void {
	app.get("/projects/:id/outputs", async (c) => {
		const detail = await getContentProject(c.req.param("id"));
		if (!detail) return c.json({ error: "project_not_found" }, 404);
		return c.json({ items: await listContentProjectOutputs(c.req.param("id")) });
	});

	app.post("/projects/:id/outputs", async (c) => {
		const parsed = createOutputBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		if (!body.title?.trim()) return c.json({ error: "title required" }, 400);
		const output = await createContentProjectOutput({
			project_id: c.req.param("id"),
			storyboard_id: typeof body.storyboard_id === "string" ? body.storyboard_id : null,
			channel: typeof body.channel === "string" ? body.channel : null,
			platform: typeof body.platform === "string" ? body.platform : null,
			kind: typeof body.kind === "string" ? body.kind : "draft",
			title: body.title.trim(),
			status: typeof body.status === "string" ? body.status : "draft",
			draft_id: typeof body.draft_id === "string" ? body.draft_id : null,
			render_id: typeof body.render_id === "string" ? body.render_id : null,
			publish_job_id: typeof body.publish_job_id === "string" ? body.publish_job_id : null,
			content_json:
				body.content_json && typeof body.content_json === "object" ? body.content_json : null,
			notes: typeof body.notes === "string" ? body.notes : null,
		});
		if (!output) return c.json({ error: "project_not_found" }, 404);
		return c.json({ ok: true, output }, 201);
	});

	app.put("/projects/:id/outputs/:outputId", async (c) => {
		const parsed = patchOutputBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		if (body.title !== undefined && !body.title.trim())
			return c.json({ error: "title cannot be empty" }, 400);
		const output = await updateContentProjectOutput(c.req.param("id"), c.req.param("outputId"), {
			...(body.storyboard_id !== undefined ? { storyboard_id: body.storyboard_id } : {}),
			...(body.channel !== undefined ? { channel: body.channel } : {}),
			...(body.platform !== undefined ? { platform: body.platform } : {}),
			...(body.kind !== undefined ? { kind: body.kind } : {}),
			...(body.title !== undefined ? { title: body.title.trim() } : {}),
			...(body.status !== undefined ? { status: body.status } : {}),
			...(body.draft_id !== undefined ? { draft_id: body.draft_id } : {}),
			...(body.render_id !== undefined ? { render_id: body.render_id } : {}),
			...(body.publish_job_id !== undefined ? { publish_job_id: body.publish_job_id } : {}),
			...(body.content_json !== undefined ? { content_json: body.content_json } : {}),
			...(body.notes !== undefined ? { notes: body.notes } : {}),
		});
		if (!output) return c.json({ error: "output_not_found" }, 404);
		return c.json({ ok: true, output });
	});
}
