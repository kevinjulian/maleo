/* Video planning as data: `plan_story`, the agent's planning tool, and the
 * planning core it calls. `create_story_video` calls the same `plan_story`, so a
 * change here changes both. The engine executes exactly these objects and the
 * catalog projects exactly these objects. */
import type { WorkflowDefinition } from "@maleo/shared";

const ONE_SHOT_BYPASSES = ["skip_request", "one_shot"];

export const PLAN_STORY = {
	id: "plan_story",
	summary: "Create a durable story plan before generating media.",
	description:
		"PLAN-FIRST for video/story: produce one durable Story Plan (premise, hook, tension, arc, narration sections or beats, ordered visual changes). Generates no assets. Use this first for every new video/story build; leave structure and planKind on auto unless the user asks.",
	root: {
		type: "sequence",
		id: "plan_story",
		steps: [
			{ type: "step", id: "duration", op: "guard.duration" },
			{
				type: "branch",
				id: "replace-approved",
				if: { rule: "plan.approvedExists" },
				then: {
					type: "sequence",
					id: "replacement",
					steps: [
						{
							type: "suspend",
							id: "approve-replacement",
							kind: "approval",
							ask: "guard.askReplacement",
							onAnswer: "guard.answerReplacement",
							out: "state.replacement",
							skipIf: { fact: "run.approveAll" },
						},
						{
							type: "branch",
							id: "replacement-rejected",
							if: { eq: ["state.replacement.decision", "reject"] },
							then: {
								type: "end",
								id: "kept",
								outcome: { ok: false, note: "Kept the approved story plan." },
							},
						},
					],
				},
			},
			{
				type: "branch",
				id: "route-direction",
				if: { rule: "direction.needsRouting" },
				then: {
					type: "step",
					id: "direction",
					op: "direction.route",
					prompts: ["prompt:content:directionRouterPrompt"],
				},
			},
			{ type: "step", id: "bypass", op: "clarify.bypass", out: "state.bypass" },
			{
				type: "branch",
				id: "bypassed",
				if: { exists: "state.bypass.bypass" },
				then: {
					type: "step",
					id: "record-bypass",
					op: "clarify.recordBypass",
					in: { bypass: "state.bypass.bypass" },
				},
				else: {
					type: "branch",
					id: "clarification-eligible",
					if: { rule: "clarification.eligible" },
					then: {
						type: "sequence",
						id: "clarify",
						steps: [
							{
								type: "step",
								id: "questions",
								op: "clarify.generate",
								out: "state.questions",
								prompts: ["prompt:clarification:storyClarificationPrompt"],
							},
							{
								type: "branch",
								id: "has-questions",
								if: { exists: "state.questions.batch" },
								then: {
									type: "suspend",
									id: "ask-questions",
									kind: "questions",
									ask: "clarify.ask",
									onAnswer: "clarify.answer",
									in: { batch: "state.questions.batch" },
								},
								else: { type: "step", id: "questions-unavailable", op: "clarify.unavailable" },
							},
						],
					},
				},
			},
			{ type: "step", id: "bind", op: "plan.bind", in: { args: "input" }, out: "state.args" },
			{
				type: "call",
				id: "plan",
				workflow: "plan_story_core",
				in: { args: "state.args" },
				out: "state.core",
				contract: "plan",
			},
			{ type: "end", id: "planned", from: "state.core" },
		],
	},
} as const satisfies WorkflowDefinition;

export const PLAN_STORY_CORE = {
	id: "plan_story_core",
	summary: "The planning core both planning tools call: frame, ground, ask, draft, style and save.",
	description:
		"Frame, research when grounding is needed, ask post-research decisions, draft, resolve style and Story Bible, and save the plan. Generates no media.",
	root: {
		type: "sequence",
		id: "plan_story_core",
		steps: [
			{
				type: "step",
				id: "setup",
				op: "plan.setup",
				in: { args: "input.args" },
				out: "state.setup",
			},
			{
				type: "branch",
				id: "generated-work",
				if: { rule: "plan.hasGeneratedWork" },
				then: {
					type: "sequence",
					id: "preserve-generated",
					steps: [
						{ type: "step", id: "preserve", op: "plan.preserve", out: "state.preserved" },
						{ type: "end", id: "not-re-planning", from: "state.preserved", unchanged: true },
					],
				},
			},
			{
				type: "step",
				id: "brief",
				op: "plan.brief",
				in: { setup: "state.setup" },
				out: "state.brief",
			},
			{
				type: "step",
				id: "frame",
				op: "plan.frame",
				in: { args: "input.args", setup: "state.setup", brief: "state.brief" },
				out: "state.framed",
				prompts: ["prompt:content:storyFramePrompt"],
			},
			{
				type: "branch",
				id: "needs-research",
				if: {
					and: [
						{ eq: ["state.framed.grounded", true] },
						{ not: { exists: "state.framed.matchedKey" } },
					],
				},
				then: {
					type: "step",
					id: "research",
					op: "plan.research",
					in: { topic: "state.setup.brief", questions: "state.framed.frame.grounding.questions" },
					out: "state.retrieved",
					tools: ["research_topic"],
				},
			},
			{
				type: "step",
				id: "hold",
				op: "plan.hold",
				in: { matched: "state.framed.matchedKey", retrieved: "state.retrieved.key" },
				out: "state.hold",
			},
			{
				type: "branch",
				id: "review-evidence",
				if: {
					and: [
						{ not: { empty: "state.hold.sourceCount" } },
						{ not: { in: ["fact:clarification.bypass", ONE_SHOT_BYPASSES] } },
					],
				},
				then: {
					type: "sequence",
					id: "evidence",
					steps: [
						{
							type: "step",
							id: "decide",
							op: "evidence.decide",
							in: {
								args: "input.args",
								brief: "state.setup.brief",
								frame: "state.framed.frame",
								hold: "state.hold",
							},
							out: "state.decision",
							prompts: ["prompt:evidence:evidenceDecisionPrompt"],
						},
						{
							type: "branch",
							id: "evidence-fallback",
							if: { eq: ["state.decision.kind", "fallback"] },
							then: {
								type: "step",
								id: "fallback",
								op: "evidence.fallback",
								in: { reason: "state.decision.reason" },
							},
						},
						{
							type: "branch",
							id: "evidence-question",
							if: { eq: ["state.decision.kind", "batch"] },
							then: {
								type: "suspend",
								id: "ask-evidence",
								kind: "questions",
								ask: "evidence.ask",
								onAnswer: "evidence.answer",
								in: { batch: "state.decision.batch" },
							},
						},
					],
				},
			},
			{
				type: "step",
				id: "draft",
				op: "plan.draft",
				in: {
					args: "input.args",
					setup: "state.setup",
					brief: "state.brief",
					framed: "state.framed",
					hold: "state.hold",
				},
				out: "state.drafted",
				prompts: [
					"prompt:content:storyDraftPrompt",
					"prompt:sequence:storySequenceDirectionPrompt",
				],
			},
			{
				type: "step",
				id: "materialize",
				op: "plan.materialize",
				in: {
					wordBudget: "state.brief.wordBudget",
					plan: "state.drafted.plan",
					hold: "state.hold",
					grounded: "state.framed.grounded",
				},
				out: "state.materialized",
			},
			{
				type: "branch",
				id: "no-style-image",
				if: { empty: "fact:job.styleImageUrl" },
				then: {
					type: "sequence",
					id: "style",
					steps: [
						{ type: "step", id: "load-style", op: "style.load", out: "state.style" },
						{
							type: "branch",
							id: "missing-style",
							if: { empty: "state.style.visualStyle" },
							then: {
								type: "step",
								id: "generate-style",
								op: "style.generate",
								in: { brief: "state.setup.brief" },
								out: "state.style",
								prompts: ["prompt:content:generateStyleBible"],
								onError: "continue",
							},
						},
						{
							type: "branch",
							id: "resolved-style",
							if: { not: { empty: "state.style.visualStyle" } },
							then: {
								type: "step",
								id: "save-style",
								op: "style.save",
								in: { visualStyle: "state.style.visualStyle" },
							},
						},
					],
				},
			},
			{
				type: "step",
				id: "bible",
				op: "plan.bible",
				in: {
					brief: "state.setup.brief",
					plan: "state.drafted.plan",
					visualStyle: "state.style.visualStyle",
				},
				out: "state.bible",
				prompts: ["prompt:content:authorStoryBible"],
				onError: "continue",
			},
			{
				type: "step",
				id: "persist",
				op: "plan.persist",
				in: {
					setup: "state.setup",
					brief: "state.brief",
					framed: "state.framed",
					hold: "state.hold",
					plan: "state.drafted.plan",
					sections: "state.materialized.sections",
					visualStyle: "state.style.visualStyle",
					bible: "state.bible.bible",
				},
				out: "state.result",
			},
			{ type: "end", id: "planned", from: "state.result" },
		],
	},
} as const satisfies WorkflowDefinition;

export const PLANNING_DEFINITIONS: readonly WorkflowDefinition[] = [PLAN_STORY, PLAN_STORY_CORE];
