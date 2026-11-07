/* Worker routes for the production comparison (OpenSpec p2-export E7, E8).
 * Mounted behind the worker's bearer token; the API exposes them to instance
 * administrators. */
import { Hono } from "hono";
import { z } from "zod";
import { windowReport } from "./comparison-window";
import {
	ExplainRefused,
	explainComparison,
	getComparison,
	listComparisons,
} from "./comparisons-db";

const explainSchema = z.object({
	cause: z.string().trim().min(1).max(2000),
	resolution: z.enum(["rust-fix", "remotion-defect", "tolerance-change"]),
	/** The fix commit, or the `comparison.json` version of a tolerance change. */
	ref: z.string().trim().min(1).max(200).optional(),
	/** When the fix was deployed (ISO 8601); a `rust-fix` needs it. */
	deployedAt: z.string().datetime().optional(),
	by: z.string().trim().min(1).max(200),
});

export function comparisonRoutes(now: () => number = Date.now): Hono {
	const app = new Hono();
	app.get("/report", (c) => c.json(windowReport(listComparisons(), now())));
	app.get("/", (c) => {
		const status = c.req.query("status");
		const rows = listComparisons().filter((row) => !status || row.status === status);
		return c.json({ items: rows.reverse().slice(0, 200) });
	});
	app.get("/:id", (c) => {
		const row = getComparison(c.req.param("id"));
		return row ? c.json(row) : c.json({ error: "not_found" }, 404);
	});
	app.post("/:id/explain", async (c) => {
		const parsed = explainSchema.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success)
			return c.json({ error: "invalid_explanation", issues: parsed.error.issues }, 400);
		const { deployedAt, ...rest } = parsed.data;
		try {
			const row = explainComparison(c.req.param("id"), {
				...rest,
				deployedAt: deployedAt ? Date.parse(deployedAt) : null,
			});
			return row ? c.json(row) : c.json({ error: "not_found" }, 404);
		} catch (error) {
			if (error instanceof ExplainRefused)
				return c.json({ error: "not_explainable", message: error.message }, 409);
			throw error;
		}
	});
	return app;
}
