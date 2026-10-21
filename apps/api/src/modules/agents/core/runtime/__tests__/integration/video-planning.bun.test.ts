/* Video planning as the agent's `workflow-plan_story` tool, run by the engine. Outcome parity with the planning oracle (post-research-suspension,
 * post-research-resume, plan-completion-from-checkpoint and
 * post-research-abandonment): what is planned, what is asked, what is never run
 * twice, and what an abandoned wait leaves behind. */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { clearWorkflowRunsForTests } from "@maleo/db/workflow-run-db";
import { getStoryPlan } from "../../../plan-state.ts";
import { setStoryPlannerForTests } from "../../../../../../lib/content-generator.ts";
import { buildAgentJob } from "../../../run-bracket.ts";
import { loadRun, markRunAbandoned, saveRun } from "../../../run-repository.ts";
import {
	encodeClarificationAnswer,
	postResearchClarificationState,
} from "../../../story-clarification.ts";
import type { AgentJob } from "../../../model.ts";
import { runState } from "../../run-state.ts";
import { answer, callTool } from "../support/scripted-model.ts";
import { conversation } from "../support/conversation.ts";
import {
	installPlanningProviders,
	planningCalls,
	removePlanningProviders,
} from "../support/planning-fixture.ts";

const BRIEF = "why compound interest is counter-intuitive";

async function videoRun(): Promise<AgentJob> {
	const projectId = (await createContentProject({ title: "Planning", type: "video" })).project.id;
	const job = await buildAgentJob({
		projectId,
		instruction: "make a 90 second video about compounding",
		brief: BRIEF,
		contentType: "video",
	});
	runState(job).instruction = "make a 90 second video about compounding";
	await saveRun(job);
	return job;
}

const planTool = callTool("workflow-plan_story", { inputData: { brief: BRIEF } });
const run = async (job: AgentJob) => (await loadRun(job.id))!;

beforeEach(() => clearWorkflowRunsForTests());
afterEach(() => removePlanningProviders());
afterAll(async () => {
	await closeMaleoDb();
});

describe("planning a video", () => {
	test("drafts one plan from the brief, grounded once, with no asset spent", async () => {
		installPlanningProviders("none");
		const job = await videoRun();
		const result = await conversation(job, [planTool, answer("Here is the plan.")]).start();
		expect(result.finishReason).not.toBe("suspended");
		const current = await run(job);
		const plan = getStoryPlan(current);
		expect(plan?.sections.map((section) => section.title)).toEqual(["Opening"]);
		expect(current.targetDurationSec).toBe(90);
		expect(planningCalls.frames).toBe(1);
		expect(planningCalls.searches).toBeGreaterThan(0);
		expect(current.scenes).toEqual([]);
		// The pre-research checkpoint produced nothing, so planning went ahead and said why.
		expect(current.run?.storyClarification?.status).toBe("bypassed");
	});
});

describe("a planner that fails", () => {
	// Ported from story-plan.bun.test.ts's loop case when the loop was deleted (3.2).
	test("parks no fake approval: the failure reaches the agent, and no plan or question is left", async () => {
		installPlanningProviders("none");
		setStoryPlannerForTests(async () => {
			throw new Error("planner parse failed");
		});
		const job = await videoRun();
		await conversation(job, [planTool, answer("Planning failed; I will try again.")]).start();
		const current = await run(job);
		expect(getStoryPlan(current)).toBeNull();
		expect(current.events.some((event) => event.kind === "question")).toBe(false);
		expect(current.pendingActionId).toBeUndefined();
		const completed = current.events.find(
			(event) => event.kind === "tool_call_completed" && event.tool === "plan_story",
		);
		expect(completed?.kind === "tool_call_completed" && completed.note).toBe(
			"Story planning failed: planner parse failed",
		);
		expect(completed?.kind === "tool_call_completed" && completed.errorInfo).toBeDefined();
	});
});

describe("a post-research question", () => {
	async function parked() {
		installPlanningProviders("batch");
		const job = await videoRun();
		const chat = conversation(job, [planTool, answer("Planned following Vermont.")]);
		const asked = await chat.start();
		return { job, chat, asked };
	}

	test("parks planning with the question, the cursor saved and nothing drafted", async () => {
		const { job, asked } = await parked();
		expect(asked.finishReason).toBe("suspended");
		const current = await run(job);
		expect(current.status).toBe("awaiting_input");
		expect(current.pendingQuestion?.batch?.id).toBe("post-1");
		expect(getStoryPlan(current)).toBeNull();
		expect(planningCalls.drafts).toEqual([]);
		// The flow record holds the cursor at the question and the frame and research as done.
		const core = current.run?.flows?.["call-workflow-plan_story"]?.calls.plan;
		expect(core).toMatchObject({
			workflow: "plan_story_core",
			status: "suspended",
			cursor: "ask-evidence",
		});
		expect(core?.done).toEqual(
			expect.arrayContaining(["setup", "brief", "frame", "research", "hold", "decide"]),
		);
		expect(core?.trace.at(-1)).toMatchObject({
			node: "ask-evidence",
			outcome: "suspended",
			pendingActionId: current.pendingActionId,
		});
	});

	test("the answer, after a restart, finishes the plan from the saved node without re-running the frame or the research", async () => {
		const { job, chat } = await parked();
		const framesBefore = planningCalls.frames;
		const searchesBefore = planningCalls.searches;

		chat.restart();
		const done = await chat.answer(
			encodeClarificationAnswer({
				batchId: "post-1",
				answers: [{ questionId: "case", optionId: "vt" }],
			}),
		);

		expect(done.text).toContain("Planned following Vermont.");
		const current = await run(job);
		expect(getStoryPlan(current)?.sections.map((section) => section.title)).toEqual(["Opening"]);
		expect(planningCalls.frames).toBe(framesBefore);
		expect(planningCalls.searches).toBe(searchesBefore);
		// The choice reached the draft and is recorded against the post-research batch.
		expect(planningCalls.drafts.at(-1)).toContain("Vermont");
		expect(postResearchClarificationState(current)?.status).toBe("answered");
		expect(current.run?.pendingTool).toBeUndefined();
		expect(current.run?.flows?.["call-workflow-plan_story"]?.status).toBe("completed");
	});

	test("an abandoned wait chooses no answer and drafts nothing, and keeps the flow record as evidence", async () => {
		const { job } = await parked();
		await markRunAbandoned(job.id, "timed out awaiting input");
		const current = await run(job);
		expect(current.status).toBe("error");
		expect(getStoryPlan(current)).toBeNull();
		expect(planningCalls.drafts).toEqual([]);
		expect(postResearchClarificationState(current)?.status).toBe("pending");
		expect(current.run?.flows?.["call-workflow-plan_story"]?.calls.plan?.cursor).toBe(
			"ask-evidence",
		);
	});
});
