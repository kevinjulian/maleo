/* Turning an answered question into a durable decision.
 *
 * Pure, and separate from the hook that calls it, so the rule can be tested
 * without mounting the editor — and so there is exactly one implementation of it.
 * A test that re-states the rule instead of importing it passes happily while the
 * real code drifts away from it.
 *
 * This runs at the moment the user answers, which is the only moment the meaning
 * is unambiguous. Afterwards the transcript holds prose, and prose is not a
 * decision: `ChatLogMessage` carries text, tool calls, progress and artifacts,
 * with no field that says "the user accepted this constraint". Recovering it
 * later would be inference, and inference that is wrong silently. */
import type { ConversationDecision } from "@maleo/shared";
import type { ChatLogMessage } from "./chat-log.ts";

/** Build the decision an answer settles, or null when no question matches — a
 *  missing card means there is nothing to record, never a question to invent. */
export function decisionFromAnswer(
	messages: ChatLogMessage[],
	jobId: string,
	answer: string,
	actionId?: string,
	now: number = Date.now(),
): ConversationDecision | null {
	const owner = messages.find(
		(m) =>
			m.question?.jobId === jobId && (actionId === undefined || m.question?.actionId === actionId),
	);
	const asked = owner?.question;
	if (!asked) return null;
	return {
		/* A finite set of options is an approval; anything the user answers in
		 * their own words — free text, or a clarification batch — is a
		 * clarification. The distinction matters downstream: an approval is a
		 * constraint the next run should hold, a clarification is context. */
		kind: asked.options?.length && !asked.freeText ? "approval" : "clarification",
		question: asked.question,
		answer,
		recordedAt: now,
		provenance: { messageId: owner?.id ?? 0, runId: jobId },
	};
}

/** Persist first, then expose the decision to live memory. A rejected write is
 * surfaced to the caller and cannot masquerade as durable state. */
export async function persistAcceptedDecision(
	prior: ConversationDecision[],
	decision: ConversationDecision,
	persist?: (decisions: ConversationDecision[]) => Promise<void>,
): Promise<ConversationDecision[]> {
	const next = [...prior, decision];
	await persist?.(next);
	return next;
}
