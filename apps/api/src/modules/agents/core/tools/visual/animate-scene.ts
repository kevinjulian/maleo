import { defineTool } from "../../types.ts";
import { recordAssetProvenance } from "../../../../../lib/agent-trace.ts";
import { requiresIndex } from "../../helpers/schemas.ts";
import { animateFrame } from "../../visual-gen.ts";

export const animateScene = defineTool({
	name: "animate_scene",
	kind: "generate",
	builds: true,
	inspection: {
		promptMode: "passthrough",
		operations: [
			{
				id: "operation:animate_scene:service",
				label: "Submit existing frame and scene visual text for video, then place returned clip",
				description:
					"Submit existing frame and scene visual text for video, then place returned clip.",
				source: "apps/api/src/modules/agents/core/tools/visual/animate-scene.ts",
				conditions: ["Requires a frame; clip duration is capped to actual source duration."],
			},
		],
	},
	contentType: ["video"],
	intents: ["add_element"],
	input: requiresIndex,
	description:
		"animate_scene { index } - turn a scene's frame into a short video clip (needs a frame first)",
	handler: async (ctx, args) => {
		const job = ctx.job;
		const h = ctx.helpers;
		const i = h.index(args.index, job.scenes.length);
		const s = job.scenes[i];
		if (!s) return { note: `No scene at index ${String(args.index)}` };
		if (!s.image) return { note: `Scene ${i + 1} has no frame yet — generate_frame first.` };
		const start = job.scenes.slice(0, i).reduce((a, x) => a + Math.max(1, x.durationSec), 0);
		const result = await animateFrame(s.image, s.visual, s.durationSec, {
			workspace: job.workspace,
			projectId: job.projectId,
		});
		const { url } = result;
		job.videoOverlays.push({
			url,
			sourceDurationSec: result.durationSec,
			kind: "video",
			startSec: start,
			durationSec: Math.min(s.durationSec, result.durationSec),
			label: `${s.name} (video)`,
		});
		if (ctx.toolCallId)
			await recordAssetProvenance(job, ctx.toolCallId, {
				assetType: "video",
				url,
				ref: `scene:${i + 1}`,
				prompt: s.visual,
				model: result.model,
				providerId: result.providerId,
				durationSec: result.durationSec,
			});
		return { note: `Animated scene ${i + 1} into a video clip` };
	},
});
