/* Story asset generation as a Mastra workflow — the agent's
 * `generate_story_assets` (design decision 7). The registry tool of that name
 * runs inside it, as the pipeline's scaffold stage.
 *
 *  1. guard   — a plan is required; the plan the project holds is read back,
 *               since the Storyboard view may have edited it while the run waited.
 *  2. approve — the plan gate as a step that suspends, with the gate's answers:
 *               Approve / Approve all generate; Reject asks what to change, and the
 *               next free text redrafts against the held frame, skeleton and
 *               research, then re-gates; "Research again" re-grounds and re-gates.
 *               Free text at a gate that was not rejected is the agent's to act on:
 *               nothing is generated. An approved plan skips the gate.
 *  3. generate — the scaffold stage: approval recorded (Approve all → additions
 *               approved automatically, as the pipeline's auto mode did), then the
 *               voiceover, images and timeline. */
import { z } from "zod";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import type { RequestContext } from "@mastra/core/request-context";
import {
	APPROVAL_OPTIONS,
	groundingSummary,
	isResearchAgainRequest,
	parsePipelineApprovalChoice,
	researchPlanAgain,
	revisePlan,
	suspendForPlanRevision,
	suspendForToolApproval,
} from "../../approval.ts";
import { approvedPlanFor } from "../../approval-state.ts";
import { NO_WORKFLOW, storyScaffoldStage } from "../../pipeline-stages.ts";
import { persist, reloadStoryPlan } from "../../persistence.ts";
import { getStoryPlan } from "../../plan-state.ts";
import type { AgentJob } from "../../model.ts";
import { markBuilt, runState } from "../run-state.ts";
import { NO_PLAN_NOTE } from "../tools/preconditions.ts";
import { runFor, type AgentRunContext } from "../tools/registry-tools.ts";
import { runStage } from "./stage-step.ts";

export const PLAN_GATE =
	"Review the story plan. Approve to generate assets, or approve all to auto-chain this build.";
const PLAN_GATE_OPTIONS = [
	APPROVAL_OPTIONS[0]!,
	APPROVAL_OPTIONS[1]!,
	{ label: "Research again", value: "research again" },
	APPROVAL_OPTIONS[2]!,
];
const LABEL = "story plan";

const outcome = z.object({ ok: z.boolean(), note: z.string() });
const gated = outcome.extend({ approved: z.boolean() });
const answer = z.object({ answer: z.string() });
const question = z.object({ question: z.string(), actionId: z.string().optional() });

function jobFor(requestContext: RequestContext<unknown>): Promise<AgentJob> {
	// SAFETY: the agent passes its request context, typed by AgentRunContext, to the workflows it calls.
	return runFor(requestContext as RequestContext<AgentRunContext>);
}

const guard = createStep({
	id: "guard",
	description: "Reload the latest story plan; refuse generation if no plan exists.",
	metadata: {
		template: {
			source: "runtime/workflows/story-assets.ts",
			contentTypes: ["video"],
			conditions: ["Reads the latest plan after any storyboard changes."],
		},
	},
	inputSchema: z.object({}),
	outputSchema: gated,
	execute: async ({ requestContext }) => {
		const job = await jobFor(requestContext);
		await reloadStoryPlan(job);
		const plan = getStoryPlan(job);
		if (!plan) return { ok: false, note: NO_PLAN_NOTE, approved: false };
		await persist(job);
		return {
			ok: true,
			note: "",
			approved: Boolean(approvedPlanFor(job, plan)) || runState(job).approveAll === true,
		};
	},
});

type Question = z.infer<typeof question>;

/** Put the plan to the user at the gate; returns what the step suspends with. */
async function approvalQuestion(job: AgentJob, lead = PLAN_GATE): Promise<Question> {
	await suspendForToolApproval(job, `${lead}${groundingSummary(job)}`, LABEL, PLAN_GATE_OPTIONS);
	return { question: lead, actionId: job.pendingActionId };
}

/** Ask what to change in the rejected plan; returns what the step suspends with. */
async function revisionQuestion(job: AgentJob): Promise<Question> {
	await suspendForPlanRevision(job, undefined, LABEL);
	return {
		question: job.pendingQuestion?.question ?? "What should change?",
		actionId: job.pendingActionId,
	};
}

const approve = createStep({
	id: "approve",
	description: PLAN_GATE,
	metadata: {
		template: {
			source: "runtime/workflows/story-assets.ts",
			contentTypes: ["video"],
			conditions: [
				"Approve continues; approve all also approves duration additions.",
				"Reject asks for revision and gates again; research again refreshes grounding.",
				"An already approved plan skips the gate; unrelated free text generates nothing.",
			],
		},
	},
	inputSchema: gated,
	outputSchema: gated,
	resumeSchema: answer,
	suspendSchema: question,
	execute: async ({ inputData, resumeData, suspend, requestContext }) => {
		if (!inputData.ok || inputData.approved) return inputData;
		const job = await jobFor(requestContext);
		const state = runState(job);
		if (!resumeData) return await suspend(await approvalQuestion(job));
		const reply = resumeData.answer;
		await reloadStoryPlan(job);
		if (isResearchAgainRequest(reply)) {
			const researched = await researchPlanAgain(job);
			if (researched.outcome === "failed") return await suspend(await revisionQuestion(job));
			return await suspend(
				await approvalQuestion(
					job,
					researched.outcome === "redrafted" ? researched.note : PLAN_GATE,
				),
			);
		}
		const choice = parsePipelineApprovalChoice(reply);
		if (choice === "approve" || choice === "approve_all") {
			if (choice === "approve_all") state.approveAll = true;
			state.awaitingRevision = false;
			await persist(job);
			return { ok: true, note: "", approved: true };
		}
		if (choice === "reject") return await suspend(await revisionQuestion(job));
		if (state.awaitingRevision) {
			const revised = await revisePlan(job, reply, LABEL);
			if (revised.outcome === "limit_reached")
				return { ok: false, note: revised.note, approved: false };
			if (revised.outcome === "failed") return await suspend(await revisionQuestion(job));
			return await suspend(await approvalQuestion(job, revised.note));
		}
		// Not an answer to the gate: the plan waits, and the agent acts on what was said.
		job.pendingQuestion = undefined;
		await persist(job);
		return {
			ok: false,
			note: `Nothing generated — the plan still waits for approval. The user said: "${reply}"`,
			approved: false,
		};
	},
});

const generate = createStep({
	id: "generate",
	description:
		"Approve the exact revision and generate compatible missing assets and the timeline.",
	metadata: {
		template: {
			source: "runtime/workflows/story-assets.ts",
			contentTypes: ["video"],
			tools: ["generate_story_assets"],
			operations: ["operation:planning:direction"],
			repeat: "Per section and measured visual beat",
			conditions: [
				"Only from the approved snapshot.",
				"Refresh sequence direction before approval if roster/material/template input fingerprints changed.",
				"Reuse compatible finished assets; retry missing/stale outputs.",
				"Review additions waits for approval; approve all generates additions automatically.",
			],
		},
	},
	inputSchema: gated,
	outputSchema: outcome,
	execute: async ({ inputData, requestContext, runId }) => {
		if (!inputData.ok) return { ok: false, note: inputData.note };
		const job = await jobFor(requestContext);
		const generated = await runStage(
			job,
			"storyGenerate",
			storyScaffoldStage({ summary: PLAN_GATE, workflow: NO_WORKFLOW }),
			`${runId}:generate`,
		);
		if (generated.ok) {
			markBuilt(job);
			await persist(job);
		}
		return { ok: generated.ok, note: generated.note };
	},
});

export const storyAssetsWorkflow = createWorkflow({
	id: "generate_story_assets",
	metadata: {
		template: {
			source: "runtime/workflows/story-assets.ts",
			contentTypes: ["video"],
			profiles: ["storyGenerate"],
		},
	},
	description:
		"Generate voiceover and images for every section of the story plan and build the timeline, once the user approves the plan. Call after plan_story; the user is asked to approve first unless the plan is already approved.",
	inputSchema: z.object({}),
	outputSchema: outcome,
})
	.then(guard)
	.then(approve)
	.then(generate)
	.commit();
