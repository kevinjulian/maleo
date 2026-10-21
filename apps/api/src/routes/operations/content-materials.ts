import type { Hono } from "hono";
import { z } from "zod";
import { isFixtureRow, MATERIAL_GROUPS, materialRecordInputSchema } from "@maleo/shared";
import {
	createContentMaterial,
	deleteContentMaterial,
	forkContentMaterial,
	getContentMaterial,
	listContentMaterials,
	updateContentMaterial,
} from "@maleo/db/content-materials";
import { activeWorkspace as workspaceOf } from "../../lib/active-workspace.ts";

const groupQuerySchema = z.enum(MATERIAL_GROUPS);

/* The tenant every request in this module reads and writes within comes from
 * `lib/active-workspace.ts` — validated against the registry once per request,
 * and refused rather than replaced when it names a workspace that does not
 * exist. This module used to resolve it locally as `query("workspace") ||
 * "default"`, which turned a typo into another tenant's data with no signal.
 *
 * A caller still never chooses the workspace on the BODY.
 * `materialRecordInputSchema` is strict and carries no workspace field, so
 * there is exactly one place a tenant can be named. */

/** Reusable materials — the generation context a project selects and a Project
 *  Preset names per group. Library-scoped like timeline templates and content
 *  presets; mounted under /api/operations.
 *
 *  Shipped materials DO appear here, as read-only fixture rows. They used to be inlined
 *  in the preset definitions and seeded as virtual values, which made a built-in preset
 *  look like it contained nothing when inspected. They are still not a separate place a
 *  default comes from: a fixture Material reaches a project only because a Project
 *  Preset names it, exactly like an operator's own material. Editing one forks it into
 *  the caller's workspace. */
export function registerContentMaterialRoutes(app: Hono): void {
	app.get("/content-materials", async (c) => {
		const raw = c.req.query("group");
		// An unrecognised group is rejected rather than ignored: silently returning
		// every material would look like the filter worked and show the wrong tab.
		if (raw !== undefined) {
			const parsed = groupQuerySchema.safeParse(raw);
			if (!parsed.success) return c.json({ error: "invalid_material_group" }, 400);
			return c.json({ items: await listContentMaterials(workspaceOf(c), parsed.data) });
		}
		return c.json({ items: await listContentMaterials(workspaceOf(c)) });
	});

	/* Another workspace's material reads as 404, not 403. The distinction between
	 * "does not exist" and "exists but is not yours" is itself a cross-tenant
	 * disclosure — it confirms an id is in use elsewhere. */
	app.get("/content-materials/:id", async (c) => {
		const item = await getContentMaterial(c.req.param("id"), workspaceOf(c));
		return item ? c.json({ item }) : c.json({ error: "content_material_not_found" }, 404);
	});

	app.post("/content-materials", async (c) => {
		const parsed = materialRecordInputSchema.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success)
			return c.json({ error: "invalid_content_material", issues: parsed.error.issues }, 400);
		return c.json({ item: await createContentMaterial(parsed.data, workspaceOf(c)) }, 201);
	});

	/* Fork before edit. The copy lands in the caller's workspace, so a fixture Material
	 * — which lives in the reserved scope and belongs to no workspace — becomes an
	 * ordinary row this tenant owns. */
	app.post("/content-materials/:id/fork", async (c) => {
		const item = await forkContentMaterial(c.req.param("id"), workspaceOf(c));
		return item ? c.json({ item }, 201) : c.json({ error: "content_material_not_found" }, 404);
	});

	app.patch("/content-materials/:id", async (c) => {
		const id = c.req.param("id");
		const existing = await getContentMaterial(id, workspaceOf(c));
		if (!existing) return c.json({ error: "content_material_not_found" }, 404);
		if (isFixtureRow(existing))
			return c.json(
				{ error: "fixture_row_requires_fork", fork: `/content-materials/${id}/fork` },
				409,
			);
		const parsed = materialRecordInputSchema.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success)
			return c.json({ error: "invalid_content_material", issues: parsed.error.issues }, 400);
		const item = await updateContentMaterial(id, parsed.data, workspaceOf(c));
		return item ? c.json({ item }) : c.json({ error: "content_material_not_found" }, 404);
	});

	app.delete("/content-materials/:id", async (c) => {
		const id = c.req.param("id");
		const existing = await getContentMaterial(id, workspaceOf(c));
		if (!existing) return c.json({ error: "content_material_not_found" }, 404);
		if (isFixtureRow(existing)) return c.json({ error: "fixture_row_cannot_be_deleted" }, 409);
		return (await deleteContentMaterial(id, workspaceOf(c)))
			? c.json({ deleted: true })
			: c.json({ error: "content_material_not_found" }, 404);
	});
}
