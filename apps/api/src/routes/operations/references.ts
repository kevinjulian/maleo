/* Project reference routes: the entity roster and text-only project notes.
 *
 * The legacy `content_references` CRUD lived here — POST/DELETE
 * /projects/:id/references plus a mirror-into-assets helper that took a reference
 * row. Both went with the table. Asset mirroring now reads entities.
 *
 * Reference packs lived here too — named snapshots copied between projects to
 * fake cross-project reuse. A workspace-scoped reference library serves that
 * natively, and the copying is what produced duplicate identities. */
import type { Hono } from "hono";
import { deleteProjectNote, upsertProjectNote } from "@maleo/db/project-children";
import { getContentProject } from "@maleo/db/project-detail";
import {
	addProjectReference,
	deleteReferenceEntity,
	getReferenceEntity,
	listProjectReferences,
	removeProjectReference,
	setProjectPrimaryReference,
	upsertReferenceEntity,
} from "@maleo/db/references";
import { roleOf } from "@maleo/shared";
import {
	toProjectNoteWire,
	toReferenceEntityWire,
	toReferenceEntityWires,
} from "../../lib/wire/reference-entity.ts";
import { activeWorkspace } from "../../lib/active-workspace.ts";
import {
	projectNoteBody,
	attachEntityBody,
	primaryEntityBody,
	referenceEntityBody,
} from "./request-schemas.ts";

export function registerReferenceRoutes(app: Hono): void {
	registerWorkspaceReferenceEntityRoutes(app);
	registerProjectReferenceEntityRoutes(app);
	registerProjectNoteRoutes(app);
}

function registerWorkspaceReferenceEntityRoutes(app: Hono): void {
	app.put("/reference-entities/:entityId", async (c) => {
		const entityId = c.req.param("entityId");
		const existing = await getReferenceEntity(entityId);
		if (!existing) return c.json({ error: "entity_not_found" }, 404);
		const workspace = activeWorkspace(c);
		if (existing.workspace !== workspace) return c.json({ error: "cross_workspace_entity" }, 403);

		const parsed = referenceEntityBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		const role = roleOf(body.role) ?? null;
		const label = body.label?.trim();
		if (!role) return c.json({ error: "role required" }, 400);
		if (!label) return c.json({ error: "label required" }, 400);

		const entity = await upsertReferenceEntity({
			id: entityId,
			workspace,
			role,
			label,
			description: body.description?.trim() ?? "",
			canonical_image_url: body.imageUrl?.trim() || null,
			tags: body.tags?.length ? body.tags : [role],
			origin: body.origin === "generated" ? "generated" : existing.origin,
		});
		if (!entity) return c.json({ error: "entity_update_failed" }, 500);
		return c.json({ ok: true, reference: toReferenceEntityWire(entity) });
	});

	app.delete("/reference-entities/:entityId", async (c) => {
		const entityId = c.req.param("entityId");
		const existing = await getReferenceEntity(entityId);
		if (!existing) return c.json({ ok: true, removed: false });
		if (existing.workspace !== activeWorkspace(c))
			return c.json({ error: "cross_workspace_entity" }, 403);
		return c.json({ ok: true, removed: await deleteReferenceEntity(entityId) });
	});
}

/* Text-only project notes. They used to be written as `content_references` rows
 * with kind='note'; the entity migration copied them into `project_note` and left
 * the write path behind, so anything created since lived only in the legacy table. */
function registerProjectNoteRoutes(app: Hono): void {
	app.put("/projects/:id/notes/:noteId", async (c) => {
		const parsed = projectNoteBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		const label = body.label?.trim();
		if (!label) return c.json({ error: "label required" }, 400);
		const note = await upsertProjectNote({
			id: c.req.param("noteId"),
			project_id: c.req.param("id"),
			label,
			body: typeof body.body === "string" ? body.body : "",
			tags: Array.isArray(body.tags)
				? body.tags.filter((t): t is string => typeof t === "string")
				: [],
			is_default: body.is_default === true,
		});
		if (!note) return c.json({ error: "project_not_found" }, 404);
		// The row shape stops at the seam on writes too — the client reads the same
		// note shape it gets from a read.
		return c.json({ ok: true, note: toProjectNoteWire(note) });
	});

	app.delete("/projects/:id/notes/:noteId", async (c) => {
		const removed = await deleteProjectNote(c.req.param("id"), c.req.param("noteId"));
		return c.json({ ok: true, removed });
	});
}

/* The project ROSTER: which workspace entities are attached to this project.
 *
 * Distinct from the project's generation lock, which lives in the storyboard
 * document as `projectReferences.entityIds` and says which of the roster applies
 * to every clip. The lock is a subset of the roster; these routes do not touch it.
 *
 * The DB layer has had these accessors since the entity model landed with nothing
 * routed to them, so the only writer was the agent's create_character tool — an
 * operator could not attach, detach, or pick a lead subject. */
function registerProjectReferenceEntityRoutes(app: Hono): void {
	app.get("/projects/:id/reference-entities", async (c) => {
		const entities = toReferenceEntityWires(
			await listProjectReferences(c.req.param("id"), { sceneKey: null }),
		);
		return c.json({ items: entities, total: entities.length });
	});

	app.post("/projects/:id/reference-entities", async (c) => {
		const projectId = c.req.param("id");
		const parsed = attachEntityBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		const entityId = body.entity_id?.trim();
		if (!entityId) return c.json({ error: "entity_id required" }, 400);

		// `addProjectReference` returns null for three different reasons. Resolve
		// them here so a cross-workspace attempt reads as a tenancy refusal rather
		// than as a missing row.
		const project = await getContentProject(projectId);
		if (!project) return c.json({ error: "project_not_found" }, 404);
		const entity = await getReferenceEntity(entityId);
		if (!entity) return c.json({ error: "entity_not_found" }, 404);
		if (entity.workspace !== project.project.workspace) {
			return c.json({ error: "cross_workspace_entity" }, 403);
		}

		const reference = await addProjectReference({ project_id: projectId, entity_id: entityId });
		if (!reference) return c.json({ error: "attach_failed" }, 500);
		return c.json({ ok: true, reference: toReferenceEntityWire(reference) }, 201);
	});

	app.delete("/projects/:id/reference-entities/:entityId", async (c) => {
		// Detaching something that was never attached is the desired end state, not
		// an error — `removed` reports which happened.
		const removed = await removeProjectReference(c.req.param("id"), c.req.param("entityId"), null);
		return c.json({ ok: true, removed });
	});

	app.put("/projects/:id/reference-entities/primary", async (c) => {
		const projectId = c.req.param("id");
		const parsed = primaryEntityBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		const entityId =
			typeof body.entity_id === "string" && body.entity_id.trim() ? body.entity_id.trim() : null;
		if (!(await getContentProject(projectId))) return c.json({ error: "project_not_found" }, 404);
		if (
			entityId &&
			!(await listProjectReferences(projectId, { sceneKey: null })).some((e) => e.id === entityId)
		) {
			// A lead subject that is not on the roster would be unreachable to every
			// reader of `is_primary`, including selectCast's backfill.
			return c.json({ error: "entity_not_attached" }, 409);
		}
		await setProjectPrimaryReference(projectId, entityId);
		return c.json({ ok: true, primary: entityId });
	});
}
