import { defineTool } from "../../types.ts";
import { emptyArgs } from "../../helpers/schemas.ts";

export const readSkill = defineTool({
	name: "read_skill",
	kind: "read",
	contentType: ["video"],
	intents: ["build_short", "build_story", "edit_element", "add_element", "research", "restyle"],
	input: emptyArgs,
	description: "read_skill {} - READ-ONLY: read the project's story format + constraints",
	handler: async (ctx) => {
		const job = ctx.job;
		return {
			note: `Format: free short-form story (${job.aspect}). Brief: ${job.brief.trim() || "(none given)"}. Constraints: continue the existing timeline, preserve visual continuity, keep voiceover concise + natural.`,
		};
	},
});
