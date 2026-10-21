/* What still blocks this project, and the answers to it.
 *
 * A read of current state, not of a run: blockers stay readable when no run is
 * active, which is the whole reason they moved out of the transcript. */
import type { Hono } from "hono";
import { z } from "zod";
import {
	acknowledgeBlockers,
	projectBlockers,
	resolveBlockers,
} from "../../lib/blocker-service.ts";
import { blockerBatch } from "@maleo/shared";

const acknowledgeBody = z.object({ ids: z.array(z.string().min(1)).min(1) });

const resolveBody = z.object({
	answers: z
		.array(
			z.object({
				id: z.string().min(1),
				choice: z.string().min(1).optional(),
				otherText: z.string().trim().min(1).max(400).optional(),
			}),
		)
		.min(1),
});

export function registerBlockerRoutes(app: Hono): void {
	app.get("/projects/:id/blockers", async (c) => {
		const state = await projectBlockers(c.req.param("id"));
		if (!state) return c.json({ error: "project_not_found" }, 404);
		return c.json({ ...state, batch: blockerBatch(state.blockers) });
	});

	app.post("/projects/:id/blockers/resolve", async (c) => {
		const parsed = resolveBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const result = await resolveBlockers(c.req.param("id"), parsed.data.answers);
		if (result.ok) return c.json(result);
		return result.reason === "not_found"
			? c.json({ error: "project_not_found" }, 404)
			: c.json({ error: "incomplete", missing: result.missing }, 400);
	});

	app.post("/projects/:id/blockers/acknowledge", async (c) => {
		const parsed = acknowledgeBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const blockers = await acknowledgeBlockers(c.req.param("id"), parsed.data.ids);
		return blockers ? c.json({ blockers }) : c.json({ error: "project_not_found" }, 404);
	});
}
