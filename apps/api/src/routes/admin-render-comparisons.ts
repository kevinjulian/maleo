/* Instance administrators read the render comparison report and explain
 * divergences (OpenSpec p2-export E7, E8). The worker owns the rows; these
 * routes forward to its `/comparisons` routes and record the caller as the
 * explainer. Mounted under `adminRoutes`, so only instance owners reach them. */
import { Hono, type Context } from "hono";
import { z } from "zod";
import { recordAdminAudit } from "@maleo/db/admin-audit";
import { activeCaller } from "../lib/active-workspace.ts";
import { comparisonRequest } from "../lib/video-client.ts";

const explainBody = z.object({
	cause: z.string().trim().min(1).max(2000),
	resolution: z.enum(["rust-fix", "remotion-defect", "tolerance-change"]),
	ref: z.string().trim().min(1).max(200).optional(),
	deployedAt: z.string().datetime().optional(),
});

async function forward(c: Context, path: string, init?: RequestInit): Promise<Response> {
	const res = await comparisonRequest(path, init);
	const body: unknown = await res.json().catch(() => ({ error: "worker_unreadable" }));
	return c.json(
		body,
		res.ok
			? 200
			: res.status === 404
				? 404
				: res.status === 409
					? 409
					: res.status === 400
						? 400
						: 502,
	);
}

export function adminRenderComparisonRoutes(): Hono {
	const app = new Hono();
	app.get("/report", (c) => forward(c, "/report"));
	app.get("/", (c) => {
		const status = c.req.query("status");
		return forward(c, status ? `/?status=${encodeURIComponent(status)}` : "/");
	});
	app.get("/:id", (c) => forward(c, `/${encodeURIComponent(c.req.param("id"))}`));
	app.post("/:id/explain", async (c) => {
		const body = explainBody.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: "invalid_body", issues: body.error.issues }, 400);
		const id = c.req.param("id");
		const actor = activeCaller(c).userId;
		const response = await forward(c, `/${encodeURIComponent(id)}/explain`, {
			method: "POST",
			body: JSON.stringify({ ...body.data, by: actor }),
		});
		await recordAdminAudit({
			actor_id: actor,
			action: "render_comparison.explain",
			target_type: "render_comparison",
			target_id: id,
			outcome: response.status === 200 ? "success" : "refused",
			reason: response.status === 200 ? body.data.resolution : `status_${response.status}`,
		});
		return response;
	});
	return app;
}
