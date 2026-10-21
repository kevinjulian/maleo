import { defineTool } from "../../types.ts";
import { putJobArtifact, toolProducer } from "../../artifact-store.ts";
import { recordAssetProvenance } from "../../../../../lib/agent-trace.ts";
import { generateVoiceArgs } from "../../helpers/schemas.ts";
import { synthToUploadResult } from "../../helpers/media.ts";

export const generateVoice = defineTool({
	name: "generate_voice",
	kind: "generate",
	builds: true,
	inspection: {
		promptMode: "passthrough",
		operations: [
			{
				id: "operation:generate_voice:service",
				label: "Synthesize supplied narration into standalone media",
				description: "Synthesize supplied narration into standalone media.",
				source: "apps/api/src/modules/agents/core/tools/audio/generate-voice.ts",
				conditions: [],
			},
		],
	},
	contentType: ["video"],
	intents: ["add_element"],
	input: generateVoiceArgs,
	description:
		"generate_voice { text, voice } - synthesize a standalone voiceover clip the user can add to the timeline",
	handler: async (ctx, args) => {
		const job = ctx.job;
		const text = args.text ?? "";
		if (!text.trim()) return { note: "No text provided to synthesize." };
		let out: { url: string; durationSec?: number };
		try {
			out = await synthToUploadResult(text, args.voice || undefined, { workspace: job.workspace });
		} catch (err) {
			throw new Error(err instanceof Error ? err.message : String(err));
		}
		const art = putJobArtifact(
			job,
			"media",
			{ mediaType: "audio", url: out.url, label: text.slice(0, 48), durationSec: out.durationSec },
			toolProducer(job, "generate_voice"),
		);
		job.events.push({ kind: "artifact", artifact: art });
		if (ctx.toolCallId)
			await recordAssetProvenance(job, ctx.toolCallId, {
				assetType: "audio",
				url: out.url,
				ref: "voice-clip",
				prompt: text,
				model: args.voice || job.voice,
			});
		return {
			note: "Generated a voice clip — add it to the timeline when ready.",
			artifacts: [{ kind: "audio", url: out.url, logicalRef: "audio:standalone" }],
		};
	},
});
