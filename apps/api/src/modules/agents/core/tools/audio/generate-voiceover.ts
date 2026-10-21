import { defineTool } from "../../types.ts";
import { recordAssetProvenance } from "../../../../../lib/agent-trace.ts";
import { indexWithTextArgs } from "../../helpers/schemas.ts";
import { synthToUpload } from "../../helpers/media.ts";

export const generateVoiceover = defineTool({
	name: "generate_voiceover",
	kind: "generate",
	builds: true,
	inspection: {
		promptMode: "passthrough",
		operations: [
			{
				id: "operation:generate_voiceover:service",
				label: "Synthesize supplied text or scene narration and bind audio to scene",
				description: "Synthesize supplied text or scene narration and bind audio to scene.",
				source: "apps/api/src/modules/agents/core/tools/audio/generate-voiceover.ts",
				conditions: ["Empty narration is refused."],
			},
		],
	},
	contentType: ["video"],
	intents: ["add_element"],
	input: indexWithTextArgs,
	description:
		"generate_voiceover { index, text?, voice? } - synthesize voiceover for a specific scene (binds audio to that scene; text defaults to the scene's voiceover)",
	handler: async (ctx, args) => {
		const job = ctx.job;
		const h = ctx.helpers;
		const i = h.index(args.index, job.scenes.length);
		const s = job.scenes[i];
		if (!s) return { note: `No scene at index ${String(args.index)}` };
		const text = args.text || s.voiceover;
		if (!text.trim()) return { note: `Scene ${i + 1} has no voiceover text to synthesize.` };
		try {
			const voice = args.voice || undefined;
			s.audioUrl = await synthToUpload(text, voice, { workspace: job.workspace });
			job.events.push({ kind: "asset_created", assetType: "audio", url: s.audioUrl });
			if (ctx.toolCallId)
				await recordAssetProvenance(job, ctx.toolCallId, {
					assetType: "audio",
					url: s.audioUrl,
					ref: `scene:${i + 1}`,
					prompt: text,
					model: voice ?? job.voice,
				});
			return {
				note: `Generated voiceover for scene ${i + 1}`,
				artifacts: [{ kind: "audio", url: s.audioUrl, logicalRef: `scene:${i}:voiceover` }],
			};
		} catch (err) {
			throw new Error(err instanceof Error ? err.message : String(err));
		}
	},
});
