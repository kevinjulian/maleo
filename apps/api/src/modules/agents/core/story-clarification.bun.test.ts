/* Pre-research clarification run state: eligibility, the answer transport, and
 * the idempotency the durable resume path depends on. */
import { fixtureArtifacts } from "./artifact-fixtures.ts";
import { describe, expect, test } from "bun:test";
import { storyClarificationBatchSchema, type StoryClarificationBatch } from "@maleo/shared";
import type { AgentJob } from "./model.ts";
import {
	applyClarificationAnswer,
	clarificationAnswerLabel,
	beginStoryClarification,
	claimStoryClarificationSlot,
	clarificationPlanningText,
	clarificationProvenance,
	consumeClarificationAnswer,
	decodeClarificationAnswer,
	encodeClarificationAnswer,
	recordClarificationBypass,
	requestedClarificationBypass,
	storyClarificationEligible,
	validateClarificationSubmission,
} from "./story-clarification.ts";

const batch: StoryClarificationBatch = storyClarificationBatchSchema.parse({
	id: "batch-1",
	stage: "pre_research",
	purpose: "story_brief",
	questions: [
		{
			id: "audience",
			header: "Audience",
			question: "Who is this for?",
			options: [
				{
					id: "leaders",
					label: "Team leaders",
					value: "team leaders",
					description: "Frames tradeoffs.",
					recommended: true,
				},
				{
					id: "newcomers",
					label: "Newcomers",
					value: "newcomers",
					description: "Defines terms first.",
				},
			],
		},
		{
			id: "outcome",
			header: "Viewer outcome",
			question: "What should change for the viewer?",
			options: [
				{
					id: "act",
					label: "Act",
					value: "take one action",
					description: "Ends on a concrete step.",
					recommended: true,
				},
				{
					id: "understand",
					label: "Understand",
					value: "understand the mechanism",
					description: "Ends on the explanation.",
				},
			],
		},
	],
});

function makeJob(overrides: Partial<AgentJob> = {}): AgentJob {
	return {
		id: "run-1",
		projectId: "project-1",
		contentType: "video",
		status: "running",
		events: [],
		run: {
			instruction: "make a video about tides",
			transcript: "",
			step: 0,
			builtSomething: false,
			finishRejected: false,
			asks: 0,
		},
		scenes: [],
		textOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: [],
		aspect: "9:16",
		brief: "tides",
		startedAt: Date.now(),
		...overrides,
	};
}

describe("eligibility", () => {
	test("a new video story build with no plan is eligible", () => {
		expect(
			storyClarificationEligible(makeJob(), {
				buildIntent: true,
				instruction: "make a video about tides",
			}),
		).toBe(true);
	});

	test("non-build and an existing batch are ineligible", () => {
		expect(storyClarificationEligible(makeJob(), { buildIntent: false, instruction: "x" })).toBe(
			false,
		);
		const claimed = makeJob();
		claimStoryClarificationSlot(claimed);
		expect(storyClarificationEligible(claimed, { buildIntent: true, instruction: "x" })).toBe(
			false,
		);
		// The slot is spent on a legacy single question, and says so: nothing will
		// ever transition it, so it must not be spelled like a batch still waiting.
		expect(claimed.run!.storyClarification).toEqual({ status: "generic_ask" });
	});

	test("an existing story plan makes it ineligible", () => {
		const withPlan = makeJob({
			artifacts: fixtureArtifacts("p", [
				{ kind: "story_plan", payload: { targetSec: 60, sections: [] } },
			]),
		});
		expect(storyClarificationEligible(withPlan, { buildIntent: true, instruction: "x" })).toBe(
			false,
		);
	});

	test("an explicit bypass request makes it ineligible and is classified", () => {
		expect(requestedClarificationBypass("make it, skip the questions")).toBe("skip_request");
		expect(requestedClarificationBypass("build it in one shot")).toBe("one_shot");
		expect(requestedClarificationBypass("make a video about tides")).toBeNull();
		expect(
			storyClarificationEligible(makeJob(), {
				buildIntent: true,
				instruction: "skip the questions",
			}),
		).toBe(false);
	});

	test("a generator that produced nothing is recorded as unavailable, not as the user's choice", () => {
		const job = makeJob();
		recordClarificationBypass(job, "unavailable");
		expect(clarificationProvenance(job)?.bypass).toBe("unavailable");
		// And the slot is spent, so a later one-shot tool cannot relabel it.
		recordClarificationBypass(job, "one_shot");
		expect(clarificationProvenance(job)?.bypass).toBe("unavailable");
	});

	test("a recorded bypass is provenance and is not overwritten", () => {
		const job = makeJob();
		recordClarificationBypass(job, "skip_request");
		recordClarificationBypass(job, "one_shot");
		expect(clarificationProvenance(job)).toEqual({
			stage: "pre_research",
			status: "bypassed",
			bypass: "skip_request",
			decisions: [],
		});
		expect(clarificationPlanningText(job)).toBe("");
	});
});

describe("answer transport", () => {
	test("a structured submission round-trips and a plain answer decodes to null", () => {
		const encoded = encodeClarificationAnswer({
			batchId: "batch-1",
			answers: [{ questionId: "audience", optionId: "leaders" }],
		});
		expect(decodeClarificationAnswer(encoded)).toEqual({
			batchId: "batch-1",
			answers: [{ questionId: "audience", optionId: "leaders" }],
		});
		expect(decodeClarificationAnswer("approve")).toBeNull();
		expect(decodeClarificationAnswer("story-clarification:{not json")).toBeNull();
	});
});

describe("validation before anything resolves", () => {
	const pending = (): AgentJob => {
		const job = makeJob();
		beginStoryClarification(job, batch);
		job.run!.storyClarification!.actionId = "action-1";
		return job;
	};

	test("a complete submission passes", () => {
		expect(
			validateClarificationSubmission(
				pending(),
				{
					batchId: "batch-1",
					answers: [
						{ questionId: "audience", optionId: "leaders" },
						{ questionId: "outcome", otherText: "decide whether to migrate" },
					],
				},
				"action-1",
			),
		).toEqual({ ok: true });
	});

	test("an unanswered question is incomplete and names it", () => {
		expect(
			validateClarificationSubmission(pending(), {
				batchId: "batch-1",
				answers: [{ questionId: "audience", optionId: "leaders" }],
			}),
		).toEqual({ ok: false, reason: "incomplete", missing: ["outcome"] });
	});

	test("best judgment alone is a complete answer", () => {
		expect(
			validateClarificationSubmission(pending(), { batchId: "batch-1", bestJudgment: true }),
		).toEqual({ ok: true });
	});

	test("a superseded action id and a mismatched batch id are both rejected", () => {
		expect(
			validateClarificationSubmission(
				pending(),
				{ batchId: "batch-1", bestJudgment: true },
				"action-0",
			).ok,
		).toBe(false);
		expect(
			validateClarificationSubmission(pending(), { batchId: "other", bestJudgment: true }).ok,
		).toBe(false);
	});

	test("a run with no pending batch rejects a submission", () => {
		expect(
			validateClarificationSubmission(makeJob(), { batchId: "batch-1", bestJudgment: true }),
		).toEqual({ ok: false, reason: "no_pending_batch", missing: undefined });
	});
});

describe("applying an answer", () => {
	test("accepted answers become provenance and a readable transcript line", () => {
		const job = makeJob();
		beginStoryClarification(job, batch);
		const line = applyClarificationAnswer(job, {
			batchId: "batch-1",
			answers: [
				{ questionId: "audience", optionId: "newcomers" },
				{ questionId: "outcome", otherText: "decide whether to migrate" },
			],
		});
		expect(line).toContain("Audience: newcomers");
		expect(line).toContain("decide whether to migrate");
		expect(clarificationProvenance(job)?.status).toBe("answered");
		expect(clarificationPlanningText(job)).toContain("Viewer outcome: decide whether to migrate");
	});

	test("best judgment records every unanswered question as delegated", () => {
		const job = makeJob();
		beginStoryClarification(job, batch);
		applyClarificationAnswer(job, { batchId: "batch-1", bestJudgment: true });
		const decisions = clarificationProvenance(job)!.decisions;
		expect(decisions.every((decision) => decision.source === "best_judgment")).toBe(true);
		expect(decisions.map((decision) => decision.answer)).toEqual([
			"team leaders",
			"take one action",
		]);
	});

	test("a duplicate delivery of an accepted answer applies once", () => {
		const job = makeJob();
		beginStoryClarification(job, batch);
		const encoded = encodeClarificationAnswer({ batchId: "batch-1", bestJudgment: true });
		expect(consumeClarificationAnswer(job, encoded)).not.toBe("");
		const before = JSON.stringify(clarificationProvenance(job));
		// The second delivery appends nothing: "" means handled-and-already-applied.
		expect(consumeClarificationAnswer(job, encoded)).toBe("");
		expect(JSON.stringify(clarificationProvenance(job))).toBe(before);
	});

	test("the audit label is the decision, never the wire payload", () => {
		const job = makeJob();
		beginStoryClarification(job, batch);
		const encoded = encodeClarificationAnswer({ batchId: "batch-1", bestJudgment: true });
		const applied = consumeClarificationAnswer(job, encoded);
		expect(clarificationAnswerLabel(encoded, applied)).toContain("Audience: team leaders");
		// A duplicate delivery has nothing new to say, and still must not log JSON.
		const duplicate = clarificationAnswerLabel(encoded, consumeClarificationAnswer(job, encoded));
		expect(duplicate).not.toContain("story-clarification:");
		expect(duplicate).toContain("already applied");
		// A legacy string answer is still logged verbatim.
		expect(clarificationAnswerLabel("approve", null)).toBe("approve");
	});

	test("a plain string answer is left to the legacy path", () => {
		const job = makeJob();
		beginStoryClarification(job, batch);
		expect(consumeClarificationAnswer(job, "approve")).toBeNull();
		expect(clarificationProvenance(job)).toBeUndefined();
	});

	test("an incomplete submission changes nothing", () => {
		const job = makeJob();
		beginStoryClarification(job, batch);
		expect(
			applyClarificationAnswer(job, {
				batchId: "batch-1",
				answers: [{ questionId: "audience", optionId: "leaders" }],
			}),
		).toBeNull();
		expect(job.run!.storyClarification!.status).toBe("pending");
	});

	test("the whole run state survives a JSON round-trip", () => {
		const job = makeJob();
		beginStoryClarification(job, batch);
		applyClarificationAnswer(job, { batchId: "batch-1", bestJudgment: true });
		const restored = JSON.parse(JSON.stringify(job)) as AgentJob;
		expect(restored.run!.storyClarification).toEqual(job.run!.storyClarification!);
		expect(restored.run!.storyClarification!.batch!.questions).toHaveLength(2);
	});
});
