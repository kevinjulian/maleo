import { defineTool } from "../../types.ts";
import { storyInputsOf } from "../../story-inputs.ts";
import { requiresIndex } from "../../helpers/schemas.ts";
import {
	regenerateLongformSectionFlow,
	STORY_ASSET_OPERATIONS,
} from "../../services/story-assets.ts";

export const regenerateSection = defineTool({
	name: "regenerate_section",
	kind: "generate",
	builds: true,
	inspection: {
		promptMode: "composed",
		operations: STORY_ASSET_OPERATIONS.filter(
			(operation) => operation.id !== "operation:assets:extend",
		),
	},
	contentType: ["video"],
	intents: ["edit_element", "build_story"],
	input: requiresIndex,
	description:
		"regenerate_section { index } - hard redo ONE section (0-based): re-voice + re-image, remeasure, and resync. Use only when user explicitly asks to replace/rebuild from scratch.",
	// As `improve_section`: the schema already coerced and required `index`.
	handler: (ctx, args) =>
		regenerateLongformSectionFlow(
			ctx.job,
			args.index,
			storyInputsOf(ctx.job, ["approved", "research"]),
			ctx.toolCallId,
		),
});
