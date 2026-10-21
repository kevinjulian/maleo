/* `create_story_video` on the engine: it plans through the full `plan_story` —
 * replacement guard, direction routing, pre- and post-research questions unless
 * the request bypasses them — then approves implicitly and generates. */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { clearWorkflowRunsForTests } from "@maleo/db/workflow-run-db";
import { approveStoryDraft, type StoryClarificationBatch } from "@maleo/shared";
import { recordApprovedPlan } from "../../../approval-state.ts";
import { REPLACE_GATE } from "../../../engine/planning/operations.ts";
import { getStoryPlan, setStoryPlan } from "../../../plan-state.ts";
import { buildAgentJob } from "../../../run-bracket.ts";
import { loadRun, saveRun } from "../../../run-repository.ts";
import { encodeClarificationAnswer } from "../../../story-clarification.ts";
import { setStoryClarificationPlannerForTests } from "../../../story-clarification-planner.ts";
import { setDirectionRouterForTests } from "../../../../../../lib/content-generator.ts";
import type { AgentJob } from "../../../model.ts";
import { runState } from "../../run-state.ts";
import { PLAN_GATE } from "../../workflows/story-assets.ts";
import { answer, callTool } from "../support/scripted-model.ts";
import { conversation } from "../support/conversation.ts";
import {
	installPlanningProviders,
	planningCalls,
	removePlanningProviders,
} from "../support/planning-fixture.ts";
import {
	installStoryProviders,
	providerCalls,
	removeStoryProviders,
} from "../support/story-fixture.ts";

const BRIEF = "a lighthouse keeper's last night";
// A target the one-section test plan can reach, so the finish gate has no duration finding.
const build = callTool("create_story_video", { brief: BRIEF, targetDurationSec: 10 });
const preBatch: StoryClarificationBatch = {
	id: "pre-one-shot",
	stage: "pre_research",
	purpose: "story_brief",
	questions: [
		{
			id: "audience",
			header: "Audience",
			question: "Who watches?",
			options: [
				{
					id: "kids",
					label: "Children",
					value: "Tell it for children",
					description: "Gentle and simple.",
					recommended: true,
				},
				{
					id: "adults",
					label: "Adults",
					value: "Tell it for adults",
					description: "Quiet and adult.",
				},
			],
		},
	],
};

async function videoRun(instruction: string, prepare?: (job: AgentJob) => void): Promise<AgentJob> {
	const projectId = (await createContentProject({ title: "One shot", type: "video" })).project.id;
	const job = await buildAgentJob({ projectId, instruction, brief: BRIEF, contentType: "video" });
	runState(job).instruction = instruction;
	prepare?.(job);
	await saveRun(job);
	return job;
}

/* The finish gate re-prompts while the fixtures' generated timeline has outcome
 * findings; enough answers to reach the step limit, so the run settles either way. */
const finishing = (text: string) => Array.from({ length: 30 }, () => answer(text));
const run = async (job: AgentJob) => (await loadRun(job.id))!;
const generated = () => providerCalls.frames + providerCalls.speech;
const asked = (job: AgentJob, question: string) =>
	job.events.some((event) => event.kind === "question" && event.question.includes(question));

beforeEach(async () => {
	await clearWorkflowRunsForTests();
	installStoryProviders();
	installPlanningProviders("none", { grounded: false });
});
afterEach(() => {
	removeStoryProviders();
	removePlanningProviders();
	setDirectionRouterForTests(null);
});
afterAll(closeMaleoDb);

describe("create_story_video", () => {
	test("asks the pre-research story decisions before framing, and generates only after planning", async () => {
		setStoryClarificationPlannerForTests(async () => preBatch);
		const job = await videoRun("make a video about the lighthouse");
		const chat = conversation(job, [build, ...finishing("Built.")]);
		expect((await chat.start()).finishReason).toBe("suspended");
		expect(planningCalls.frames).toBe(0);
		expect(generated()).toBe(0);
		expect((await run(job)).pendingQuestion?.batch?.id).toBe(preBatch.id);
		chat.restart();
		await chat.answer(
			encodeClarificationAnswer({
				batchId: preBatch.id,
				answers: [{ questionId: "audience", optionId: "kids" }],
			}),
		);
		const current = await run(job);
		expect(planningCalls.drafts[0]).toContain("Tell it for children");
		expect(generated()).toBeGreaterThan(0);
		expect(current.scenes.length).toBeGreaterThan(0);
	});

	test.each([
		{ instruction: "make it in one shot", bypass: "one_shot" },
		{ instruction: "make the video; skip the questions", bypass: "skip_request" },
	])("honours $bypass: no questions, then generation", async ({ instruction, bypass }) => {
		let questions = 0;
		setStoryClarificationPlannerForTests(async () => {
			questions++;
			return preBatch;
		});
		const job = await videoRun(instruction);
		const result = await conversation(job, [build, ...finishing("Built.")]).start();
		expect(result.finishReason).not.toBe("suspended");
		expect(questions).toBe(0);
		const current = await run(job);
		expect(current.run?.storyClarification?.provenance?.bypass).toBe(bypass);
		expect(current.scenes.length).toBeGreaterThan(0);
	});

	test("asks before replacing an approved plan; rejection keeps it and generates nothing", async () => {
		const first = await videoRun("make it in one shot");
		await conversation(first, [
			callTool("workflow-plan_story", { inputData: { brief: BRIEF } }),
			answer("Planned."),
		]).start();
		const planned = (await loadRun(first.id))!;
		const draft = getStoryPlan(planned)!;
		const state = approveStoryDraft(draft.generationState!, "explicit");
		setStoryPlan(planned, draft.targetSec, draft.sections, true, false, {
			...draft,
			generationState: state,
		});
		recordApprovedPlan(planned, state.approvedSnapshot!);
		const job = await videoRun("make it in one shot", (next) => {
			next.artifacts = structuredClone(planned.artifacts);
		});
		const frames = planningCalls.frames;
		const chat = conversation(job, [build, ...finishing("Kept the plan.")]);
		expect((await chat.start()).finishReason).toBe("suspended");
		expect(asked(await run(job), REPLACE_GATE)).toBe(true);
		await chat.answer("Reject");
		const current = await run(job);
		expect(planningCalls.frames).toBe(frames);
		expect(generated()).toBe(0);
		expect(getStoryPlan(current)?.generationState?.approvedSnapshot?.revisionId).toBe(
			state.approvedSnapshot!.revisionId,
		);
	});

	test("routes raw direction once before planning", async () => {
		const seen: string[] = [];
		setDirectionRouterForTests(async (raw) => {
			seen.push(raw);
			return { story: "", visual: "ink sketch", voice: "calm", rules: "" };
		});
		const job = await videoRun("make it in one shot", (draft) => {
			draft.direction = {
				raw: "ink sketch, calm voice",
				story: "",
				visual: "",
				voice: "",
				rules: "",
			};
		});
		await conversation(job, [build, ...finishing("Built.")]).start();
		expect(seen).toEqual(["ink sketch, calm voice"]);
		expect((await run(job)).direction?.visual).toBe("ink sketch");
	});

	test("generates without the interactive plan-approval gate, approving implicitly", async () => {
		const job = await videoRun("make it in one shot");
		const result = await conversation(job, [build, ...finishing("Built.")]).start();
		expect(result.finishReason).not.toBe("suspended");
		const current = await run(job);
		expect(asked(current, PLAN_GATE)).toBe(false);
		expect(getStoryPlan(current)?.generationState?.approvedSnapshot).toBeDefined();
		expect(current.scenes.length).toBeGreaterThan(0);
		expect(
			current.events.some(
				(event) => event.kind === "tool_call_completed" && event.tool === "create_story_video",
			),
		).toBe(true);
		expect(current.run?.builtSomething).toBe(true);
	});
});
