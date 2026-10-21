/* Planning driven directly, the way tests used to call `planStoryFlow`: the
 * planning core on the engine, keyed by one tool-call id so an answer resumes the
 * same flow record. */
import type { z } from "zod";
import { runToolFlow } from "../../engine/host.ts";
import { planningRegistry } from "../../engine/planning/registry.ts";
import type { planStoryArgs } from "../../helpers/schemas.ts";
import type { AgentJob } from "../../model.ts";

export const PLANNING_CALL = "test-plan-story";

export async function planStory(
	job: AgentJob,
	args: z.input<typeof planStoryArgs>,
	options: { answer?: string; toolCallId?: string } = {},
): Promise<{ note: string; ok: boolean; suspended?: true }> {
	const result = await runToolFlow({
		registry: planningRegistry(),
		job,
		toolCallId: options.toolCallId ?? PLANNING_CALL,
		workflow: "plan_story_core",
		input: { args },
		answer: options.answer,
	});
	if (result.status === "suspended")
		return { note: result.question.note ?? result.question.question, ok: true, suspended: true };
	if (result.status === "cancelled") return { note: "cancelled", ok: false };
	if (!result.outcome.ok) throw new Error(result.outcome.note);
	return { note: result.outcome.note, ok: true };
}
