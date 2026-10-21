import { Hono } from "hono";
import { tailActivity } from "../lib/activity-tail.ts";
import { activeWorkspace, workspaceScope } from "../lib/active-workspace.ts";
import { summarizeActivity, type AuditEntry } from "./operations/audit.ts";
import { effectiveVoiceCatalogue } from "../lib/voice-catalogue-source.ts";
import { listDrafts } from "@maleo/db/drafts";
import { registerAssetRoutes } from "./operations/assets.ts";
import { registerCampaignRoutes } from "./operations/campaigns.ts";
import { registerEventRoutes } from "./operations/events.ts";
import { registerGenerationRoutes } from "./operations/generation.ts";
import { registerRunRoutes } from "./operations/runs.ts";
import { registerOutputRoutes } from "./operations/outputs.ts";
import { registerProjectRoutes } from "./operations/projects.ts";
import { registerReferenceRoutes } from "./operations/references.ts";
import { registerRenderRoutes } from "./operations/renders.ts";
import { registerStoryboardRoutes } from "./operations/storyboards.ts";
import { registerBlockerRoutes } from "./operations/blockers.ts";
import { registerTimelineTemplateRoutes } from "./operations/timeline-templates.ts";
import { registerContentPresetRoutes } from "./operations/content-presets.ts";
import { registerContentMaterialRoutes } from "./operations/content-materials.ts";
import { registerMotionPresetRoutes } from "./operations/motion-presets.ts";
import { registerClipTemplateRoutes } from "./operations/clip-templates.ts";
import { projectMediaImportRoutes } from "../modules/media-import/index.ts";
import { projectMediaProcessingRoutes } from "../modules/media-processing/index.ts";

// Content-operations API. Route handlers live in per-resource modules under
// ./operations/*; this composer mounts them on one Hono app and keeps the small
// cross-cutting read endpoints (voices, draft feed, audit) inline.
export function operationsRoutes(): Hono {
	const app = new Hono();

	// Mounted before every handler so the tenant is resolved and validated once
	// per request, rather than each surface deciding for itself. A route that
	// reads no workspace is unaffected; one that does cannot get an unregistered
	// value or a silent `default`.
	app.use("*", workspaceScope());
	app.route("/projects", projectMediaImportRoutes());
	app.route("/projects", projectMediaProcessingRoutes());

	registerAssetRoutes(app);
	registerGenerationRoutes(app);
	registerRunRoutes(app);
	registerCampaignRoutes(app);
	registerProjectRoutes(app);
	registerStoryboardRoutes(app);
	registerBlockerRoutes(app);
	registerReferenceRoutes(app);
	registerRenderRoutes(app);
	registerOutputRoutes(app);
	registerEventRoutes(app);
	registerTimelineTemplateRoutes(app);
	registerContentPresetRoutes(app);
	registerContentMaterialRoutes(app);
	registerMotionPresetRoutes(app);
	registerClipTemplateRoutes(app);

	// The voice catalogue backing the content-first "cast & voices" picker.
	// Voices are opaque keys stored on content_references.voice_key; no table needed.
	app.get("/voices", async (c) => {
		// Resolved per request, not at import time, for two reasons: baking against
		// a running server must start serving previews without a restart, and the
		// effective provider is an env knob that a restart is not required to read.
		const { provider, ready, voices } = await effectiveVoiceCatalogue(activeWorkspace(c));
		return c.json({ items: voices, provider, ready });
	});

	// The active workspace's content feed (drafts). Replaces the old /tickets list.
	// Filters: campaign_id, status, search, plus limit/offset — the tenant is the
	// resolved one, not a filter the caller may omit into "every workspace".
	app.get("/content", async (c) => {
		const status = c.req.query("status") ?? undefined;
		const workspace = activeWorkspace(c);
		const campaignId = c.req.query("campaign_id") ?? undefined;
		const search = c.req.query("search")?.trim();
		const limit = Math.max(1, Math.min(parseInt(c.req.query("limit") ?? "100", 10) || 100, 500));
		const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);

		const { items, total } = await listDrafts({
			workspace,
			status,
			campaignId,
			search,
			limit,
			offset,
		});
		return c.json({ items, total, limit, offset });
	});

	app.get("/audit", async (c) => {
		const perWorkspaceLimit = Math.max(
			1,
			Math.min(parseInt(c.req.query("per_workspace_limit") ?? "80", 10) || 80, 200),
		);
		const limit = Math.max(1, Math.min(parseInt(c.req.query("limit") ?? "300", 10) || 300, 1000));
		// One workspace's activity, always. This used to fan out over every
		// workspace on disk whenever the caller named none, which made the audit a
		// cross-tenant read that no filter in the UI could turn off.
		const workspaces = [activeWorkspace(c)];
		const rows: AuditEntry[] = [];
		for (const name of workspaces) {
			const page = await tailActivity(name, perWorkspaceLimit);
			page.items.forEach((item, index) => {
				// SAFETY: checked to be a non-null object; it is only read by key.
				const payload = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
				const ts =
					typeof payload.t === "number"
						? payload.t
						: typeof payload.ts === "number"
							? payload.ts
							: Date.now();
				const entry = summarizeActivity(name, payload);
				rows.push({
					id: `${name}:${ts}:${index}`,
					workspace: name,
					ts,
					kind: entry.kind,
					cycle_id: entry.cycle_id,
					actor: entry.actor,
					actor_role: entry.actor_role,
					category: entry.category,
					severity: entry.severity,
					title: entry.title,
					summary: entry.summary,
					target: entry.target,
					source: entry.source,
					note: entry.note,
					payload,
				});
			});
		}
		rows.sort((a, b) => b.ts - a.ts);
		return c.json({ items: rows.slice(0, limit), total: rows.length });
	});

	return app;
}
