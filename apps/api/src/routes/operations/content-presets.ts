import type { Hono } from "hono";
import { z } from "zod";
import { contentPresetInputSchema, isFixtureRow } from "@maleo/shared";
import {
	createContentPreset,
	deleteContentPreset,
	forkContentPreset,
	getContentPreset,
	getContentPresetUsage,
	getDefaultContentPresetId,
	listContentPresets,
	setDefaultContentPresetId,
	updateContentPreset,
} from "@maleo/db/content-presets";

const defaultPointerSchema = z.object({ id: z.string().trim().min(1).nullable() });

/** Named content presets (style knobs + refs + settings) with a single default
 *  pointer. Mounted under /api/operations. The default id rides on every list response
 *  so the create flow can seed a new project without a second request.
 *
 *  Shipped presets are rows now, listed by the same query as everyone else's rather than
 *  merged in from code. They are NOT writable: a write addressed to one is refused with a
 *  409 that names the fork step, and never silently redirected to a different row — an
 *  API client that asked to change id X and got back id Y has been lied to. */
export function registerContentPresetRoutes(app: Hono): void {
	app.get("/content-presets", async (c) =>
		c.json({ items: await listContentPresets(), defaultId: await getDefaultContentPresetId() }),
	);

	/* Who draws from this preset, and who has drifted off it.
	 *
	 * Derived from stored provenance at read time rather than kept as a counter on the
	 * row: a counter needs invalidating on every project save and will drift, and drift
	 * is what provenance exists to remove. Both the blast-radius warning before a write
	 * and the library's divergence view read this one number, so they cannot disagree.
	 *
	 * Builtins answer too. A builtin supplies elements exactly like a workspace preset,
	 * and "how many projects would a fork affect" is a fair question about one. */
	app.get("/content-presets/:id/usage", async (c) => {
		const id = c.req.param("id");
		const exists = Boolean(await getContentPreset(id));
		if (!exists) return c.json({ error: "content_preset_not_found" }, 404);
		return c.json(await getContentPresetUsage(id));
	});

	app.get("/content-presets/:id", async (c) => {
		const id = c.req.param("id");
		const item = await getContentPreset(id);
		return item ? c.json({ item }) : c.json({ error: "content_preset_not_found" }, 404);
	});

	app.post("/content-presets", async (c) => {
		const parsed = contentPresetInputSchema.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success)
			return c.json({ error: "invalid_content_preset", issues: parsed.error.issues }, 400);
		return c.json({ item: await createContentPreset(parsed.data) }, 201);
	});

	/* Fork before edit. The UI calls this, then patches the copy it gets back; the 409
	 * on PATCH below names this route so a client that skipped the step is told what to
	 * do rather than just refused. The copy keeps the fixture's material and template
	 * ids — forking a preset does not clone the library behind it. */
	app.post("/content-presets/:id/fork", async (c) => {
		const item = await forkContentPreset(c.req.param("id"));
		return item ? c.json({ item }, 201) : c.json({ error: "content_preset_not_found" }, 404);
	});

	app.patch("/content-presets/:id", async (c) => {
		const id = c.req.param("id");
		const existing = await getContentPreset(id);
		if (!existing) return c.json({ error: "content_preset_not_found" }, 404);
		if (isFixtureRow(existing))
			return c.json(
				{ error: "fixture_row_requires_fork", fork: `/content-presets/${id}/fork` },
				409,
			);
		const parsed = contentPresetInputSchema.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success)
			return c.json({ error: "invalid_content_preset", issues: parsed.error.issues }, 400);
		const item = await updateContentPreset(id, parsed.data);
		return item ? c.json({ item }) : c.json({ error: "content_preset_not_found" }, 404);
	});

	app.delete("/content-presets/:id", async (c) => {
		const id = c.req.param("id");
		const existing = await getContentPreset(id);
		if (!existing) return c.json({ error: "content_preset_not_found" }, 404);
		if (isFixtureRow(existing)) return c.json({ error: "fixture_row_cannot_be_deleted" }, 409);
		return (await deleteContentPreset(id))
			? c.json({ deleted: true })
			: c.json({ error: "content_preset_not_found" }, 404);
	});

	app.put("/content-presets/default", async (c) => {
		const parsed = defaultPointerSchema.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success)
			return c.json({ error: "invalid_default_pointer", issues: parsed.error.issues }, 400);
		// Setting a non-existent id would silently seed nothing; reject early. A fixture
		// is a row like any other now, so one lookup answers for both kinds.
		if (parsed.data.id && !(await getContentPreset(parsed.data.id)))
			return c.json({ error: "content_preset_not_found" }, 404);
		await setDefaultContentPresetId(parsed.data.id);
		return c.json({ defaultId: await getDefaultContentPresetId() });
	});
}
