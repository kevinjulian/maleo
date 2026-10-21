/* Which emotions the current project's plan actually calls for.
 *
 * The timeline template is workspace-scoped and knows nothing about any one
 * project, but an operator editing its per-emotion music needs to know which of the
 * ten emotions this plan will ever ask for — tuning `chaos` for a calm documentary
 * is wasted effort. Reading it from the chat log keeps that knowledge at the call
 * site instead of coupling the template editor to project state. */

import { payloadOfKind, storyPlanArtifact } from "@maleo/shared";
import type { Emotion } from "@maleo/shared";
import type { ChatLogMessage } from "./chat-log.ts";

/** Distinct emotions across the most recent story plan, in the order they first
 *  appear, so the list reads as the narrative arc rather than an alphabetical set.
 *  Empty when there is no plan yet, or when the plan predates recorded emotions. */
export function planEmotions(messages: readonly ChatLogMessage[]): Emotion[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		const plan = payloadOfKind(messages[i]?.artifact, storyPlanArtifact);
		if (!plan) continue;
		const seen: Emotion[] = [];
		for (const section of plan.sections) {
			if (section.emotion && !seen.includes(section.emotion)) seen.push(section.emotion);
		}
		return seen;
	}
	return [];
}
