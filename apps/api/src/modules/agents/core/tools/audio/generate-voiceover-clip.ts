import { defineTool } from "../../types.ts";
import { recordAssetProvenance } from "../../../../../lib/agent-trace.ts";
import { voiceoverClipArgs } from "../../helpers/schemas.ts";
import { WORDS_PER_SEC, DEFAULT_VOICE } from "../../helpers/consts.ts";
import { freshClipId } from "../../helpers/ids.ts";
import { synthToUploadResult } from "../../helpers/media.ts";

export const generateVoiceoverClip = defineTool({
	name: "generate_voiceover_clip",
	kind: "generate",
	builds: true,
	inspection: {
		promptMode: "passthrough",
		operations: [
			{
				id: "operation:generate_voiceover_clip:service",
				label: "Synthesize supplied narration and place one clip that may span scenes",
				description: "Synthesize supplied narration and place one clip that may span scenes.",
				source: "apps/api/src/modules/agents/core/tools/audio/generate-voiceover-clip.ts",
				conditions: [],
			},
		],
	},
	contentType: ["video"],
	intents: ["add_element"],
	input: voiceoverClipArgs,
	description:
		"generate_voiceover_clip { text, startSec?, durationSec?, voice? } - synthesize ONE voiceover clip placed on the audio track at startSec; it may span multiple scenes (preferred for narration that runs across scenes)",
	handler: async (ctx, args) => {
		const job = ctx.job;
		const h = ctx.helpers;
		const text = args.text ?? "";
		if (!text.trim()) return { note: "No text provided to synthesize." };
		let out: { url: string; durationSec?: number };
		try {
			out = await synthToUploadResult(text, args.voice || undefined, { workspace: job.workspace });
		} catch (err) {
			throw new Error(err instanceof Error ? err.message : String(err));
		}
		// Prefer measured TTS duration; word count is only the last fallback when
		// the provider emits an unprobeable format.
		const words = text.trim().split(/\s+/).length;
		const durationSec = Math.max(
			1,
			h.num(args.durationSec, out.durationSec ?? Math.round((words / WORDS_PER_SEC) * 10) / 10),
		);
		const startSec = Math.max(0, args.startSec ?? 0);
		job.audioOverlays.push({
			id: freshClipId(),
			kind: "voiceover",
			origin: "tts",
			content: text,
			url: out.url,
			voice: args.voice ?? DEFAULT_VOICE,
			startSec,
			durationSec,
			originalDur: out.durationSec,
		});
		job.events.push({ kind: "asset_created", assetType: "audio", url: out.url });
		if (ctx.toolCallId)
			await recordAssetProvenance(job, ctx.toolCallId, {
				assetType: "audio",
				url: out.url,
				ref: `audio@${startSec}s`,
				prompt: text,
				model: args.voice ?? DEFAULT_VOICE,
			});
		return {
			note: `Placed a ${Math.round(durationSec)}s voiceover clip at ${startSec}s (spans scenes as needed).`,
			artifacts: [
				{
					kind: "audio",
					url: out.url,
					logicalRef: `audio:${job.audioOverlays.at(-1)?.id ?? startSec}`,
				},
			],
		};
	},
});
