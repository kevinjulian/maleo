/* Storyboard version save and authoring routes. */
import type { Hono } from "hono";
import { getContentProject } from "@maleo/db/project-detail";
import { syncProjectReferenceLock } from "@maleo/db/references";
import { addContentStoryboard, StoryboardRevisionConflict } from "@maleo/db/storyboards";
import { readStoryboardDocument } from "@maleo/shared";
import { prepareStoryboardSave } from "../../lib/storyboard-save.ts";
import {
	approveStoryboard,
	commandStoryboard,
	readStoryboardAuthoring,
} from "../../lib/storyboard-authoring.ts";

import {
	createStoryboardBody,
	storyboardApprovalBody,
	storyboardCommandBody,
} from "./request-schemas.ts";

export function registerStoryboardRoutes(app: Hono): void {
	app.get("/projects/:id/storyboard-authoring", async (c) => {
		const snapshot = await readStoryboardAuthoring(c.req.param("id"));
		return snapshot ? c.json(snapshot) : c.json({ error: "project_not_found" }, 404);
	});

	app.post("/projects/:id/storyboard-authoring/commands", async (c) => {
		const parsed = storyboardCommandBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const result = await commandStoryboard(
			c.req.param("id"),
			parsed.data.expectedRevisionId,
			parsed.data.command,
		);
		if (result.ok) return c.json(result, 201);
		const status = result.reason === "not_found" ? 404 : result.reason === "conflict" ? 409 : 422;
		return c.json(result, status);
	});

	app.post("/projects/:id/storyboard-authoring/approve", async (c) => {
		const parsed = storyboardApprovalBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const result = await approveStoryboard(
			c.req.param("id"),
			parsed.data.expectedRevisionId,
			parsed.data.extensionPolicy,
		);
		if (result.ok) return c.json(result, 201);
		const status = result.reason === "not_found" ? 404 : result.reason === "conflict" ? 409 : 422;
		return c.json(result, status);
	});

	app.post("/projects/:id/storyboards", async (c) => {
		const parsed = createStoryboardBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		if (!body.storyboard_json || typeof body.storyboard_json !== "object") {
			return c.json({ error: "storyboard_json required" }, 400);
		}
		const projectId = c.req.param("id");
		const latest = (await getContentProject(projectId))?.storyboards?.[0];
		const checked = prepareStoryboardSave(
			body.storyboard_json,
			latest?.storyboard_json,
			body.expectedCaptionState ?? null,
		);
		if (!checked.ok) {
			const { ok: _ok, status, ...refusal } = checked;
			return c.json(refusal, status);
		}
		const { storyboard_json } = checked;
		let storyboard;
		try {
			storyboard = await addContentStoryboard({
				project_id: projectId,
				expectedRevisionId: latest?.id ?? null,
				source_prompt: body.source_prompt ?? null,
				reference_notes: body.reference_notes ?? null,
				status: body.status ?? "draft",
				storyboard_json,
			});
		} catch (error) {
			if (error instanceof StoryboardRevisionConflict)
				return c.json({ error: "storyboard_conflict", message: error.message }, 409);
			throw error;
		}
		if (!storyboard) return c.json({ error: "project_not_found" }, 404);
		/* The lock and the roster are written together, here, because this is the
		 * one route that persists the lock.
		 *
		 * Preset application is a client-side computation that ends in this save,
		 * and it wrote `projectReferences.entityIds` alone — so a preset selecting
		 * `Sketch Stickman` produced a document naming it and a roster without it,
		 * and generation resolved nothing. Doing the attach in the preset code
		 * would have fixed that one caller and left every other writer of the
		 * document free to drift again.
		 *
		 * `syncProjectReferenceLock` validates workspace membership and is
		 * idempotent, so a repeated autosave neither duplicates roster rows nor
		 * lets a foreign entity in. Ids it could not attach are reported, not
		 * swallowed: the client marks them unresolved and generation blocks. */
		const lock = await syncProjectReferenceLock({
			project_id: projectId,
			entity_ids: readStoryboardDocument(storyboard_json).doc.projectReferences.entityIds,
		});
		return c.json({ ok: true, storyboard, references: lock }, 201);
	});
}
