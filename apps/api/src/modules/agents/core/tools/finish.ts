/* finish — terminal tool ending a run. Handled directly by the run loop (no
 * handler); registered so it renders in the prompt and validates in the enum. */
import { defineTool } from "../types.ts";
import { finishArgs } from "../helpers/schemas.ts";

export const finishTool = defineTool({
	name: "finish",
	kind: "respond",
	intents: [
		"build_short",
		"build_story",
		"edit_element",
		"add_element",
		"research",
		"restyle",
		"ask_clarify",
		"finish",
	],
	input: finishArgs,
	description: 'finish { say } - stop; "say" is a short natural summary of what you did',
});
