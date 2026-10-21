/* Project conversation memory — what a chat command inherits from the ones
 * before it.
 *
 * Two mechanisms live here and they are deliberately different, because the
 * things they carry are known in different ways.
 *
 * A DECISION is recorded at the moment it is made. When the user answers an
 * approval or a clarification, what was settled and what they chose are both
 * unambiguous, so a typed record is written then. Nothing here ever infers a
 * decision from prose: the chat message type carries text, tool calls, progress,
 * and artifacts, and no deterministic pass can recover "the user accepted this
 * constraint" from that. Guessing it would be inference dressed as a pure
 * function, and it would be wrong silently.
 *
 * A TURN is just recent conversation, kept in a bounded window so a command can
 * read what was being discussed without inheriting an unbounded activity log.
 *
 * Current project state always outranks both. Memory says what was agreed; the
 * document says what is true. When they disagree the document wins, which is why
 * every entry keeps provenance back to the message that produced it. */
import { z } from "zod";

/* What kind of thing a decision settled.
 *
 * `approval` is a finite choice the user picked from. `clarification` is a
 * question they answered in their own words. `rejection` records a direction
 * explicitly turned down — worth its own kind because "not that" is a constraint
 * on later runs in a way that an unanswered question is not. */
export const CONVERSATION_DECISION_KINDS = ["approval", "clarification", "rejection"] as const;
export type ConversationDecisionKind = (typeof CONVERSATION_DECISION_KINDS)[number];

/* Where an entry came from. `messageId` is the chat log id the record was written
 * beside; `runId` is the agent run that asked, when a run asked at all.
 *
 * Provenance is not decoration. It is how a conflicting entry gets identified and
 * dropped when the document disagrees with it, and how a trace explains why a run
 * believed something the user does not remember saying. */
export const memoryProvenanceSchema = z.object({
	messageId: z.number(),
	runId: z.string().optional(),
});
export type MemoryProvenance = z.infer<typeof memoryProvenanceSchema>;

/* One settled decision.
 *
 * `question` is what was asked, `answer` what the user chose — both as the text
 * actually shown and submitted, so a later run reads the same words the user saw
 * rather than a paraphrase. `recordedAt` is an epoch millisecond stamp; it orders
 * entries and lets a bounded window keep the newest without consulting the
 * transcript. */
export const conversationDecisionSchema = z.object({
	kind: z.enum(CONVERSATION_DECISION_KINDS),
	question: z.string(),
	answer: z.string(),
	recordedAt: z.number(),
	provenance: memoryProvenanceSchema,
});
export type ConversationDecision = z.infer<typeof conversationDecisionSchema>;

/* A question that was asked and never answered.
 *
 * Kept separate from decisions because an open question is not a constraint. It
 * tells the next run what is still undetermined, which is the difference between
 * asking again and assuming an answer.
 *
 * No timestamp: the transcript already orders these, and `provenance.messageId`
 * is the ordering. A field this module cannot honestly fill does not go in the
 * schema just because it would look complete. */
export const unresolvedQuestionSchema = z.object({
	question: z.string(),
	provenance: memoryProvenanceSchema,
});
export type UnresolvedQuestion = z.infer<typeof unresolvedQuestionSchema>;

/* One recent conversational turn.
 *
 * Only the two roles a human would recognise as conversation. Tool calls,
 * progress events, and hidden reasoning are not turns and never become entries —
 * that exclusion is the whole point of the window. */
export const memoryTurnSchema = z.object({
	role: z.enum(["user", "assistant"]),
	text: z.string(),
	provenance: memoryProvenanceSchema,
});
export type MemoryTurn = z.infer<typeof memoryTurnSchema>;

/* What a command receives.
 *
 * Built fresh per command from live conversation state rather than read from a
 * store: the persisted copy lags behind a debounce, and the exchange that matters
 * most to the next command is usually the one that just happened. */
export const conversationMemorySchema = z.object({
	decisions: z.array(conversationDecisionSchema),
	unresolved: z.array(unresolvedQuestionSchema),
	recentTurns: z.array(memoryTurnSchema),
});
export type ConversationMemory = z.infer<typeof conversationMemorySchema>;

export const EMPTY_CONVERSATION_MEMORY: ConversationMemory = {
	decisions: [],
	unresolved: [],
	recentTurns: [],
};

/* Bounds.
 *
 * These are constants, not settings. A user cannot reason about "how many turns
 * should my agent remember", and every value that becomes configurable becomes a
 * support question and a test matrix. Prove them with fixtures and metering; move
 * them here when the evidence says to. */
export const MAX_MEMORY_DECISIONS = 24;
export const MAX_MEMORY_UNRESOLVED = 8;
export const MAX_MEMORY_RECENT_TURNS = 12;

export interface ConversationMemoryLimits {
	decisions: number;
	unresolved: number;
	recentTurns: number;
}

export const DEFAULT_MEMORY_LIMITS: ConversationMemoryLimits = {
	decisions: MAX_MEMORY_DECISIONS,
	unresolved: MAX_MEMORY_UNRESOLVED,
	recentTurns: MAX_MEMORY_RECENT_TURNS,
};

/* ── Normalization ── */

/* What the normalizer reads.
 *
 * A structural subset of the editor's chat message, not an import of it: this
 * package is pure and must not depend on the web app, and the fields that matter
 * here are the few that decide "is this conversation or is this machinery".
 *
 * The marker fields are deliberately typed `unknown`. Their presence is the whole
 * signal — a message carrying a tool call is activity no matter what shape that
 * tool call has — and typing them properly would couple this to every card the
 * editor renders. */
export interface MemorySourceMessage {
	id: number;
	role: "user" | "assistant";
	jobId?: string;
	text?: string;
	question?: { question: string; answered?: boolean };
	tool?: unknown;
	workflow?: unknown;
	note?: unknown;
	artifact?: unknown;
	outcome?: unknown;
	error?: unknown;
}

/* Machinery, not conversation.
 *
 * Tool calls, workflow plans, working notes, artifacts, delivery outcomes and
 * errors are all things the system did. They belong in the run card the user can
 * expand; they do not belong in the next command's context, where they crowd out
 * the actual conversation and grow without bound as a project ages. */
function isActivity(message: MemorySourceMessage): boolean {
	return (
		message.tool !== undefined ||
		message.workflow !== undefined ||
		message.note !== undefined ||
		message.artifact !== undefined ||
		message.outcome !== undefined ||
		message.error !== undefined
	);
}

function provenanceOf(message: MemorySourceMessage): MemoryProvenance {
	return message.jobId
		? { messageId: message.id, runId: message.jobId }
		: { messageId: message.id };
}

/** Keep the most recent `limit` entries, preserving chronological order. */
function lastN<T>(items: T[], limit: number): T[] {
	return limit >= items.length ? items : items.slice(items.length - limit);
}

/* Build what a command inherits.
 *
 * Decisions come in already typed — they were recorded when the user made them,
 * and this function passes them through rather than trying to recover them from
 * text. Turns and unresolved questions are read from the transcript, because both
 * are structurally obvious: a turn has text and no machinery, an unresolved
 * question is a question card nobody answered.
 *
 * Nothing here classifies prose. If a rule cannot be written as "this field is
 * present" or "this field is not", it does not belong in this function. */
export function normalizeConversationMemory(
	messages: MemorySourceMessage[],
	decisions: ConversationDecision[],
	limits: ConversationMemoryLimits = DEFAULT_MEMORY_LIMITS,
): ConversationMemory {
	const recentTurns: MemoryTurn[] = [];
	const unresolved: UnresolvedQuestion[] = [];

	for (const message of messages) {
		if (message.question && message.question.answered !== true) {
			unresolved.push({ question: message.question.question, provenance: provenanceOf(message) });
			continue;
		}
		if (isActivity(message)) continue;
		const text = (message.text ?? "").trim();
		if (!text) continue;
		recentTurns.push({ role: message.role, text, provenance: provenanceOf(message) });
	}

	return {
		decisions: lastN(decisions, limits.decisions),
		unresolved: lastN(unresolved, limits.unresolved),
		recentTurns: lastN(recentTurns, limits.recentTurns),
	};
}

/* Drop decisions the project has since overruled.
 *
 * Memory records what was agreed; the document records what is true. When they
 * disagree the document wins — a constraint the user set three commands ago and
 * then edited away by hand is not a constraint any more, and re-applying it would
 * undo their edit on the next run.
 *
 * The caller supplies the predicate because only it can read the document. This
 * function owns the rule, not the comparison. */
export function withoutConflictingDecisions(
	memory: ConversationMemory,
	isConflicting: (decision: ConversationDecision) => boolean,
): ConversationMemory {
	return { ...memory, decisions: memory.decisions.filter((decision) => !isConflicting(decision)) };
}
