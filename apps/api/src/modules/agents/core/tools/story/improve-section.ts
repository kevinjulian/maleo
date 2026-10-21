import { defineTool } from "../../types.ts";
import { storyInputsOf } from "../../story-inputs.ts";
import { requiresIndex } from "../../helpers/schemas.ts";
import { improveStorySectionFlow, STORY_ASSET_OPERATIONS } from "../../services/story-assets.ts";

export const improveSection = defineTool({
	name: "improve_section",
	kind: "generate",
	builds: true,
	inspection: {
		promptMode: "composed",
		operations: STORY_ASSET_OPERATIONS.filter((operation) =>
			["operation:assets:visuals", "operation:assets:images", "operation:assets:timeline"].includes(
				operation.id,
			),
		),
	},
	contentType: ["video"],
	intents: ["edit_element", "build_story"],
	input: requiresIndex,
	description:
		'improve_section { index } - improve ONE generated section (0-based) using the existing clip as reference/context. Default for "improve section N" or "make section N more engaging": keep voiceover, timing, captions, transition, and old clip as fallback; generate only improved visual(s), then resync. If the section failed/misses assets, this retries the missing piece.',
	// `index` is already a coerced non-negative integer: `requiresIndex` requires
	// it, so the `num(args.index, -1)` this replaces could never reach its fallback.
	handler: (ctx, args) =>
		improveStorySectionFlow(
			ctx.job,
			args.index,
			storyInputsOf(ctx.job, ["approved", "research"]),
			ctx.toolCallId,
		),
});
