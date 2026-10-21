import type { Hono } from "hono";
import { motionPresetInputSchema } from "@maleo/shared";
import {
	createContentMotionPreset,
	deleteContentMotionPreset,
	getContentMotionPreset,
	listContentMotionPresets,
	updateContentMotionPreset,
} from "@maleo/db/motion-presets";

export function registerMotionPresetRoutes(app: Hono): void {
	app.get("/motion-presets", async (c) => c.json({ items: await listContentMotionPresets() }));

	app.get("/motion-presets/:id", async (c) => {
		const item = await getContentMotionPreset(c.req.param("id"));
		return item ? c.json({ item }) : c.json({ error: "motion_preset_not_found" }, 404);
	});

	app.post("/motion-presets", async (c) => {
		const parsed = motionPresetInputSchema.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success)
			return c.json({ error: "invalid_motion_preset", issues: parsed.error.issues }, 400);
		return c.json({ item: await createContentMotionPreset(parsed.data) }, 201);
	});

	app.put("/motion-presets/:id", async (c) => {
		const parsed = motionPresetInputSchema.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success)
			return c.json({ error: "invalid_motion_preset", issues: parsed.error.issues }, 400);
		const item = await updateContentMotionPreset(c.req.param("id"), parsed.data);
		return item ? c.json({ item }) : c.json({ error: "motion_preset_not_found" }, 404);
	});

	app.delete("/motion-presets/:id", async (c) => {
		return (await deleteContentMotionPreset(c.req.param("id")))
			? c.json({ deleted: true })
			: c.json({ error: "motion_preset_not_found" }, 404);
	});
}
