/* Pre-research story clarification — the run's own state, its eligibility rules,
 * and the answer transport.
 *
 * The one batch a new story build asks lives on `job.run.storyClarification`,
 * which is part of the snapshot, so it rehydrates with the run on any instance
 * with no schema migration. Eligibility is decided HERE, on the server, from run
 * state — never from a purpose the model claimed, which is why a forged
 * `purpose: "story_brief"` cannot buy an exemption from the generic ask counter. */
import {
	STORY_CLARIFICATION_STAGE,
	bypassedStoryClarification,
	checkStoryClarificationSubmission,
	clarificationPlanningBlock,
	resolveStoryClarification,
	storyClarificationSubmissionSchema,
	type StoryClarificationBatch,
	type StoryClarificationBypass,
	type StoryClarificationProvenance,
	type StoryClarificationSubmission,
} from "@maleo/shared";
import type { AgentJob } from "./model.ts";
import { getStoryPlan } from "./plan-state.ts";

export interface StoryClarificationState {
	/** The pending or accepted batch. Absent once bypassed. */
	batch?: StoryClarificationBatch;
	/* What became of this build's one pre-research slot.
	 *
	 * `generic_ask` is terminal, like `answered` and `bypassed`: the slot was spent
	 * on a single `ask_user` the model raised with story purpose, whose answer is a
	 * legacy string and produces no structured provenance. It is its own status
	 * rather than a `pending` that never resolves — a state that can never
	 * transition should not be spelled the same as one waiting to. */
	status: "pending" | "answered" | "bypassed" | "generic_ask";
	/** The required_action this batch suspended on, so a stale card is rejected. */
	actionId?: string;
	provenance?: StoryClarificationProvenance;
}

/* An explicit request to skip the questions. Kept narrow: it must be the user
 * asking, not a phrase that happens to contain "skip". */
const SKIP_REQUEST =
	/\b(skip (the )?(clarif\w+|question(s)?)|no questions|don'?t ask (me )?(any )?questions|jangan tanya|langsung saja)\b/i;
/* An explicit one-shot request — build it in one pass without the review loop. */
const ONE_SHOT_REQUEST = /\b(one[- ]shot|in one shot|without review|sekali jalan|langsung jadi)\b/i;

export function requestedClarificationBypass(instruction: string): StoryClarificationBypass | null {
	if (SKIP_REQUEST.test(instruction)) return "skip_request";
	if (ONE_SHOT_REQUEST.test(instruction)) return "one_shot";
	return null;
}

export function clarificationState(job: AgentJob): StoryClarificationState | undefined {
	return job.run?.storyClarification;
}

/** The post-research batch's state, when research raised one. */
export function postResearchClarificationState(job: AgentJob): StoryClarificationState | undefined {
	return job.run?.postResearchClarification;
}

/* Which of the two checkpoints is currently waiting for an answer.
 *
 * A run has at most one question outstanding — both checkpoints suspend the same
 * way and neither can be raised while the other is pending — so the answer
 * transport resolves the slot instead of assuming the pre-research one. Assuming
 * it is how a post-research answer would land on the pre-research batch and
 * overwrite what the user decided before research. Post-research is checked first
 * because it is the later checkpoint: by the time it is pending, the pre-research
 * slot is answered or bypassed, never pending. */
type ClarificationSlot = "storyClarification" | "postResearchClarification";

function pendingSlot(job: AgentJob): ClarificationSlot | undefined {
	if (job.run?.postResearchClarification?.status === "pending") return "postResearchClarification";
	if (job.run?.storyClarification?.status === "pending") return "storyClarification";
	return undefined;
}

/** The state of whichever checkpoint is awaiting an answer. */
export function pendingClarificationState(job: AgentJob): StoryClarificationState | undefined {
	const slot = pendingSlot(job);
	return slot ? job.run?.[slot] : undefined;
}

/** Is the ONE pre-research story batch still owed for this run?
 *
 * Every fact is read from run state: video content, a new-story build intent, no
 * existing story plan, no recorded bypass, and no batch already emitted. */
export function storyClarificationEligible(
	job: AgentJob,
	input: { buildIntent: boolean; instruction: string },
): boolean {
	if (job.contentType !== "video") return false;
	if (!input.buildIntent) return false;
	if (getStoryPlan(job)) return false;
	if (clarificationState(job)) return false;
	if (requestedClarificationBypass(input.instruction)) return false;
	return true;
}

export function recordClarificationBypass(job: AgentJob, bypass: StoryClarificationBypass): void {
	if (!job.run) return;
	// A bypass already recorded is the one that stands; the batch is one-shot state,
	// not a counter, so re-recording it must not overwrite an earlier decision.
	if (job.run.storyClarification) return;
	job.run.storyClarification = {
		status: "bypassed",
		provenance: bypassedStoryClarification(bypass),
	};
}

export function beginStoryClarification(job: AgentJob, batch: StoryClarificationBatch): void {
	if (!job.run) return;
	job.run.storyClarification = { batch, status: "pending" };
}

/* Open the post-research checkpoint. Its own slot, never the pre-research one:
 * the plan carries both provenances, and a run that overwrote the first with the
 * second would report that the user never made the decisions they made before
 * research. */
export function beginPostResearchClarification(
	job: AgentJob,
	batch: StoryClarificationBatch,
): void {
	if (!job.run) return;
	job.run.postResearchClarification = { batch, status: "pending" };
}

/** What the user decided after reading the sources. */
export function postResearchProvenance(job: AgentJob): StoryClarificationProvenance | undefined {
	return postResearchClarificationState(job)?.provenance;
}

/* Spend the one pre-research slot on a generic `ask_user` the model raised with
 * story-brief purpose. There is no batch to persist — the question is the legacy
 * single-question shape and its answer is a legacy string — but the slot is now
 * spent, so no second pre-research question can claim the same exemption. The
 * status is terminal on purpose: nothing will ever transition it, because there
 * is no structured answer coming. */
export function claimStoryClarificationSlot(job: AgentJob): void {
	if (!job.run || job.run.storyClarification) return;
	job.run.storyClarification = { status: "generic_ask" };
}

/* ── Answer transport ──
 *
 * The durable resume event carries one string, and a structured submission has to
 * ride it. Prefixed JSON keeps the legacy string answer exactly as it was: a plain
 * answer has no prefix and is handled by the path that always handled it. */
const BATCH_ANSWER_PREFIX = "story-clarification:";

export function encodeClarificationAnswer(submission: StoryClarificationSubmission): string {
	return `${BATCH_ANSWER_PREFIX}${JSON.stringify(submission)}`;
}

export function decodeClarificationAnswer(answer: string): StoryClarificationSubmission | null {
	const trimmed = answer.trim();
	if (!trimmed.startsWith(BATCH_ANSWER_PREFIX)) return null;
	try {
		const parsed = storyClarificationSubmissionSchema.safeParse(
			JSON.parse(trimmed.slice(BATCH_ANSWER_PREFIX.length)),
		);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

/** Validate a submission against the run's pending batch WITHOUT applying it —
 *  the check the answer route makes before it resolves anything. */
export function validateClarificationSubmission(
	job: AgentJob,
	submission: StoryClarificationSubmission,
	actionId?: string,
): { ok: true } | { ok: false; reason: string; missing?: string[] } {
	const state = pendingClarificationState(job);
	if (!state?.batch || state.status !== "pending") return { ok: false, reason: "no_pending_batch" };
	if (actionId && state.actionId && actionId !== state.actionId)
		return { ok: false, reason: "stale_action" };
	const check = checkStoryClarificationSubmission(state.batch, submission);
	return check.ok ? { ok: true } : { ok: false, reason: check.reason, missing: check.missing };
}

/** Apply an accepted submission to the run. Idempotent in what it RECORDS: a
 *  duplicate delivery of the same accepted answer overwrites no provenance and
 *  appends no second transcript line. It is not what stops a second resume —
 *  that is the `status !== "awaiting_input"` guard both resume paths check
 *  before they reach here. */
export function applyClarificationAnswer(
	job: AgentJob,
	submission: StoryClarificationSubmission,
): string | null {
	const slot = pendingSlot(job);
	const state = slot ? job.run?.[slot] : undefined;
	if (!slot || !state?.batch) return null;
	if (state.status !== "pending") return null;
	const check = checkStoryClarificationSubmission(state.batch, submission);
	if (!check.ok) return null;
	const provenance = resolveStoryClarification(state.batch, submission);
	job.run![slot] = { ...state, status: "answered", provenance };
	return clarificationAnswerTranscript(provenance);
}

/** Fold a resume answer into clarification state.
 *
 * Returns the transcript line to append: `null` when the answer is a plain string
 * the legacy path still owns, and `""` when it was a batch answer that had already
 * been applied — a duplicate delivery must not append a second line or resume a
 * second time. */
export function consumeClarificationAnswer(job: AgentJob, answer: string): string | null {
	const submission = decodeClarificationAnswer(answer);
	if (!submission) return null;
	return applyClarificationAnswer(job, submission) ?? "";
}

/** What to call this answer in the run's audit trail. Never the wire payload:
 *  the encoded submission is transport, and a session event that quotes it reads
 *  as JSON noise where an operator expects the decision. */
export function clarificationAnswerLabel(answer: string, applied: string | null): string {
	if (applied === null) return answer;
	return applied || "clarification answer (already applied)";
}

export function clarificationAnswerTranscript(provenance: StoryClarificationProvenance): string {
	const decisions = provenance.decisions
		.map(
			(decision) =>
				`${decision.header}: ${decision.answer}${decision.source === "best_judgment" ? " (best judgment)" : ""}`,
		)
		.join("; ");
	// Named by the checkpoint that asked. The transcript is what the decision model
	// reads on the next step, and "before research" and "after reading the sources"
	// are different things for it to know.
	const stage =
		provenance.stage === "post_research"
			? "post-research clarification"
			: "pre-research clarification";
	return `The user answered the ${stage} — ${decisions || "no decisions"}.`;
}

/** The accepted decisions as a planning block for frame and research. Empty when
 *  the run bypassed clarification or has none. */
export function clarificationPlanningText(job: AgentJob): string {
	return clarificationPlanningBlock(clarificationState(job)?.provenance);
}

export function clarificationProvenance(job: AgentJob): StoryClarificationProvenance | undefined {
	return clarificationState(job)?.provenance;
}

export { STORY_CLARIFICATION_STAGE };
