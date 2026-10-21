import { styleArgs } from "../../helpers/schemas.ts";
import { defineTool, type ToolContext } from "../../types.ts";
import { retryLongformStyle } from "../../style-engine.ts";

export const generateStyle = defineTool({
	name: "generate_style",
	kind: "mutate",
	builds: true,
	inspection: {
		prompts: ["prompt:content:generateStyleBible", "prompt:constraints:lockedConstraintBlock"],
		promptMode: "composed",
		operations: [
			{
				id: "operation:generate_style:service",
				label: "Regenerate style bible while preserving plan and media",
				description: "Regenerate style bible while preserving plan and media.",
				source: "apps/api/src/modules/agents/core/tools/visual/generate-style.ts",
				conditions: [],
			},
		],
	},
	contentType: ["video"],
	intents: ["restyle", "edit_element", "build_short", "build_story"],
	input: styleArgs,
	description:
		"generate_style { brief? } - regenerate the project's visual style bible without changing scenes/sections or generating assets",
	handler: async (ctx: ToolContext, args: { brief?: string }) =>
		retryLongformStyle(ctx.job, args.brief),
});
