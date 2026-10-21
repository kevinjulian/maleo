import type { Hono } from "hono";
import { clipTemplateInputSchema } from "@maleo/shared";
import {
	createContentClipTemplate,
	deleteContentClipTemplate,
	getContentClipTemplate,
	listContentClipTemplates,
	updateContentClipTemplate,
} from "@maleo/db/clip-templates";

export function registerClipTemplateRoutes(app: Hono): void {
	app.get("/clip-templates", async (c) => c.json({ items: await listContentClipTemplates() }));

	app.get("/clip-templates/:id", async (c) => {
		const item = await getContentClipTemplate(c.req.param("id"));
		return item ? c.json({ item }) : c.json({ error: "clip_template_not_found" }, 404);
	});

	app.post("/clip-templates", async (c) => {
		const parsed = clipTemplateInputSchema.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success)
			return c.json({ error: "invalid_clip_template", issues: parsed.error.issues }, 400);
		return c.json({ item: await createContentClipTemplate(parsed.data) }, 201);
	});

	app.put("/clip-templates/:id", async (c) => {
		const parsed = clipTemplateInputSchema.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success)
			return c.json({ error: "invalid_clip_template", issues: parsed.error.issues }, 400);
		const item = await updateContentClipTemplate(c.req.param("id"), parsed.data);
		return item ? c.json({ item }) : c.json({ error: "clip_template_not_found" }, 404);
	});

	app.delete("/clip-templates/:id", async (c) => {
		return (await deleteContentClipTemplate(c.req.param("id")))
			? c.json({ deleted: true })
			: c.json({ error: "clip_template_not_found" }, 404);
	});
}
