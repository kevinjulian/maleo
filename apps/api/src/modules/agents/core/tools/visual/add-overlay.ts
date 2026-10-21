import { promptIdsFor } from "../../prompt-definitions.ts";
import { defineTool } from "../../types.ts";
import { recordAssetProvenance } from "../../../../../lib/agent-trace.ts";
import { overlayArgs } from "../../helpers/schemas.ts";
import { DEFAULT_OVERLAY_DUR_SEC, DEFAULT_OVERLAY_LAYOUT } from "../../helpers/consts.ts";
import { freshClipId } from "../../helpers/ids.ts";
import { getStyleBible } from "../../plan-state.ts";
import { ensureVisualStyle } from "../../style-engine.ts";
import { generateSceneFrame } from "../../visual-gen.ts";
import { placeOverlay } from "../../edit-document.ts";

export const addOverlay = defineTool({
	name: "add_overlay",
	kind: "generate",
	builds: true,
	edits: true,
	inspection: {
		prompts: promptIdsFor("image", "codexImage"),
		promptMode: "composed",
		operations: [
			{
				id: "operation:add_overlay:service",
				label:
					"Resolve supplied asset or generate an image, then place overlay through editor commands",
				description:
					"Resolve supplied asset or generate an image, then place overlay through editor commands.",
				source: "apps/api/src/modules/agents/core/tools/visual/add-overlay.ts",
				conditions: ["An existing URL skips generation; a prompt generates an image."],
			},
		],
	},
	contentType: ["video"],
	intents: ["add_element"],
	input: overlayArgs,
	description:
		"add_overlay { prompt? | url?, kind?, startSec, durationSec, track?, label?, layout? } - layer a partial-frame visual (b-roll insert, sticker, product close-up) on an overlay lane ABOVE the base reel. Give a url (existing asset) or a prompt (an image is generated in the locked style). Defaults: track 1, layout {xPct:52,yPct:10,widthPct:42}. Use when a beat mentions a product, evidence, or a second subject worth showing WHILE the base scene keeps playing - layering reads richer than cutting away.",
	handler: async (ctx, args) => {
		const job = ctx.job;
		const prompt = args.prompt ?? "";
		const kind = args.kind === "video" ? ("video" as const) : ("image" as const);
		let url = args.url ?? "";
		if (!url && prompt) {
			try {
				const styleLock = await ensureVisualStyle(job, job.brief || prompt);
				url = await generateSceneFrame(
					{
						name: "Overlay",
						durationSec: 3,
						shot: "Insert",
						move: "Static",
						transition: "cut",
						visual: prompt,
						voiceover: "",
					},
					job.aspect,
					job.styleImageUrl,
					styleLock.visualStyle ?? getStyleBible(job),
					undefined,
					{ workspace: job.workspace, projectId: job.projectId },
				);
				job.events.push({ kind: "asset_created", assetType: "image", url });
				if (ctx.toolCallId)
					await recordAssetProvenance(job, ctx.toolCallId, {
						assetType: "image",
						url,
						ref: "overlay",
						prompt,
						model: job.styleImageUrl ? "image-service+styleref" : "image-service",
					});
			} catch {
				return { note: "Overlay image generation failed — retry or pass a url." };
			}
		}
		if (!url) return { note: "add_overlay needs a url or a prompt to generate from." };
		const track = Math.max(1, Math.round(args.track ?? 1));
		placeOverlay(job, "videoOverlays", {
			id: freshClipId(),
			url,
			kind,
			label: args.label || (prompt ? prompt.slice(0, 40) : "Overlay"),
			startSec: Math.max(0, args.startSec ?? 0),
			durationSec: Math.max(0.5, args.durationSec ?? DEFAULT_OVERLAY_DUR_SEC),
			// Lane 0 is the base reel; overlays default to lane 1 with a partial-frame
			// layout so they read as layered, not a replacement.
			track,
			layout: {
				...DEFAULT_OVERLAY_LAYOUT,
				...args.layout,
			},
		});
		job.events.push({ kind: "storyboard_patch" });
		return {
			note: `Layered ${kind} overlay "${args.label || prompt.slice(0, 40) || url}" on lane ${track}`,
		};
	},
});
