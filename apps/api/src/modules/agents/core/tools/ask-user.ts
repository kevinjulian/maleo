/* ask_user — clarify-before-guessing tool.
 *
 * A terminal tool: when the model calls it, the run loop SUSPENDS the job
 * (status "awaiting_input") and surfaces the question + option chips in chat.
 * The user's reply resumes the SAME job with the answer appended as an
 * observation, so loop context is preserved (Design B — true suspend/resume). */
import { z } from "zod";
import type { ToolDef } from "../types.ts";

export const askUserInput = z.object({
	question: z.string().min(1),
	// 2-4 concrete options. `value` is the exact text sent back as the answer.
	options: z
		.array(z.object({ label: z.string().min(1), value: z.string().min(1) }))
		.min(2)
		.max(4)
		.optional(),
	/* A claim that this ask is the pre-research story-brief checkpoint rather than a
	 * generic clarification. It is only ever a CLAIM: the loop grants the
	 * `ASK_LIMIT` exemption from server-side run state, so a model that marks an
	 * ordinary question `story_brief` still spends a generic ask. */
	purpose: z.literal("story_brief").optional(),
});
export type AskUserArgs = z.infer<typeof askUserInput>;

export const askUser: ToolDef<AskUserArgs> = {
	name: "ask_user",
	kind: "respond",
	intents: ["ask_clarify"],
	description:
		'ask_user { question, options?[{label,value}], purpose?:"story_brief" } - Stop and ask the user ONE question when the request is genuinely ambiguous and no sensible default exists. Give 2-4 concrete options (value = the exact answer text). Set purpose to "story_brief" ONLY when this is the pre-research clarification for a NEW story build that has no plan yet — the server verifies that from run state and applies the normal ask limit when it does not hold. Do NOT ask when the request already implies an action or an obvious default exists. The run PAUSES until the user answers, then resumes with their answer.',
	input: askUserInput,
	// Terminal: no handler — the run loop suspends the job on this tool.
};
