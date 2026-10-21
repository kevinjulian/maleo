/* `create_story_video` as data: plan through the full `plan_story` — replacement
 * guard, direction routing, and the pre- and post-research questions unless the
 * request bypasses them — then approve implicitly and generate. */
import { z } from "zod";
import type { WorkflowDefinition } from "@maleo/shared";
import { getStoryPlan } from "../../plan-state.ts";
import { generateStoryAssetsFlow } from "../../services/story-assets.ts";
import { approveCurrentStoryPlan } from "../../services/storyboard-command-service.ts";
import { storyInputsOf } from "../../story-inputs.ts";
import { defineOperation, type Operation, type Rule } from "../types.ts";

export const CREATE_STORY_VIDEO = {
	id: "create_story_video",
	summary: "Plan through plan_story, approve implicitly, and generate in one call.",
	description:
		"ONE-SHOT (plan + generate, no approval gate). Prefer plan_story then approve unless the user explicitly wants it built immediately.",
	root: {
		type: "sequence",
		id: "create_story_video",
		steps: [
			{
				type: "call",
				id: "plan",
				workflow: "plan_story",
				in: { brief: "input.brief", targetDurationSec: "input.targetDurationSec" },
				out: "state.plan",
			},
			// Planning succeeded (a kept approved plan is a refusal, not a plan to build) and a plan exists.
			{
				type: "branch",
				id: "planned",
				if: { and: [{ eq: ["state.plan.ok", true] }, { rule: "plan.exists" }] },
				then: {
					type: "sequence",
					id: "build",
					steps: [
						{ type: "step", id: "approve", op: "story.approveImplicit" },
						{ type: "step", id: "generate", op: "story.generate", out: "state.generated" },
						{ type: "end", id: "generated", from: "state.generated" },
					],
				},
				else: { type: "end", id: "not-planned", from: "state.plan" },
			},
		],
	},
} as const satisfies WorkflowDefinition;

const approveImplicit = defineOperation({
	id: "story.approveImplicit",
	description: "Approve the planned story under the one-shot request, additions included.",
	input: z.object({}),
	output: z.object({}),
	prompts: [],
	tools: [],
	capabilities: [],
	run: async (_input, { job }) => {
		await approveCurrentStoryPlan(job, "implicit_one_shot", "auto_approve_additions");
		return {};
	},
});

const generate = defineOperation({
	id: "story.generate",
	description: "Generate the voiceover, images and timeline from the approved plan.",
	input: z.object({}),
	output: z.object({ ok: z.boolean(), note: z.string(), thumbs: z.array(z.string()).optional() }),
	prompts: [],
	tools: [],
	capabilities: ["llm:text", "media:generate"],
	unscoped:
		"Story asset generation is still a Mastra workflow path; it moves to a definition with its own declared prompts in step 3.",
	run: async (_input, { job, toolCallId }) => {
		const result = await generateStoryAssetsFlow(
			job,
			storyInputsOf(job, ["approved", "research"]),
			toolCallId,
		);
		return {
			ok: true,
			note: result.note,
			...(result.thumbs?.length ? { thumbs: result.thumbs } : {}),
		};
	},
});

export const ONE_SHOT_OPERATIONS: readonly Operation[] = [approveImplicit, generate];

export const ONE_SHOT_RULES: readonly Rule[] = [
	{
		id: "plan.exists",
		description: "The project holds a story plan.",
		test: ({ job }) => Boolean(getStoryPlan(job)),
	},
];
