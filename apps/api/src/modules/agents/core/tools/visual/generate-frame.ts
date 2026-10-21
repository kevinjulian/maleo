import { promptIdsFor } from "../../prompt-definitions.ts";
import { defineTool } from "../../types.ts";
import { recordAssetProvenance } from "../../../../../lib/agent-trace.ts";
import { requiresIndex } from "../../helpers/schemas.ts";
import { getStyleBible } from "../../plan-state.ts";
import { ensureVisualStyle } from "../../style-engine.ts";
import { generateSceneFrame, projectRoster, resolveSceneRefImages } from "../../visual-gen.ts";
import {
	blockOnUnresolvedReferences,
	preflightProjectReferences,
} from "../../reference-preflight.ts";

export const generateFrame = defineTool({
	name: "generate_frame",
	kind: "generate",
	builds: true,
	inspection: {
		prompts: [
			"prompt:content:generateStyleBible",
			"prompt:constraints:lockedConstraintBlock",
			"prompt:materials:visualPromptLayers",
			"prompt:materials:RULES_PREFIX",
			...promptIdsFor("image", "codexImage"),
		],
		promptMode: "composed",
		operations: [
			{
				id: "operation:generate_frame:service",
				label: "Resolve style and references, then generate image intent",
				description: "Resolve style and references, then generate image intent.",
				source: "apps/api/src/modules/agents/core/tools/visual/generate-frame.ts",
				conditions: [
					"Refuse unresolved references before paid work.",
					"Generate a style bible only when a style lock is missing.",
				],
			},
		],
	},
	contentType: ["video"],
	intents: ["build_short", "add_element", "restyle"],
	input: requiresIndex,
	description: "generate_frame { index } - generate/regenerate the image for a scene",
	handler: async (ctx, args) => {
		const job = ctx.job;
		const h = ctx.helpers;
		const i = h.index(args.index, job.scenes.length);
		const s = job.scenes[i];
		if (!s) return { note: `No scene at index ${String(args.index)}` };
		// Before the style lock, because generating a style bible is itself work the
		// operator pays for and it would be wasted on a run that cannot render its
		// cast. Reconciles legacy drift first, so only genuinely broken ids block.
		const preflight = await preflightProjectReferences(job);
		if (!preflight.ok) return { note: blockOnUnresolvedReferences(job, preflight) };
		const styleLock = await ensureVisualStyle(job, job.brief || s.visual || s.name);
		if (!styleLock.ok)
			return {
				note: `${styleLock.note ?? "Style lock failed."} Choose a global style reference or retry style generation before generating frames.`,
			};
		const refImgs = await resolveSceneRefImages(job, s);
		const url = await generateSceneFrame(
			s,
			job.aspect,
			job.styleImageUrl,
			styleLock.visualStyle ?? getStyleBible(job),
			refImgs,
			{ workspace: job.workspace, projectId: job.projectId },
			undefined,
			{ direction: job.direction, roster: await projectRoster(job.projectId) },
		);
		s.image = url;
		job.events.push({ kind: "asset_created", assetType: "image", url });
		if (ctx.toolCallId)
			await recordAssetProvenance(job, ctx.toolCallId, {
				assetType: "image",
				url,
				ref: `scene:${i + 1}`,
				prompt: s.visual,
				model: refImgs.length ? "image-service+refs" : "image-service",
			});
		// Replayable: a retry re-applies this frame from storage instead of re-billing.
		return {
			note: `Generated frame for scene ${i + 1}`,
			thumbs: [url],
			artifacts: [{ kind: "image", url, logicalRef: `scene:${i}:visual` }],
			replay: { kind: "scene_frame", index: i, url },
		};
	},
});
