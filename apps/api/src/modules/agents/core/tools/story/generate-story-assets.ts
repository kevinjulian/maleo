import { defineTool } from "../../types.ts";
import { storyInputsOf } from "../../story-inputs.ts";
import { emptyArgs } from "../../helpers/schemas.ts";
import { generateStoryAssetsFlow, STORY_ASSET_OPERATIONS } from "../../services/story-assets.ts";

export const generateStoryAssets = defineTool({
	name: "generate_story_assets",
	kind: "generate",
	builds: true,
	reentrant: true,
	inspection: { operations: STORY_ASSET_OPERATIONS, promptMode: "composed" },
	contentType: ["video"],
	intents: ["build_story"],
	input: emptyArgs,
	description:
		"generate_story_assets {} - APPROVE step: generate voiceover + image for each planned (or failed) section, measure real audio, and build/extend the timeline to the target length. Resumable — already-ready sections are skipped. Call when the user approves the plan.",
	handler: (ctx) =>
		generateStoryAssetsFlow(
			ctx.job,
			storyInputsOf(ctx.job, ["approved", "research"]),
			ctx.toolCallId,
		),
});
