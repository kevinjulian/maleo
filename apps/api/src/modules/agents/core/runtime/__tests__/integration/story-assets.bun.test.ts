/* adopt-mastra-internal-agent 2.6: story asset generation as the agent's
 * generate_story_assets workflow, with plan approval as a step suspension.
 * Outcome parity with the gate's oracle (agent-orchestrator content and story
 * suites, pipeline-stages "approve_all reaches the committing stage",
 * plan-revision-loop): what is approved and how, what is generated, and what a
 * refusal leaves. */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { clearWorkflowRunsForTests, listToolRuns } from "@maleo/db/workflow-run-db";
import { approvedPlanFor } from "../../../approval-state.ts";
import { getStoryPlan } from "../../../plan-state.ts";
import { buildAgentJob } from "../../../run-bracket.ts";
import { loadRun, saveRun } from "../../../run-repository.ts";
import { approveCurrentStoryPlan } from "../../../services/storyboard-command-service.ts";
import type { AgentJob } from "../../../model.ts";
import { runState } from "../../run-state.ts";
import { NO_PLAN_NOTE } from "../../tools/preconditions.ts";
import { PLAN_GATE } from "../../workflows/story-assets.ts";
import { answer, callTool } from "../support/scripted-model.ts";
import { conversation } from "../support/conversation.ts";
import {
	installPlanningProviders,
	planningCalls,
	removePlanningProviders,
} from "../support/planning-fixture.ts";
import {
	draftShortPlan,
	installStoryProviders,
	providerCalls,
	removeStoryProviders,
} from "../support/story-fixture.ts";

async function videoRun(prepare?: (job: AgentJob) => void | Promise<void>): Promise<AgentJob> {
	const projectId = (await createContentProject({ title: "Story assets", type: "video" })).project
		.id;
	const job = await buildAgentJob({
		projectId,
		instruction: "make a story",
		brief: "a lighthouse keeper's last night",
		contentType: "video",
	});
	runState(job).instruction = "make a story";
	await prepare?.(job);
	await saveRun(job);
	return job;
}

const generate = callTool("workflow-generate_story_assets", { inputData: {} });
const run = async (job: AgentJob) => (await loadRun(job.id))!;
const toolOutputs = (result: { steps: Array<{ toolResults?: Array<{ payload?: unknown }> }> }) =>
	JSON.stringify(
		result.steps.flatMap((step) => step.toolResults ?? []).map((toolResult) => toolResult.payload),
	);
const spent = () => providerCalls.speech + providerCalls.frames;

beforeEach(async () => {
	await clearWorkflowRunsForTests();
	installStoryProviders();
});
afterEach(() => {
	removeStoryProviders();
	removePlanningProviders();
});
afterAll(async () => {
	await closeMaleoDb();
});

describe("the plan gate", () => {
	test("with no plan, generation is refused with the next step and nothing is spent", async () => {
		const job = await videoRun();
		const result = await conversation(job, [generate, answer("Need a plan first.")]).start();
		expect(toolOutputs(result)).toContain(NO_PLAN_NOTE);
		expect(await listToolRuns(job.id)).toEqual([]);
		expect(spent()).toBe(0);
	});

	test("an unapproved plan is put to the user, with the gate's answers, before anything is spent", async () => {
		const job = await videoRun(draftShortPlan);
		const asked = await conversation(job, [generate]).start();
		expect(asked.finishReason).toBe("suspended");
		const current = await run(job);
		expect(current.status).toBe("awaiting_input");
		expect(current.pendingQuestion?.question).toContain(PLAN_GATE);
		expect(current.pendingQuestion?.options?.map((option) => option.label)).toEqual([
			"Approve",
			"Approve all",
			"Research again",
			"Reject",
		]);
		expect(spent()).toBe(0);
	});

	test('"approve" generates from the plan it approved, and holds any additions for review', async () => {
		const job = await videoRun(draftShortPlan);
		const chat = conversation(job, [generate, answer("Generated the story.")]);
		await chat.start();
		const done = await chat.answer("approve");
		expect(done.text).toContain("Generated the story.");
		const current = await run(job);
		expect(approvedPlanFor(current, getStoryPlan(current))?.payload).toMatchObject({
			approvalMode: "explicit",
			extensionPolicy: "review_additions",
		});
		expect(current.scenes.length).toBeGreaterThan(0);
		expect(providerCalls.speech).toBeGreaterThan(0);
		expect(current.run?.builtSomething).toBe(true);
		expect(
			current.artifacts.find((artifact) => artifact.kind === "approved_plan")?.producer,
		).toMatchObject({ type: "stage", stage: "scaffold" });
	});

	test('"approve all" approves additions too, and later gates in the run stop asking', async () => {
		const job = await videoRun(draftShortPlan);
		const chat = conversation(job, [generate, answer("Generated.")]);
		await chat.start();
		await chat.answer("approve all");
		const current = await run(job);
		expect(approvedPlanFor(current, getStoryPlan(current))?.payload).toMatchObject({
			approvalMode: "explicit",
			extensionPolicy: "auto_approve_additions",
		});
		expect(current.run?.approveAll).toBe(true);
		expect(current.scenes.length).toBeGreaterThan(0);
	});

	test("an approved plan generates without asking again", async () => {
		const job = await videoRun(async (current) => {
			draftShortPlan(current);
			expect((await approveCurrentStoryPlan(current, "explicit")).ok).toBe(true);
		});
		const result = await conversation(job, [generate, answer("Generated.")]).start();
		expect(result.finishReason).not.toBe("suspended");
		expect((await run(job)).scenes.length).toBeGreaterThan(0);
	});
});

describe("refusing the plan", () => {
	test("a rejection asks what to change; the revision redrafts against the same frame and re-gates; approval then generates", async () => {
		// A story that needs no sources, so the finished build has no evidence findings to hold it back.
		installPlanningProviders("none", { grounded: false });
		const job = await videoRun();
		const chat = conversation(job, [
			callTool("workflow-plan_story", { inputData: { brief: "a lighthouse keeper's last night" } }),
			generate,
			answer("Generated the revised story."),
		]);
		await chat.start();
		expect((await run(job)).pendingQuestion?.question).toContain(PLAN_GATE);
		const framesAfterPlanning = planningCalls.frames;

		await chat.answer("reject");
		const rejected = await run(job);
		expect(rejected.status).toBe("awaiting_input");
		expect(rejected.pendingQuestion?.freeText).toBe(true);
		expect(rejected.run?.awaitingRevision).toBe(true);
		expect(spent()).toBe(0);

		await chat.answer("make the ending quieter");
		const regated = await run(job);
		expect(regated.pendingQuestion?.options?.map((option) => option.label)).toContain("Approve");
		expect(regated.run?.revisions).toBe(1);
		expect(planningCalls.drafts.at(-1)).toContain("make the ending quieter");
		// The revision redrafts against the held frame: no new framing pass.
		expect(planningCalls.frames).toBe(framesAfterPlanning);
		expect(spent()).toBe(0);

		const done = await chat.answer("approve");
		expect(done.text).toContain("Generated the revised story.");
		expect((await run(job)).scenes.length).toBeGreaterThan(0);
	});

	test("free text at a gate that was not rejected generates nothing and is the agent's to act on", async () => {
		const job = await videoRun(draftShortPlan);
		const chat = conversation(job, [generate, answer("Noted; the plan still waits for approval.")]);
		await chat.start();
		const result = await chat.answer("hmm, what about the music?");
		expect(toolOutputs(result)).toContain("Nothing generated");
		const current = await run(job);
		expect(approvedPlanFor(current, getStoryPlan(current))).toBeUndefined();
		expect(spent()).toBe(0);
	});
});

describe("re-planning over an approved plan", () => {
	test("waits for approval, and a refusal keeps the approved plan", async () => {
		const job = await videoRun(async (current) => {
			draftShortPlan(current);
			expect((await approveCurrentStoryPlan(current, "explicit")).ok).toBe(true);
		});
		const before = getStoryPlan(await run(job));
		const chat = conversation(job, [
			callTool("workflow-plan_story", { inputData: { brief: "something else entirely" } }),
			answer("Kept the approved plan."),
		]);
		const asked = await chat.start();
		expect(asked.finishReason).toBe("suspended");
		expect((await run(job)).pendingQuestion?.question).toContain("Replace the approved story plan");

		await chat.answer("reject");
		const current = await run(job);
		expect(getStoryPlan(current)).toEqual(before);
		expect(approvedPlanFor(current, getStoryPlan(current))).toBeDefined();
	});
});
