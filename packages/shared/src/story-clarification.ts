/* Pre-research story clarification — the one batch of questions a new story build
 * answers before framing or research begins.
 *
 * This is the contract, declared once for the agent that emits a batch, the API
 * that persists and validates its answers, and the editor that renders it. It is
 * pure: schemas, resolution, and the provenance the story plan carries afterwards.
 *
 * Two bounds live here and they are deliberately different. A NEWLY EMITTED
 * question carries two or three options, because a batch of three questions with
 * four options each is a form, not a clarification. A PERSISTED legacy
 * single-question action carries two to four, because that is what the old
 * `ask_user` contract emitted and those actions still have to rehydrate. Narrowing
 * the read boundary to match the write boundary would strand them. */
import { z } from "zod";

/* The two points a clarification batch can occupy.
 *
 * `pre_research` is the one a new story build asks before framing: what the user
 * wants. `post_research` is asked only when completed research exposed an
 * editorial fork the sources themselves cannot settle — which case study, which
 * side of a source conflict, what to do with a requested claim nothing supports.
 * They are the same contract deliberately: one batch shape, one answer shape, one
 * card, so the second checkpoint costs no second UI and no second transport. */
export const STORY_CLARIFICATION_STAGES = [
	"pre_research",
	"post_research",
	"pre_generation",
] as const;
export type StoryClarificationStage = (typeof STORY_CLARIFICATION_STAGES)[number];

/** The stage a batch asked before frame and research occupies. */
export const STORY_CLARIFICATION_STAGE = "pre_research" as const;
/** The stage a batch asked after research, before skeleton, occupies. */
export const POST_RESEARCH_CLARIFICATION_STAGE = "post_research" as const;
/** What marks a batch as the story-brief checkpoint rather than a generic ask. */
export const STORY_CLARIFICATION_PURPOSE = "story_brief" as const;

/* The second purpose this contract serves: every blocker the project still has,
 * answered together.
 *
 * Blockers reuse the batch rather than getting a widget of their own, because the
 * card already holds N decisions, submits once, and refuses a partial answer —
 * which is exactly what "fix one, keep the rest" needs. What differs is attached
 * to the purpose below, not forked into a second schema: the question cap, the
 * option floor, and whether a run is parked. */
export const BLOCKER_RESOLUTION_PURPOSE = "blocker" as const;
/** The point a blocker batch occupies: before anything else is generated. */
export const BLOCKER_RESOLUTION_STAGE = "pre_generation" as const;

export const STORY_CLARIFICATION_PURPOSES = [
	STORY_CLARIFICATION_PURPOSE,
	BLOCKER_RESOLUTION_PURPOSE,
] as const;
export type StoryClarificationPurpose = (typeof STORY_CLARIFICATION_PURPOSES)[number];

export const MAX_STORY_CLARIFICATION_QUESTIONS = 3;
/* A blocker batch is as long as the project's blocker list, and capping it would
 * hide the ones past the cap — the exact failure this change exists to end. It is
 * bounded only against a runaway payload. */
export const MAX_BLOCKER_QUESTIONS = 25;
export const MIN_STORY_CLARIFICATION_OPTIONS = 2;
export const MAX_STORY_CLARIFICATION_OPTIONS = 3;
/** What a persisted legacy single question is still allowed to carry. */
export const MAX_LEGACY_QUESTION_OPTIONS = 4;

/* ── Emission contract ── */

/* A retrieved source an option rests on. Present only on a post-research option,
 * and only ever a source the held research bundle actually contains — an option
 * that cites something the run never retrieved is evidence of a model inventing
 * support, so it is rejected upstream rather than rendered. Title and URL only:
 * the excerpt is untrusted retrieved text and has no business in a UI label. */
/* The URL is rendered as a link's `href`, and both the title and the URL trace
 * back to a crawled page — attacker-influenced text. `rel="noopener"` on the
 * anchor does nothing about the scheme, and a `javascript:` href executes in the
 * editor's own origin when clicked, so the scheme is checked HERE: the boundary
 * every batch crosses, server-side, rather than in the card that renders it. */
const HTTP_URL = /^https?:\/\/./i;

export const storyClarificationSourceSchema = z
	.object({
		title: z.string().trim().min(1).max(160),
		url: z
			.string()
			.trim()
			.min(1)
			.max(2048)
			.refine((value) => HTTP_URL.test(value) && URL.canParse(value), {
				message: "a source url must be an absolute http(s) URL",
			}),
	})
	.strict();
export type StoryClarificationSource_ = z.infer<typeof storyClarificationSourceSchema>;

export const MAX_STORY_CLARIFICATION_OPTION_SOURCES = 3;

export const storyClarificationOptionSchema = z
	.object({
		id: z.string().trim().min(1).max(64),
		label: z.string().trim().min(1).max(80),
		/** The exact answer text recorded when this option is chosen. */
		value: z.string().trim().min(1).max(200),
		/** Why this choice changes the story — one short sentence, never decoration. */
		description: z.string().trim().min(1).max(240),
		recommended: z.boolean().optional(),
		/** The retrieved sources this option rests on (post-research only). */
		sources: z
			.array(storyClarificationSourceSchema)
			.max(MAX_STORY_CLARIFICATION_OPTION_SOURCES)
			.optional(),
	})
	.strict();
export type StoryClarificationOption = z.infer<typeof storyClarificationOptionSchema>;

/* A structurally checkable decision. Most clarification is editorial and cannot
 * be verified against a drafted plan, so `field` is absent and the decision is
 * reported as SUPPLIED to planning rather than claimed as applied. When it is
 * present the option's `value` is the canonical value that field must hold, and a
 * plan that disagrees is reported as a contradiction. */
export const STORY_CLARIFICATION_FIELDS = ["language", "plan_kind"] as const;
export type StoryClarificationField = (typeof STORY_CLARIFICATION_FIELDS)[number];

export const storyClarificationQuestionSchema = z
	.object({
		id: z.string().trim().min(1).max(64),
		/** Two or three words naming the decision, for the card's group label. */
		header: z.string().trim().min(1).max(40),
		question: z.string().trim().min(1).max(400),
		/* The floor is one, not two, because a blocker with no applicable remedy
		 * honestly offers one choice — leave it as is — beside the free-form Other the
		 * card always renders. A story question is held to two by the batch rule below,
		 * where the purpose is known. */
		options: z.array(storyClarificationOptionSchema).min(1).max(MAX_STORY_CLARIFICATION_OPTIONS),
		field: z.enum(STORY_CLARIFICATION_FIELDS).optional(),
		/** Free-form Other is offered by default; a question may opt out. */
		allowOther: z.boolean().optional(),
	})
	.strict()
	.superRefine((question, ctx) => {
		const recommended = question.options.filter((option) => option.recommended).length;
		if (recommended !== 1) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["options"],
				message: "exactly one option must be recommended",
			});
		}
		if (new Set(question.options.map((option) => option.id)).size !== question.options.length) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["options"],
				message: "option ids must be unique",
			});
		}
		if (
			new Set(question.options.map((option) => option.value.toLowerCase())).size !==
			question.options.length
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["options"],
				message: "option values must be mutually exclusive",
			});
		}
	});
export type StoryClarificationQuestion = z.infer<typeof storyClarificationQuestionSchema>;

export const storyClarificationBatchSchema = z
	.object({
		id: z.string().trim().min(1).max(64),
		stage: z.enum(STORY_CLARIFICATION_STAGES),
		purpose: z.enum(STORY_CLARIFICATION_PURPOSES),
		questions: z.array(storyClarificationQuestionSchema).min(1).max(MAX_BLOCKER_QUESTIONS),
		/** Shown above the groups; the batch's one sentence of context. */
		intro: z.string().trim().max(400).optional(),
	})
	.strict()
	.superRefine((batch, ctx) => {
		if (new Set(batch.questions.map((question) => question.id)).size !== batch.questions.length) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["questions"],
				message: "question ids must be unique",
			});
		}
		const blockers = batch.purpose === BLOCKER_RESOLUTION_PURPOSE;
		if (blockers && batch.stage !== BLOCKER_RESOLUTION_STAGE) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["stage"],
				message: "a blocker batch occupies the pre_generation stage",
			});
		}
		if (!blockers && batch.stage === BLOCKER_RESOLUTION_STAGE) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["stage"],
				message: "pre_generation is the blocker batch stage",
			});
		}
		if (!blockers && batch.questions.length > MAX_STORY_CLARIFICATION_QUESTIONS) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["questions"],
				message: `a story clarification batch asks at most ${MAX_STORY_CLARIFICATION_QUESTIONS} questions`,
			});
		}
		if (!blockers) {
			for (const [index, question] of batch.questions.entries()) {
				if (question.options.length < MIN_STORY_CLARIFICATION_OPTIONS) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						path: ["questions", index, "options"],
						message: `a story clarification question offers at least ${MIN_STORY_CLARIFICATION_OPTIONS} options`,
					});
				}
			}
		}
	});
export type StoryClarificationBatch = z.infer<typeof storyClarificationBatchSchema>;

/* ── Answer contract ── */

export const storyClarificationAnswerSchema = z
	.object({
		questionId: z.string().trim().min(1),
		optionId: z.string().trim().min(1).optional(),
		/** Free-form answer. Empty text is not an answer; it is an unanswered question
		 * wearing an answer's shape, so it is rejected rather than silently delegated. */
		otherText: z.string().trim().min(1).max(400).optional(),
	})
	.strict()
	.superRefine((answer, ctx) => {
		const chosen = [answer.optionId, answer.otherText].filter(
			(value) => value !== undefined,
		).length;
		if (chosen !== 1) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "answer must carry exactly one of optionId or otherText",
			});
		}
	});
export type StoryClarificationAnswer = z.infer<typeof storyClarificationAnswerSchema>;

export const storyClarificationSubmissionSchema = z
	.object({
		batchId: z.string().trim().min(1),
		/** One batch-level escape: every unanswered question is delegated. */
		bestJudgment: z.boolean().optional(),
		answers: z.array(storyClarificationAnswerSchema).max(MAX_BLOCKER_QUESTIONS).optional(),
	})
	.strict();
export type StoryClarificationSubmission = z.infer<typeof storyClarificationSubmissionSchema>;

export type StoryClarificationCheck =
	| { ok: true }
	| {
			ok: false;
			reason:
				| "batch_mismatch"
				| "unknown_question"
				| "unknown_option"
				| "duplicate_answer"
				| "incomplete";
			missing?: string[];
	  };

/** Is this submission a complete answer to this batch? Every question needs an
 *  option, a non-empty Other, or batch-level delegation — nothing else resolves
 *  the action. */
export function checkStoryClarificationSubmission(
	batch: StoryClarificationBatch,
	submission: StoryClarificationSubmission,
): StoryClarificationCheck {
	if (submission.batchId !== batch.id) return { ok: false, reason: "batch_mismatch" };
	const answers = submission.answers ?? [];
	const seen = new Set<string>();
	for (const answer of answers) {
		const question = batch.questions.find((candidate) => candidate.id === answer.questionId);
		if (!question) return { ok: false, reason: "unknown_question" };
		if (seen.has(answer.questionId)) return { ok: false, reason: "duplicate_answer" };
		seen.add(answer.questionId);
		if (answer.optionId && !question.options.some((option) => option.id === answer.optionId)) {
			return { ok: false, reason: "unknown_option" };
		}
		if (answer.otherText !== undefined && question.allowOther === false) {
			return { ok: false, reason: "unknown_option" };
		}
	}
	/* Delegation is a story-clarification escape: "you decide" answers an editorial
	 * fork, and it does not answer a blocker. A blocker's escape is per blocker —
	 * leave that one as is — so the batch-level one is refused here rather than
	 * quietly resolving every blocker at once. */
	if (submission.bestJudgment && batch.purpose === BLOCKER_RESOLUTION_PURPOSE) {
		return { ok: false, reason: "unknown_option" };
	}
	if (submission.bestJudgment) return { ok: true };
	const missing = batch.questions
		.filter((question) => !seen.has(question.id))
		.map((question) => question.id);
	return missing.length ? { ok: false, reason: "incomplete", missing } : { ok: true };
}

/* ── Provenance ── */

export const STORY_CLARIFICATION_SOURCES = ["option", "other", "best_judgment"] as const;
export type StoryClarificationSource = (typeof STORY_CLARIFICATION_SOURCES)[number];

/* `supplied` is the honest default: the decision reached frame and research, and
 * nothing structural can confirm the drafted plan honored it. Only a decision
 * carrying a `field` can be verified, and only that decision can be reported as
 * honored or contradicted. */
export const STORY_DECISION_STATUSES = ["supplied", "honored", "contradicted"] as const;
export type StoryDecisionStatus = (typeof STORY_DECISION_STATUSES)[number];

export interface StoryClarificationDecision {
	questionId: string;
	header: string;
	question: string;
	answer: string;
	source: StoryClarificationSource;
	field?: StoryClarificationField;
	status: StoryDecisionStatus;
	/** What the plan actually holds, when it contradicts a checkable decision. */
	planValue?: string;
}

/* Why no batch was asked. `skip_request` and `one_shot` are the user's choice;
 * `unavailable` is the system's own — the generator produced no questions, and
 * the build went ahead ungated. It is recorded rather than left blank because a
 * plan with no clarification provenance and a plan whose clarification could not
 * run are different things, and only one of them is the user's decision. */
export const STORY_CLARIFICATION_BYPASSES = ["skip_request", "one_shot", "unavailable"] as const;
export type StoryClarificationBypass = (typeof STORY_CLARIFICATION_BYPASSES)[number];

export interface StoryClarificationProvenance {
	batchId?: string;
	stage: StoryClarificationStage;
	status: "answered" | "bypassed";
	bypass?: StoryClarificationBypass;
	decisions: StoryClarificationDecision[];
}

/** Turn an accepted submission into typed decisions. Unanswered questions are
 *  recorded as delegated rather than dropped, so the plan's provenance shows what
 *  the user chose AND what they left to the system. */
export function resolveStoryClarification(
	batch: StoryClarificationBatch,
	submission: StoryClarificationSubmission,
): StoryClarificationProvenance {
	const answers = submission.answers ?? [];
	const decisions = batch.questions.map<StoryClarificationDecision>((question) => {
		const answer = answers.find((candidate) => candidate.questionId === question.id);
		const option = answer?.optionId
			? question.options.find((candidate) => candidate.id === answer.optionId)
			: undefined;
		if (option)
			return {
				questionId: question.id,
				header: question.header,
				question: question.question,
				answer: option.value,
				source: "option",
				field: question.field,
				status: "supplied",
			};
		if (answer?.otherText)
			return {
				questionId: question.id,
				header: question.header,
				question: question.question,
				answer: answer.otherText,
				source: "other",
				field: question.field,
				status: "supplied",
			};
		const recommended =
			question.options.find((candidate) => candidate.recommended) ?? question.options[0]!;
		return {
			questionId: question.id,
			header: question.header,
			question: question.question,
			answer: recommended.value,
			source: "best_judgment",
			field: question.field,
			status: "supplied",
		};
	});
	// The batch's own stage, not a constant: a plan carries both checkpoints'
	// provenance, and "what the user decided" is a different claim depending on
	// whether they decided it before the sources existed or after reading them.
	return { batchId: batch.id, stage: batch.stage, status: "answered", decisions };
}

export function bypassedStoryClarification(
	bypass: StoryClarificationBypass,
): StoryClarificationProvenance {
	return { stage: STORY_CLARIFICATION_STAGE, status: "bypassed", bypass, decisions: [] };
}

/** The decisions as a planning block. Supplied BESIDE the original request — it
 *  never replaces the brief, which stays exactly as the user wrote it. */
export function clarificationPlanningBlock(
	provenance: StoryClarificationProvenance | undefined,
): string {
	if (!provenance || provenance.status !== "answered" || !provenance.decisions.length) return "";
	const lines = provenance.decisions.map(
		(decision) =>
			`- ${decision.header}: ${decision.answer}${decision.source === "best_judgment" ? " (delegated — chosen for the user)" : ""}`,
	);
	/* The heading comes from the stage that asked, because the block goes into a
	 * prompt and the two stages are different instructions to the writer. A
	 * post-research decision was made with the sources in front of the user — it
	 * settles what the evidence could not — and labelling it "before framing" tells
	 * the drafter the opposite of what happened. */
	const when =
		provenance.stage === "post_research"
			? "chosen by the user after reading the retrieved sources"
			: "answered by the user before framing";
	return `Clarified planning decisions (${when}):\n${lines.join("\n")}`;
}

/** Check the drafted plan against the decisions that can actually be checked.
 *  Returns a new provenance; nothing is claimed applied that was not verified. */
export function verifyStoryClarification(
	provenance: StoryClarificationProvenance,
	plan: { language?: string; planKind?: string },
): StoryClarificationProvenance {
	const planValueFor = (field: StoryClarificationField): string | undefined =>
		field === "language" ? plan.language : plan.planKind;
	return {
		...provenance,
		decisions: provenance.decisions.map((decision) => {
			if (!decision.field) return decision;
			const actual = planValueFor(decision.field);
			if (!actual) return decision;
			const honored = actual.trim().toLowerCase() === decision.answer.trim().toLowerCase();
			return honored
				? { ...decision, status: "honored" as const }
				: { ...decision, status: "contradicted" as const, planValue: actual };
		}),
	};
}

export function clarificationContradictions(
	provenance: StoryClarificationProvenance | undefined,
): StoryClarificationDecision[] {
	return (provenance?.decisions ?? []).filter((decision) => decision.status === "contradicted");
}

/* ── Legacy read boundary ── */

const legacyOptionSchema = z
	.object({ label: z.string().min(1), value: z.string().min(1) })
	.passthrough();

/* A persisted single question. Wider than the emission contract on purpose (see
 * the file header): two to four options, no ids, no descriptions, and a plain
 * string answer. */
export const legacyQuestionSchema = z
	.object({
		question: z.string().min(1),
		options: z
			.array(legacyOptionSchema)
			.min(MIN_STORY_CLARIFICATION_OPTIONS)
			.max(MAX_LEGACY_QUESTION_OPTIONS)
			.optional(),
		freeText: z.boolean().optional(),
	})
	.passthrough();

export interface NormalizedQuestion {
	question: string;
	options?: Array<{ label: string; value: string }>;
	freeText?: boolean;
}

/** Read a persisted question of either generation. Returns null only when the
 *  payload is not a question at all — a four-option legacy action normalizes
 *  unchanged rather than failing to rehydrate. */
export function normalizeLegacyQuestion(raw: unknown): NormalizedQuestion | null {
	const parsed = legacyQuestionSchema.safeParse(raw);
	if (!parsed.success) return null;
	const { question, options, freeText } = parsed.data;
	return {
		question,
		...(options
			? { options: options.map((option) => ({ label: option.label, value: option.value })) }
			: {}),
		...(freeText ? { freeText: true } : {}),
	};
}
