import type { Hono } from "hono";
import { isFixtureRow, timelineTemplateInputSchema } from "@maleo/shared";
import {
	createContentTimelineTemplate,
	deleteContentTimelineTemplate,
	forkContentTimelineTemplate,
	getContentTimelineTemplate,
	listContentTimelineTemplates,
	updateContentTimelineTemplate,
} from "@maleo/db/timeline-templates";
import { resolveStockAudio, resolveStockAudioCue } from "@maleo/stock";

export function registerTimelineTemplateRoutes(app: Hono): void {
	app.get("/timeline-templates", async (c) =>
		c.json({ items: await listContentTimelineTemplates() }),
	);

	app.get("/timeline-templates/preview-sfx", async (c) => {
		const cue = c.req.query("cue")?.trim() ?? "";
		if (!cue) return c.json({ audio: null });
		const audio = await resolveStockAudioCue("accent_hit", cue);
		return c.json({ audio });
	});

	// Audition a background-music cue before saving it on a template. Resolves through
	// the same cached lookup the generated timeline uses, so what an operator hears
	// here is what the bed will be.
	app.get("/timeline-templates/preview-music", async (c) => {
		const cue = c.req.query("cue")?.trim() ?? "";
		if (!cue) return c.json({ audio: null });
		const audio = await resolveStockAudio("music", cue);
		return c.json({ audio });
	});

	app.get("/timeline-templates/:id", async (c) => {
		const item = await getContentTimelineTemplate(c.req.param("id"));
		return item ? c.json({ item }) : c.json({ error: "timeline_template_not_found" }, 404);
	});

	app.post("/timeline-templates", async (c) => {
		const parsed = timelineTemplateInputSchema.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success)
			return c.json({ error: "invalid_timeline_template", issues: parsed.error.issues }, 400);
		return c.json({ item: await createContentTimelineTemplate(parsed.data) }, 201);
	});

	/* Fork before edit, same contract as presets and materials. Shipped templates used
	 * to be editable in place here — only DELETE was refused — so this route is the one
	 * that changes behaviour for an existing client. */
	app.post("/timeline-templates/:id/fork", async (c) => {
		const item = await forkContentTimelineTemplate(c.req.param("id"));
		return item ? c.json({ item }, 201) : c.json({ error: "timeline_template_not_found" }, 404);
	});

	app.put("/timeline-templates/:id", async (c) => {
		const id = c.req.param("id");
		const existing = await getContentTimelineTemplate(id);
		if (!existing) return c.json({ error: "timeline_template_not_found" }, 404);
		if (isFixtureRow(existing))
			return c.json(
				{ error: "fixture_row_requires_fork", fork: `/timeline-templates/${id}/fork` },
				409,
			);
		const parsed = timelineTemplateInputSchema.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success)
			return c.json({ error: "invalid_timeline_template", issues: parsed.error.issues }, 400);
		const item = await updateContentTimelineTemplate(id, parsed.data);
		return item ? c.json({ item }) : c.json({ error: "timeline_template_not_found" }, 404);
	});

	app.delete("/timeline-templates/:id", async (c) => {
		const id = c.req.param("id");
		const existing = await getContentTimelineTemplate(id);
		if (!existing) return c.json({ error: "timeline_template_not_found" }, 404);
		if (isFixtureRow(existing)) return c.json({ error: "fixture_row_cannot_be_deleted" }, 409);
		return (await deleteContentTimelineTemplate(id))
			? c.json({ deleted: true })
			: c.json({ error: "timeline_template_not_found" }, 404);
	});
}
