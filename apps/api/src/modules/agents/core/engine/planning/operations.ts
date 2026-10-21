/* The planning operations the planning definitions are built from.
 *
 * Each wraps one existing planning function with explicit input and output
 * schemas — the fields that used to travel on a shared mutable context. Outputs
 * are what flow state keeps across a wait: the setup, the shape and frame, the
 * research key, the evidence decision, the plan, its sections, the style and the
 * bible. Live inputs (locked constraints, direction roster, writer style, held
 * research) are re-read by the operation that needs them. */
import { z } from "zod";
import {
	hasExplicitChannels,
	storyBibleSchema,
	storyClarificationBatchSchema,
	type StoryBible,
	type StoryClarificationBatch,
} from "@maleo/shared";
import {
	routeDirection,
	storyPlanSchema,
	type StoryFrame,
	type StoryPlanDraft,
} from "../../../../../lib/content-generator.ts";
import type { StorySection } from "../../../../../lib/story.ts";
import {
	parsePipelineApprovalChoice,
	suspendForStoryClarification,
	suspendForToolApproval,
} from "../../approval.ts";
import { briefWithChatContext } from "../../context-prompt.ts";
import { extractRequestedDurationSec, looksLikeSpecificTimelineEdit } from "../../duration.ts";
import { planStoryArgs } from "../../helpers/schemas.ts";
import { getStoryPlan } from "../../plan-state.ts";
import { runState } from "../../runtime/run-state.ts";
import {
	consumeClarificationAnswer,
	recordClarificationBypass,
	requestedClarificationBypass,
} from "../../story-clarification.ts";
import {
	generateStoryClarification,
	storyClarificationContext,
} from "../../story-clarification-planner.ts";
import {
	askEvidenceDecision,
	authorPlanBible,
	bindPlanningBrief,
	decideEvidence,
	draftPlannedStory,
	frameStory,
	generatePlanStyle,
	holdPlanning,
	loadPlanStyle,
	materializePlan,
	persistPlannedStory,
	preservedPlanNote,
	reportEvidenceFallback,
	retrievePlanningResearch,
	savePlanStyle,
	setupPlanning,
} from "../../services/planning-steps.ts";
import { defineOperation, type Operation } from "../types.ts";

export const REPLACE_GATE =
	"Replace the approved story plan with a new one? The approved plan stays until you approve.";

/** A planning artifact as flow state holds it: validated by its own schema, kept as is. */
const valid = <T>(name: string, schema: z.ZodTypeAny) =>
	z.custom<T>((value) => schema.safeParse(value).success, { message: `not a valid ${name}` });
const present = <T>(name: string) =>
	z.custom<T>((value) => value !== undefined && value !== null, { message: `${name} is missing` });

const args = planStoryArgs;
const setup = z.object({
	brief: z.string(),
	clarification: z.string(),
	targetSec: z.number(),
	structure: z.enum(["beat", "narration_section"]),
	sectionCount: z.number(),
	wordsPerSec: z.number(),
});
const brief = z.object({ wordBudget: z.number(), scriptingBrief: z.string() });
const frame = present<StoryFrame>("story frame");
const framed = z.object({
	shape: z.object({ sectionCount: z.number(), wordBudget: z.number() }),
	frame,
	grounded: z.boolean(),
	matchedKey: z.string().nullable(),
});
const provenance = z.custom<NonNullable<ReturnType<typeof holdPlanning>["clarification"]>>(
	(value) => typeof value === "object" && value !== null,
);
const hold = z.object({
	researchKey: z.string().nullable(),
	sourceCount: z.number(),
	clarification: provenance.nullable(),
});
const plan = valid<StoryPlanDraft>("story plan", storyPlanSchema);
const sections = z.custom<StorySection[]>((value) => Array.isArray(value), {
	message: "sections must be a list",
});
const batch = valid<StoryClarificationBatch>("clarification batch", storyClarificationBatchSchema);
const question = z.object({
	question: z.string(),
	actionId: z.string().optional(),
	note: z.string().optional(),
});
const outcome = z.object({
	ok: z.boolean(),
	note: z.string(),
	unchanged: z.literal(true).optional(),
});
const none = z.object({});
const nothing = z.object({}).strict();

const op = <I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
	operation: Omit<Operation<I, O>, "prompts" | "tools" | "capabilities"> &
		Partial<Pick<Operation<I, O>, "prompts" | "tools" | "capabilities">>,
): Operation => defineOperation({ prompts: [], tools: [], capabilities: [], ...operation });

/* ── plan_story: guard, direction, clarification ── */

const resolveDuration = op({
	id: "guard.duration",
	description: "An explicit duration in a new request sets the target.",
	input: none,
	output: nothing,
	run: async (_input, { job }) => {
		const instruction = runState(job).instruction;
		const explicit = extractRequestedDurationSec(instruction);
		if (explicit && !getStoryPlan(job) && !looksLikeSpecificTimelineEdit(instruction))
			job.targetDurationSec = explicit;
		return {};
	},
});

const askReplacement = op({
	id: "guard.askReplacement",
	description: "Ask before replacing the approved story plan.",
	input: none,
	output: question,
	run: async (_input, { job }) => {
		await suspendForToolApproval(job, REPLACE_GATE, "story_plan");
		return { question: REPLACE_GATE, actionId: job.pendingActionId };
	},
});

const answerReplacement = op({
	id: "guard.answerReplacement",
	description: "Approve, approve all, or keep the approved plan.",
	input: none,
	output: z.object({ decision: z.enum(["approve", "approve_all", "reject"]) }),
	run: async (_input, { job, answer }) => {
		const choice = parsePipelineApprovalChoice(answer ?? "");
		if (choice === "approve_all") runState(job).approveAll = true;
		const decision: "approve" | "approve_all" | "reject" =
			choice === "approve" || choice === "approve_all" ? choice : "reject";
		return { decision };
	},
});

const routeFreeDirection = op({
	id: "direction.route",
	description: "Route free-text direction into Story, Visual, Voice and Rules channels.",
	input: none,
	output: nothing,
	prompts: ["prompt:content:directionRouterPrompt"],
	capabilities: ["llm:text"],
	run: async (_input, { job }) => {
		const routed = await routeDirection(job.direction!.raw!);
		job.direction = { ...job.direction!, ...routed };
		return {};
	},
});

const clarificationBypass = op({
	id: "clarify.bypass",
	description: "Whether the request asked to skip questions or build in one shot.",
	input: none,
	output: z.object({ bypass: z.enum(["skip_request", "one_shot"]).nullable() }),
	run: async (_input, { job }) => {
		const bypass = requestedClarificationBypass(runState(job).instruction);
		return { bypass: bypass === "skip_request" || bypass === "one_shot" ? bypass : null };
	},
});

const recordBypass = op({
	id: "clarify.recordBypass",
	description: "Record the requested bypass in the clarification provenance.",
	input: z.object({ bypass: z.enum(["skip_request", "one_shot"]) }),
	output: nothing,
	run: async (input, { job }) => {
		recordClarificationBypass(job, input.bypass);
		return {};
	},
});

const generateQuestions = op({
	id: "clarify.generate",
	description: "Generate the story decisions nobody has answered.",
	input: none,
	output: z.object({ batch: batch.nullable() }),
	prompts: ["prompt:clarification:storyClarificationPrompt"],
	capabilities: ["llm:text"],
	run: async (_input, { job }) => ({
		batch: await generateStoryClarification(
			storyClarificationContext(job, runState(job).instruction),
		),
	}),
});

const askQuestions = op({
	id: "clarify.ask",
	description: "Put the story decisions to the user.",
	input: z.object({ batch }),
	output: question,
	run: async (input, { job }) => {
		await suspendForStoryClarification(job, input.batch);
		return {
			question: job.pendingQuestion?.question ?? "A few decisions before planning.",
			actionId: job.pendingActionId,
		};
	},
});

const consumeAnswer = op({
	id: "clarify.answer",
	description: "Apply the user's story decisions.",
	input: none,
	output: nothing,
	run: async (_input, { job, answer }) => {
		consumeClarificationAnswer(job, answer ?? "");
		return {};
	},
});

const questionsUnavailable = op({
	id: "clarify.unavailable",
	description: "Record that no questions could be generated.",
	input: none,
	output: nothing,
	run: async (_input, { job }) => {
		recordClarificationBypass(job, "unavailable");
		return {};
	},
});

/** Add the current instruction only when it adds to the project brief. */
export function planningBriefFromInstruction(instruction: string, fallbackBrief: string): string {
	const trimmed = instruction.trim();
	const fallback = fallbackBrief.trim();
	if (!fallback) return trimmed;
	if (!trimmed || fallback.toLowerCase().includes(trimmed.toLowerCase())) return fallback;
	return `${fallback}\n\nUser instruction: ${trimmed}`;
}

const bindArgs = op({
	id: "plan.bind",
	renders: ["prompt:context:briefWithChatContext"],
	description:
		"The planning arguments: the brief with frozen chat context, and the resolved duration.",
	input: z.object({ args }),
	output: args,
	run: async (input, { job }) => ({
		...input.args,
		brief: briefWithChatContext(
			input.args.brief || planningBriefFromInstruction(runState(job).instruction, job.brief),
			job.context,
		),
		...(job.targetDurationSec && !input.args.targetDurationSec
			? { targetDurationSec: job.targetDurationSec }
			: {}),
	}),
});

/* ── plan_story_core ── */

const planningSetup = op({
	id: "plan.setup",
	renders: ["prompt:materials:storyPromptLayers"],
	description:
		"Resolve target duration, structure and section count; route the brief through Story material.",
	input: z.object({ args }),
	output: setup,
	run: async (input, { job }) => setupPlanning(job, input.args),
});

const preserveGenerated = op({
	id: "plan.preserve",
	description: "Refuse to re-plan over generated sections.",
	input: none,
	output: outcome,
	run: async (_input, { job }) => ({
		ok: true,
		note: preservedPlanNote(job),
		unchanged: true as const,
	}),
});

const planningBrief = op({
	id: "plan.brief",
	renders: ["prompt:materials:voicePromptLayers"],
	description:
		"Word budget and the scripting brief: Voice material and the clarification decisions.",
	input: z.object({ setup }),
	output: brief,
	run: async (input, { job }) => bindPlanningBrief(job, input.setup),
});

const frameThePlan = op({
	id: "plan.frame",
	description: "Frame the plan: kind, arc, spine, references and grounding.",
	input: z.object({ args, setup, brief }),
	output: framed,
	prompts: ["prompt:content:storyFramePrompt"],
	capabilities: ["llm:text"],
	run: async (input, { job }) => frameStory(job, input.args, input.setup, input.brief),
});

const research = op({
	id: "plan.research",
	description: "Retrieve sources the frame asked for.",
	input: z.object({ topic: z.string(), questions: z.array(z.string()) }),
	output: z.object({ key: z.string().nullable() }),
	tools: ["research_topic"],
	run: async (input, { job }) => retrievePlanningResearch(job, input.topic, input.questions),
});

const holdResearch = op({
	id: "plan.hold",
	description: "Which research the plan is grounded in, and the decisions made before it.",
	input: z.object({
		matched: z.string().nullable().optional(),
		retrieved: z.string().nullable().optional(),
	}),
	output: hold,
	run: async (input, { job }) => holdPlanning(job, input.retrieved ?? input.matched ?? null),
});

const decide = op({
	id: "evidence.decide",
	description: "Whether the evidence forces an editorial choice only the user can make.",
	input: z.object({ args, brief: z.string(), frame, hold }),
	output: z.object({
		kind: z.enum(["none", "batch", "fallback"]),
		batch: batch.optional(),
		reason: z.string().optional(),
	}),
	prompts: ["prompt:evidence:evidenceDecisionPrompt"],
	capabilities: ["llm:text"],
	run: async (input, { job }) =>
		decideEvidence(job, input.args, input.brief, input.frame, input.hold),
});

const evidenceFallback = op({
	id: "evidence.fallback",
	description: "Say the sources could not be reviewed; continue on best judgment.",
	input: z.object({ reason: z.string() }),
	output: nothing,
	run: async (input, { job }) => {
		reportEvidenceFallback(job, input.reason);
		return {};
	},
});

const askEvidence = op({
	id: "evidence.ask",
	description: "Put the post-research decisions to the user.",
	input: z.object({ batch }),
	output: question,
	run: async (input, { job }) => askEvidenceDecision(job, input.batch),
});

const answerEvidence = op({
	id: "evidence.answer",
	description: "Apply the user's post-research decisions.",
	input: none,
	output: nothing,
	run: async (_input, { job, answer }) => {
		consumeClarificationAnswer(job, answer ?? "");
		return {};
	},
});

const draft = op({
	id: "plan.draft",
	description: "Skeleton, slot draft and sequence direction, against the held frame and research.",
	input: z.object({ args, setup, brief, framed, hold }),
	output: z.object({ plan }),
	prompts: ["prompt:content:storyDraftPrompt", "prompt:sequence:storySequenceDirectionPrompt"],
	capabilities: ["llm:text"],
	run: async (input, { job }) => ({
		plan: await draftPlannedStory(
			job,
			input.args,
			input.setup,
			input.brief,
			input.framed,
			input.hold,
		),
	}),
});

const materialize = op({
	id: "plan.materialize",
	description: "Turn drafted sections into plan sections with budgets and citations.",
	input: z.object({ wordBudget: z.number(), plan, hold, grounded: z.boolean() }),
	output: z.object({ sections }),
	run: async (input, { job }) => ({
		sections: materializePlan(job, input.wordBudget, input.plan, input.hold, input.grounded),
	}),
});

const visualStyle = z.object({ visualStyle: z.string().nullable() });

const loadStyle = op({
	id: "style.load",
	description: "The project's saved style bible, if any.",
	input: none,
	output: visualStyle,
	run: async (_input, { job }) => ({ visualStyle: await loadPlanStyle(job) }),
});

const generateStyle = op({
	id: "style.generate",
	description: "Generate a style bible fitted to the locked constraints.",
	input: z.object({ brief: z.string() }),
	output: visualStyle,
	prompts: ["prompt:content:generateStyleBible"],
	capabilities: ["llm:text"],
	run: async (input, { job }) => ({ visualStyle: await generatePlanStyle(job, input.brief) }),
});

const saveStyle = op({
	id: "style.save",
	description: "Save the resolved style bible on the project.",
	input: z.object({ visualStyle: z.string() }),
	output: nothing,
	run: async (input, { job }) => {
		await savePlanStyle(job, input.visualStyle);
		return {};
	},
});

const bible = op({
	id: "plan.bible",
	description: "Author the Story Bible: subjects, locations, look and negatives.",
	input: z.object({ brief: z.string(), plan, visualStyle: z.string().nullable().optional() }),
	output: z.object({ bible: valid<StoryBible>("story bible", storyBibleSchema).nullable() }),
	prompts: ["prompt:content:authorStoryBible"],
	capabilities: ["llm:text"],
	run: async (input, { job }) => ({
		bible: await authorPlanBible(job, input.brief, input.plan, input.visualStyle ?? undefined),
	}),
});

const persistPlan = op({
	id: "plan.persist",
	description: "Write the plan, report it, and say what was planned.",
	input: z.object({
		setup,
		brief,
		framed,
		hold,
		plan,
		sections,
		visualStyle: z.string().nullable().optional(),
		bible: valid<StoryBible>("story bible", storyBibleSchema).nullable().optional(),
	}),
	output: outcome,
	run: async (input, { job }) => ({
		ok: true,
		note: await persistPlannedStory(job, {
			brief: input.setup.brief,
			grounded: input.framed.grounded,
			targetSec: input.setup.targetSec,
			structure: input.setup.structure,
			wordBudget: input.brief.wordBudget,
			hold: input.hold,
			plan: input.plan,
			sections: input.sections,
			visualStyle: input.visualStyle ?? undefined,
			bible: input.bible ?? undefined,
		}),
	}),
});

export const PLANNING_OPERATIONS: readonly Operation[] = [
	resolveDuration,
	askReplacement,
	answerReplacement,
	routeFreeDirection,
	clarificationBypass,
	recordBypass,
	generateQuestions,
	askQuestions,
	consumeAnswer,
	questionsUnavailable,
	bindArgs,
	planningSetup,
	preserveGenerated,
	planningBrief,
	frameThePlan,
	research,
	holdResearch,
	decide,
	evidenceFallback,
	askEvidence,
	answerEvidence,
	draft,
	materialize,
	loadStyle,
	generateStyle,
	saveStyle,
	bible,
	persistPlan,
];

/** Whether free-text direction needs routing into channels. */
export function directionNeedsRouting(
	direction: ({ raw?: string } & Parameters<typeof hasExplicitChannels>[0]) | undefined,
): boolean {
	return Boolean(direction?.raw?.trim() && !hasExplicitChannels(direction));
}
