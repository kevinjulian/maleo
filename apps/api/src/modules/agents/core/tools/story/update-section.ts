import { defineTool } from "../../types.ts";
import { storyInputsOf } from "../../story-inputs.ts";
import { updateSectionArgs } from "../../helpers/schemas.ts";
import { updateSectionFlow } from "../../services/planning.ts";

export const updateSection = defineTool({
	name: "update_section",
	kind: "mutate",
	builds: true,
	contentType: ["video"],
	intents: ["edit_element", "build_story"],
	input: updateSectionArgs,
	description:
		"update_section { sectionId?, index?, title?, narration?, visualPrompt?, editorial? } - edit one planned section by stable id. editorial carries purpose, presentation, visualConcept, noveltyKey, optional onScreenText, and nullable sfxCue. index remains a legacy adapter. Changing narration invalidates audio; changing editorial invalidates visuals on next approval.",
	handler: async (ctx, args) => updateSectionFlow(ctx.job, args, storyInputsOf(ctx.job)),
});
