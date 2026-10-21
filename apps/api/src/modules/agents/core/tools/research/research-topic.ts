import { defineTool } from "../../types.ts";
import { researchTopicArgs } from "../../helpers/schemas.ts";
import { researchTopicFlow } from "../../services/research.ts";

export const researchTopic = defineTool({
	name: "research_topic",
	kind: "read",
	inspection: {
		promptMode: "none",
		operations: [
			{
				id: "operation:research_topic:service",
				label: "Bounded search, public page extraction, cited evidence bundle",
				description: "Bounded search, public page extraction, cited evidence bundle.",
				source: "apps/api/src/modules/agents/core/tools/research/research-topic.ts",
				conditions: ["Reuse matching evidence; source text is untrusted data."],
			},
		],
	},
	contentType: ["video"],
	intents: ["research"],
	input: researchTopicArgs,
	description:
		"research_topic { topic, questions?, maxSources? } - run a bounded research pass (search + read a few sources) and produce a cited Research bundle the planner can ground claims in. Optional before plan_story; a factual plan_story also enforces this automatically.",
	handler: (ctx, args) => researchTopicFlow(ctx.job, args),
});
