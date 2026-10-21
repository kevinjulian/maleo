import { describe, expect, test } from "vite-plus/test";
import {
	bypassedStoryClarification,
	checkStoryClarificationSubmission,
	clarificationContradictions,
	clarificationPlanningBlock,
	normalizeLegacyQuestion,
	resolveStoryClarification,
	storyClarificationBatchSchema,
	storyClarificationOptionSchema,
	storyClarificationQuestionSchema,
	storyClarificationSubmissionSchema,
	verifyStoryClarification,
	type StoryClarificationBatch,
} from "./story-clarification.ts";

const option = (id: string, recommended = false) => ({
	id,
	label: `Label ${id}`,
	value: `value-${id}`,
	description: `Choosing ${id} changes the story this way.`,
	...(recommended ? { recommended: true } : {}),
});

const question = (id: string, extra: Record<string, unknown> = {}) => ({
	id,
	header: `Header ${id}`,
	question: `What about ${id}?`,
	options: [option(`${id}-a`, true), option(`${id}-b`)],
	...extra,
});

const batch = (
	questions: Array<Record<string, unknown>> = [question("q1")],
): StoryClarificationBatch =>
	storyClarificationBatchSchema.parse({
		id: "batch-1",
		stage: "pre_research",
		purpose: "story_brief",
		questions,
	});

describe("option and question schemas", () => {
	test("a well-formed option parses", () => {
		expect(storyClarificationOptionSchema.parse(option("a", true)).recommended).toBe(true);
	});

	test("an option without an impact description is rejected", () => {
		expect(
			storyClarificationOptionSchema.safeParse({ id: "a", label: "A", value: "a" }).success,
		).toBe(false);
	});

	test("a newly emitted question takes at most three options, never four", () => {
		expect(
			storyClarificationQuestionSchema.safeParse(
				question("q", { options: [option("a", true), option("b"), option("c")] }),
			).success,
		).toBe(true);
		expect(
			storyClarificationQuestionSchema.safeParse(
				question("q", { options: [option("a", true), option("b"), option("c"), option("d")] }),
			).success,
		).toBe(false);
		/* The floor of two moved to the batch, where the purpose is known: a story
		 * question still needs two (asserted below), and a blocker with no applicable
		 * remedy honestly offers one. */
		expect(
			storyClarificationQuestionSchema.safeParse(question("q", { options: [option("a", true)] }))
				.success,
		).toBe(true);
	});

	test("exactly one option is recommended", () => {
		expect(
			storyClarificationQuestionSchema.safeParse(
				question("q", { options: [option("a"), option("b")] }),
			).success,
		).toBe(false);
		expect(
			storyClarificationQuestionSchema.safeParse(
				question("q", { options: [option("a", true), option("b", true)] }),
			).success,
		).toBe(false);
	});

	test("option ids and values must be distinct", () => {
		const duplicated = { ...option("a", true), id: "same" };
		expect(
			storyClarificationQuestionSchema.safeParse(
				question("q", { options: [duplicated, { ...option("b"), id: "same" }] }),
			).success,
		).toBe(false);
		expect(
			storyClarificationQuestionSchema.safeParse(
				question("q", { options: [option("a", true), { ...option("b"), value: "value-a" }] }),
			).success,
		).toBe(false);
	});

	test("unknown keys are rejected so a silently-dropped field cannot ship", () => {
		expect(
			storyClarificationQuestionSchema.safeParse({ ...question("q"), surprise: 1 }).success,
		).toBe(false);
	});
});

describe("batch schema", () => {
	test("one to three questions", () => {
		expect(
			storyClarificationBatchSchema.safeParse({
				id: "b",
				stage: "pre_research",
				purpose: "story_brief",
				questions: [question("a")],
			}).success,
		).toBe(true);
		expect(
			storyClarificationBatchSchema.safeParse({
				id: "b",
				stage: "pre_research",
				purpose: "story_brief",
				questions: [question("a"), question("b"), question("c"), question("d")],
			}).success,
		).toBe(false);
		expect(
			storyClarificationBatchSchema.safeParse({
				id: "b",
				stage: "pre_research",
				purpose: "story_brief",
				questions: [],
			}).success,
		).toBe(false);
	});

	test("question ids must be unique", () => {
		expect(
			storyClarificationBatchSchema.safeParse({
				id: "b",
				stage: "pre_research",
				purpose: "story_brief",
				questions: [question("a"), question("a")],
			}).success,
		).toBe(false);
	});

	/* Both checkpoints share this one contract — the same batch shape, answer shape
	 * and card — so the stage names which checkpoint asked, and nothing else is a
	 * stage. The purpose stays pinned: it is what marks a batch as the story
	 * checkpoint rather than a generic ask. */
	test("stage accepts exactly the two clarification checkpoints", () => {
		expect(
			storyClarificationBatchSchema.safeParse({
				id: "b",
				stage: "pre_research",
				purpose: "story_brief",
				questions: [question("a")],
			}).success,
		).toBe(true);
		expect(
			storyClarificationBatchSchema.safeParse({
				id: "b",
				stage: "post_research",
				purpose: "story_brief",
				questions: [question("a")],
			}).success,
		).toBe(true);
		expect(
			storyClarificationBatchSchema.safeParse({
				id: "b",
				stage: "mid_draft",
				purpose: "story_brief",
				questions: [question("a")],
			}).success,
		).toBe(false);
	});

	test("purpose is pinned", () => {
		expect(
			storyClarificationBatchSchema.safeParse({
				id: "b",
				stage: "pre_research",
				purpose: "generic",
				questions: [question("a")],
			}).success,
		).toBe(false);
	});
});

describe("answer completeness", () => {
	const twoQuestions = batch([question("q1"), question("q2")]);

	test("every question answered is complete", () => {
		const submission = storyClarificationSubmissionSchema.parse({
			batchId: "batch-1",
			answers: [
				{ questionId: "q1", optionId: "q1-a" },
				{ questionId: "q2", otherText: "something else" },
			],
		});
		expect(checkStoryClarificationSubmission(twoQuestions, submission)).toEqual({ ok: true });
	});

	test("a missing question is incomplete and names what is missing", () => {
		const submission = storyClarificationSubmissionSchema.parse({
			batchId: "batch-1",
			answers: [{ questionId: "q1", optionId: "q1-a" }],
		});
		expect(checkStoryClarificationSubmission(twoQuestions, submission)).toEqual({
			ok: false,
			reason: "incomplete",
			missing: ["q2"],
		});
	});

	test("empty Other text is not an answer", () => {
		expect(
			storyClarificationSubmissionSchema.safeParse({
				batchId: "batch-1",
				answers: [{ questionId: "q1", otherText: "   " }],
			}).success,
		).toBe(false);
	});

	test("an answer carrying both an option and Other is rejected", () => {
		expect(
			storyClarificationSubmissionSchema.safeParse({
				batchId: "batch-1",
				answers: [{ questionId: "q1", optionId: "q1-a", otherText: "x" }],
			}).success,
		).toBe(false);
	});

	test("best judgment resolves the unanswered remainder", () => {
		const submission = storyClarificationSubmissionSchema.parse({
			batchId: "batch-1",
			bestJudgment: true,
		});
		expect(checkStoryClarificationSubmission(twoQuestions, submission)).toEqual({ ok: true });
	});

	test("a mismatched batch id never resolves", () => {
		const submission = storyClarificationSubmissionSchema.parse({
			batchId: "other",
			bestJudgment: true,
		});
		expect(checkStoryClarificationSubmission(twoQuestions, submission)).toEqual({
			ok: false,
			reason: "batch_mismatch",
		});
	});

	test("unknown question and option ids are rejected", () => {
		expect(
			checkStoryClarificationSubmission(twoQuestions, {
				batchId: "batch-1",
				answers: [{ questionId: "nope", optionId: "q1-a" }],
			}).ok,
		).toBe(false);
		expect(
			checkStoryClarificationSubmission(twoQuestions, {
				batchId: "batch-1",
				answers: [{ questionId: "q1", optionId: "nope" }],
			}).ok,
		).toBe(false);
	});

	test("Other on a question that forbids it is rejected", () => {
		const noOther = batch([question("q1", { allowOther: false })]);
		expect(
			checkStoryClarificationSubmission(noOther, {
				batchId: "batch-1",
				answers: [{ questionId: "q1", otherText: "x" }],
			}).ok,
		).toBe(false);
	});
});

describe("resolution and provenance", () => {
	test("option, other and delegated answers each record their source", () => {
		const three = batch([question("q1"), question("q2"), question("q3")]);
		const provenance = resolveStoryClarification(three, {
			batchId: "batch-1",
			bestJudgment: true,
			answers: [
				{ questionId: "q1", optionId: "q1-b" },
				{ questionId: "q2", otherText: "a specific audience" },
			],
		});
		expect(provenance.status).toBe("answered");
		expect(provenance.decisions.map((decision) => decision.source)).toEqual([
			"option",
			"other",
			"best_judgment",
		]);
		expect(provenance.decisions[0]!.answer).toBe("value-q1-b");
		expect(provenance.decisions[2]!.answer).toBe("value-q3-a");
		expect(provenance.decisions.every((decision) => decision.status === "supplied")).toBe(true);
	});

	test("the planning block lists decisions and is empty for a bypass", () => {
		const provenance = resolveStoryClarification(batch(), {
			batchId: "batch-1",
			answers: [{ questionId: "q1", optionId: "q1-a" }],
		});
		expect(clarificationPlanningBlock(provenance)).toContain("Header q1: value-q1-a");
		expect(clarificationPlanningBlock(bypassedStoryClarification("one_shot"))).toBe("");
	});

	test("a checkable decision the plan disagrees with is reported as contradicted, not applied", () => {
		const tagged = batch([
			question("lang", {
				field: "language",
				options: [
					{ ...option("lang-a", true), value: "en" },
					{ ...option("lang-b"), value: "id" },
				],
			}),
		]);
		const provenance = resolveStoryClarification(tagged, {
			batchId: "batch-1",
			answers: [{ questionId: "lang", optionId: "lang-b" }],
		});
		const verified = verifyStoryClarification(provenance, { language: "en" });
		expect(verified.decisions[0]!.status).toBe("contradicted");
		expect(verified.decisions[0]!.planValue).toBe("en");
		expect(clarificationContradictions(verified)).toHaveLength(1);
		const honored = verifyStoryClarification(provenance, { language: "id" });
		expect(honored.decisions[0]!.status).toBe("honored");
		expect(clarificationContradictions(honored)).toHaveLength(0);
	});

	test("an unverifiable decision stays supplied and is never claimed honored", () => {
		const provenance = resolveStoryClarification(batch(), {
			batchId: "batch-1",
			answers: [{ questionId: "q1", optionId: "q1-a" }],
		});
		expect(
			verifyStoryClarification(provenance, { language: "en", planKind: "story" }).decisions[0]!
				.status,
		).toBe("supplied");
	});
});

describe("legacy read boundary", () => {
	test("a persisted four-option question still normalizes", () => {
		const normalized = normalizeLegacyQuestion({
			question: "Which aspect ratio?",
			options: [
				{ label: "9:16", value: "9:16" },
				{ label: "1:1", value: "1:1" },
				{ label: "16:9", value: "16:9" },
				{ label: "4:5", value: "4:5" },
			],
		});
		expect(normalized?.options).toHaveLength(4);
	});

	test("a free-text revision prompt keeps its flag", () => {
		const normalized = normalizeLegacyQuestion({
			question: "Rejected. Tell me what to change.",
			options: [
				{ label: "Approve anyway", value: "approve" },
				{ label: "Research again", value: "research again" },
			],
			freeText: true,
		});
		expect(normalized?.freeText).toBe(true);
		expect(normalized?.options).toHaveLength(2);
	});

	test("a question with no options normalizes", () => {
		expect(normalizeLegacyQuestion({ question: "What now?" })).toEqual({ question: "What now?" });
	});

	test("a non-question payload returns null", () => {
		expect(normalizeLegacyQuestion({ nope: true })).toBeNull();
		expect(normalizeLegacyQuestion(null)).toBeNull();
	});
});

/* The planning block goes into a prompt, so its heading is an instruction to the
 * writer — and the two stages instruct differently. */
describe("the planning block names the stage that asked", () => {
	const decisions = [
		{
			questionId: "q1",
			header: "Case study",
			question: "Which fund?",
			answer: "the Ohio fund",
			source: "option" as const,
			status: "supplied" as const,
		},
	];

	test("pre-research decisions are marked as decided before framing", () => {
		const block = clarificationPlanningBlock({
			batchId: "b",
			stage: "pre_research",
			status: "answered",
			decisions,
		});

		expect(block).toContain("before framing");
		expect(block).toContain("Case study: the Ohio fund");
	});

	test("post-research decisions are marked as decided after reading the sources", () => {
		const block = clarificationPlanningBlock({
			batchId: "b",
			stage: "post_research",
			status: "answered",
			decisions,
		});

		expect(block).toContain("after reading the retrieved sources");
		expect(block).not.toContain("before framing");
	});

	test("an answer resolved from a post-research batch carries that stage", () => {
		const posted = { ...batch([question("case")]), stage: "post_research" as const };

		const provenance = resolveStoryClarification(posted, {
			batchId: posted.id,
			answers: [{ questionId: "case", optionId: "case-a" }],
		});

		expect(provenance.stage).toBe("post_research");
		expect(clarificationPlanningBlock(provenance)).toContain("after reading the retrieved sources");
	});
});

/* ── The second purpose: one question per open blocker ── */

const blockerQuestion = (
	id: string,
	options = [option(`${id}-fix`, true), option(`${id}-leave`)],
) => ({
	id,
	header: `Header ${id}`,
	question: `What about ${id}?`,
	options,
});

const blockerBatch = (questions: Array<Record<string, unknown>>) => ({
	id: "blockers-1",
	stage: "pre_generation",
	purpose: "blocker",
	questions,
});

describe("blocker resolution batch", () => {
	test("carries one question per blocker, past the story cap", () => {
		const questions = [1, 2, 3, 4, 5].map((n) => blockerQuestion(`b${n}`));
		const parsed = storyClarificationBatchSchema.parse(blockerBatch(questions));
		expect(parsed.questions).toHaveLength(5);
	});

	test("a story batch is still capped at three", () => {
		expect(
			storyClarificationBatchSchema.safeParse({
				id: "batch-1",
				stage: "pre_research",
				purpose: "story_brief",
				questions: [question("q1"), question("q2"), question("q3"), question("q4")],
			}).success,
		).toBe(false);
	});

	test("a blocker with no applicable remedy may offer one option", () => {
		const parsed = storyClarificationBatchSchema.parse(
			blockerBatch([blockerQuestion("b1", [option("b1-leave", true)])]),
		);
		expect(parsed.questions[0]!.options).toHaveLength(1);
	});

	test("a story question still needs two options", () => {
		expect(
			storyClarificationBatchSchema.safeParse({
				id: "batch-1",
				stage: "pre_research",
				purpose: "story_brief",
				questions: [{ ...question("q1"), options: [option("q1-a", true)] }],
			}).success,
		).toBe(false);
	});

	test("purpose and stage must agree", () => {
		expect(
			storyClarificationBatchSchema.safeParse({
				...blockerBatch([blockerQuestion("b1")]),
				stage: "pre_research",
			}).success,
		).toBe(false);
		expect(
			storyClarificationBatchSchema.safeParse({
				id: "batch-1",
				stage: "pre_generation",
				purpose: "story_brief",
				questions: [question("q1")],
			}).success,
		).toBe(false);
	});

	test("every blocker needs an answer", () => {
		const parsed = storyClarificationBatchSchema.parse(
			blockerBatch([blockerQuestion("b1"), blockerQuestion("b2")]),
		);
		const partial = storyClarificationSubmissionSchema.parse({
			batchId: "blockers-1",
			answers: [{ questionId: "b1", optionId: "b1-fix" }],
		});
		expect(checkStoryClarificationSubmission(parsed, partial)).toEqual({
			ok: false,
			reason: "incomplete",
			missing: ["b2"],
		});
		const complete = storyClarificationSubmissionSchema.parse({
			batchId: "blockers-1",
			answers: [
				{ questionId: "b1", optionId: "b1-fix" },
				{ questionId: "b2", optionId: "b2-leave" },
			],
		});
		expect(checkStoryClarificationSubmission(parsed, complete)).toEqual({ ok: true });
	});

	test("best judgment does not answer blockers", () => {
		const parsed = storyClarificationBatchSchema.parse(blockerBatch([blockerQuestion("b1")]));
		const delegated = storyClarificationSubmissionSchema.parse({
			batchId: "blockers-1",
			bestJudgment: true,
		});
		expect(checkStoryClarificationSubmission(parsed, delegated).ok).toBe(false);
	});
});
