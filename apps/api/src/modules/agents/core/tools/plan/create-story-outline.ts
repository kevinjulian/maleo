import { defineTool } from "../../types.ts";
import { putJobArtifact, toolProducer } from "../../artifact-store.ts";
import { outlineArgs } from "../../helpers/schemas.ts";

export const createStoryOutline = defineTool({
	name: "create_story_outline",
	kind: "mutate",
	contentType: ["video"],
	intents: ["build_short", "build_story"],
	input: outlineArgs,
	description:
		"create_story_outline { title, body } - save a story outline / plan to the knowledge base (body = markdown)",
	handler: async (ctx, args) => {
		const job = ctx.job;
		const title = args.title ?? "Story outline";
		const art = putJobArtifact(
			job,
			"knowledge",
			{ title, body: args.body ?? "" },
			toolProducer(job, "create_story_outline"),
		);
		job.events.push({ kind: "artifact", artifact: art });
		return { note: `Saved outline "${title}" to the knowledge base` };
	},
});
