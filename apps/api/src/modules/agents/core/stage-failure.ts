/* What a stage failure means, and who acts on it.
 *
 * Every failure code names its consumer. A code nobody acts on would be
 * decoration, so none is defined without one. `retryable` has exactly one
 * consumer, `settleStageFailure`, which every pipeline caller uses:
 *
 *  - retryable → thrown. The durable host re-enters the failed stage: the Inngest
 *    step that ran it is retried, and the stage's work is reused where it already
 *    succeeded (generation reuses assets by input hash; planning resumes from its
 *    checkpoint).
 *  - not retryable → the run ends `needs_attention` with the failure's message,
 *    because another attempt would fail the same way until someone changes
 *    something. */
import type { StageFailure } from "@maleo/shared";
import type { AgentJob } from "./model.ts";

export interface FailureCode {
	/** Who raises it. */
	raisedBy: string;
	retryable: boolean;
	/** Who acts on it, and how. */
	consumer: string;
}

export const STAGE_FAILURE_CODES = {
	missing_input: {
		raisedBy: "runner — a required artifact is absent",
		retryable: false,
		consumer: "operator: the message names the next step (e.g. run plan_story first)",
	},
	input_not_ready: {
		raisedBy:
			"runner — a required artifact exists but is not ready (still in progress, or another schema version)",
		retryable: true,
		consumer: "durable host: re-enters once the input settles",
	},
	missing_output: {
		raisedBy: "runner — a stage completed without a declared, non-optional output",
		retryable: false,
		consumer: "operator and developer: a contract violation, reported as needing attention",
	},
	approval_refused: {
		raisedBy:
			"story scaffold — the plan could not be approved (direction needs review, blocker open)",
		retryable: false,
		consumer: "operator: answered through the blocker batch, then approved again",
	},
	generation_failed: {
		raisedBy: "story scaffold — asset generation reported an error",
		retryable: true,
		consumer: "durable host: re-enters; finished sections are reused by input hash",
	},
	plan_failed: {
		raisedBy: "plan stage — planning produced no plan",
		retryable: true,
		consumer: "durable host: re-enters; planning resumes from its checkpoint",
	},
	edit_failed: {
		raisedBy: "apply stage — the approved edit's tool rejected it",
		retryable: false,
		consumer: "operator: the edit's arguments need changing",
	},
} as const satisfies Record<string, FailureCode>;

export type StageFailureCode = keyof typeof STAGE_FAILURE_CODES;

/** A stage failure, its retryability taken from the code's definition. */
export function stageFailure(code: StageFailureCode, message: string): StageFailure {
	return { code, message, retryable: STAGE_FAILURE_CODES[code].retryable };
}

/** A failure the durable host should re-enter. */
export class RetryableStageError extends Error {
	constructor(readonly failure: StageFailure) {
		super(failure.message);
		this.name = "RetryableStageError";
	}
}

/** Act on a stage failure: re-enter it, or end the run needing attention. */
export function settleStageFailure(job: AgentJob, failure: StageFailure): void {
	if (failure.retryable) throw new RetryableStageError(failure);
	job.events.push({ kind: "final", text: failure.message });
	job.status = "needs_attention";
}
