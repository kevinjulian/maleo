/* Campaign CRUD + campaign detail (drafts across workspaces). */
import type { Hono } from "hono";
import { createCampaign, getCampaign, listCampaigns, updateCampaign } from "@maleo/db/campaigns";
import { listContentProjects } from "@maleo/db/content-projects";
import { listCampaignDrafts } from "@maleo/db/drafts";
import { createCampaignBody, patchCampaignBody } from "./request-schemas.ts";

export function registerCampaignRoutes(app: Hono): void {
	app.get("/campaigns", async (c) => {
		return c.json({ items: await listCampaigns() });
	});

	app.post("/campaigns", async (c) => {
		const parsed = createCampaignBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		if (!body.name?.trim()) return c.json({ error: "name required" }, 400);
		const campaign = await createCampaign({
			name: body.name.trim(),
			goal: body.goal?.trim() ?? "",
			status: body.status,
			workspaces: Array.isArray(body.workspaces)
				? body.workspaces.filter((p) => typeof p === "string" && p.trim())
				: [],
			budget_json: body.budget_json ?? null,
			start_at: body.start_at ?? null,
			end_at: body.end_at ?? null,
		});
		return c.json({ ok: true, campaign }, 201);
	});

	// Campaign detail lists the campaign's drafts (across workspaces) instead of
	// the old ticket timeline.
	app.get("/campaigns/:id", async (c) => {
		const campaign = await getCampaign(c.req.param("id"));
		if (!campaign) return c.json({ error: "campaign_not_found" }, 404);
		const projects = await listContentProjects({ campaign_id: campaign.id, limit: 200, offset: 0 });
		const drafts = await listCampaignDrafts(campaign.id);
		return c.json({ campaign, projects, drafts });
	});

	app.put("/campaigns/:id", async (c) => {
		const parsed = patchCampaignBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		const campaign = await updateCampaign(c.req.param("id"), {
			name: body.name?.trim(),
			goal: body.goal?.trim(),
			status: body.status,
			workspaces: Array.isArray(body.workspaces)
				? body.workspaces.filter((p) => typeof p === "string" && p.trim())
				: undefined,
		});
		if (!campaign) return c.json({ error: "campaign_not_found" }, 404);
		return c.json({ ok: true, campaign });
	});
}
