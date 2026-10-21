/* Content catalogue + asset library routes. */
import { oneOf } from "@maleo/shared";
import type { Hono } from "hono";
import {
	deleteContentAssetReference,
	listContentAssets,
	suppressAssetRef,
	upsertContentAsset,
} from "@maleo/db/assets";
import { listContentCatalogueImages } from "../../lib/content-catalogue.ts";
import { effectiveVoiceCatalogue, ttsProviderCatalogue } from "../../lib/voice-catalogue-source.ts";
import { activeWorkspace } from "../../lib/active-workspace.ts";
import { createAssetBody } from "./request-schemas.ts";

export function registerAssetRoutes(app: Hono): void {
	app.get("/catalogue", async (c) => {
		/* Two voice lists, because two kinds of surface read this payload and they
		 * need different answers.
		 *
		 * `voices` is the EFFECTIVE provider's, and stays that way. It feeds the
		 * surfaces that BIND a voice into a stored document, where offering another
		 * provider's voice would defer the failure to render time. It also feeds
		 * the web app's `setVoiceCatalogue`, the lookup that resolves a bound
		 * speaker's description and colour BY BARE VOICE ID — so widening this
		 * field would let a speaker bound to one provider's `M1` resolve against
		 * another provider's, silently and with no error anywhere.
		 *
		 * `voice_providers` is every registered provider, for the surfaces that
		 * only BROWSE or AUDITION and bind nothing. A voice that is installed,
		 * healthy and already baked should be hearable without changing what every
		 * project renders with.
		 *
		 * (`voices` used to be a hardcoded provider list, which made this payload disagree with
		 * /api/tts/status whenever another provider was configured.) */
		const workspace = activeWorkspace(c);
		const [{ provider, ready, voices }, voiceProviders] = await Promise.all([
			effectiveVoiceCatalogue(workspace),
			ttsProviderCatalogue(workspace),
		]);
		return c.json({
			images: await listContentCatalogueImages(workspace),
			voices,
			voice_provider: provider,
			voice_provider_ready: ready,
			voice_providers: voiceProviders,
			products: [],
		});
	});

	app.get("/assets", async (c) => {
		// Client input, so it is checked rather than claimed. The assertion this
		// replaces also listed "workspace" twice — nothing was reading the union
		// closely enough for that to matter, which is the point.
		const scope = oneOf(c.req.query("scope"), ["workspace", "campaign", "project"] as const);
		const kind = c.req.query("kind") ?? undefined;
		const campaign_id = c.req.query("campaign_id") ?? undefined;
		const project_id = c.req.query("project_id") ?? undefined;
		const workspace = activeWorkspace(c);
		const limit = Math.max(1, Math.min(parseInt(c.req.query("limit") ?? "500", 10) || 500, 2000));
		return c.json({
			items: await listContentAssets({ scope, kind, campaign_id, project_id, workspace, limit }),
		});
	});

	app.post("/assets", async (c) => {
		const parsed = createAssetBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		if (!body.kind?.trim()) return c.json({ error: "kind required" }, 400);
		if (!body.label?.trim()) return c.json({ error: "label required" }, 400);
		if (!body.src?.trim()) return c.json({ error: "src required" }, 400);
		const asset = await upsertContentAsset({
			scope: body.scope ?? "workspace",
			campaign_id: typeof body.campaign_id === "string" ? body.campaign_id : null,
			project_id: typeof body.project_id === "string" ? body.project_id : null,
			// From the resolver, not the body. The body still declares the field so
			// an old client's payload parses, but naming a tenant there is how a
			// write lands in a workspace the operator is not in.
			workspace: activeWorkspace(c),
			kind: body.kind.trim(),
			label: body.label.trim(),
			tags: Array.isArray(body.tags)
				? body.tags.filter((item): item is string => typeof item === "string")
				: [],
			note: typeof body.note === "string" ? body.note : null,
			seed: typeof body.seed === "number" && Number.isFinite(body.seed) ? body.seed : 0,
			default: body.default === true,
			src: body.src.trim(),
			source_type: typeof body.source_type === "string" ? body.source_type : "manual",
			source_ref: typeof body.source_ref === "string" ? body.source_ref : null,
			collection: typeof body.collection === "string" ? body.collection : null,
			item_id: typeof body.item_id === "string" ? body.item_id : null,
			meta_json: body.meta_json && typeof body.meta_json === "object" ? body.meta_json : null,
		});
		return c.json({ ok: true, asset }, 201);
	});

	app.delete("/assets/:refId", async (c) => {
		const refId = c.req.param("refId");
		// Real delete. Suppression is recorded separately rather than as a fake asset
		// row (source_type='reference_deleted', src='__deleted_reference__'), which
		// polluted the asset table and collided with UNIQUE(source_type, source_ref).
		//
		// It is still required, not optional: listContentCatalogueImages re-derives
		// workspace-collection assets from disk on every read, so those would come back
		// on the next call without a suppression record.
		// Scoped to the active workspace. The id expansion inside matches on
		// source_ref, item_id and meta.id — none unique across tenants — so an
		// unscoped delete removed the identically-identified row in every other
		// workspace too, and the suppression then hid it for all of them.
		const workspace = activeWorkspace(c);
		const deletedIds = await deleteContentAssetReference(refId, workspace);
		for (const id of deletedIds) {
			await suppressAssetRef(id, workspace, "deleted from the reference library");
		}
		return c.json({ ok: true, deleted_ids: deletedIds });
	});
}
