import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { clearWorkflowRunsForTests, listPendingRequiredActions } from "@maleo/db/workflow-run-db";
import { approveStoryDraft, type StoryClarificationBatch } from "@maleo/shared";
import { recordApprovedPlan } from "../../../approval-state.ts";
import { getStoryPlan, setStoryPlan } from "../../../plan-state.ts";
import { buildAgentJob } from "../../../run-bracket.ts";
import { loadRun, saveRun } from "../../../run-repository.ts";
import { encodeClarificationAnswer } from "../../../story-clarification.ts";
import { setStoryClarificationPlannerForTests } from "../../../story-clarification-planner.ts";
import { setResearch } from "../../../research-state.ts";
import { setResearchProviderForTests } from "../../../services/research.ts";
import {
	setDirectionRouterForTests,
	setStyleBibleGeneratorForTests,
	setStoryBibleAuthorForTests,
} from "../../../../../../lib/content-generator.ts";
import { PLANNING_CALL, planStory } from "../../../__tests__/support/plan-story.ts";
import { runState } from "../../run-state.ts";
import { runToolFlow } from "../../../engine/host.ts";
import { planningRegistry } from "../../../engine/planning/registry.ts";
import { clearAgentJobsForTests } from "../../../session-store.ts";
import { conversation } from "../support/conversation.ts";
import {
	installPlanningProviders,
	planningCalls,
	removePlanningProviders,
} from "../support/planning-fixture.ts";
import { answer, callTool } from "../support/scripted-model.ts";
import { expectDifferential } from "../support/planning-differential.ts";

const brief = "why compound interest is counter-intuitive";
const plan = callTool("workflow-plan_story", { inputData: { brief } });
const preBatch: StoryClarificationBatch = {
	id: "pre-baseline",
	stage: "pre_research",
	purpose: "story_brief",
	questions: [
		{
			id: "audience",
			header: "Audience",
			question: "Who watches?",
			options: [
				{
					id: "new",
					label: "Beginners",
					value: "Explain for beginners",
					description: "Introduce the subject.",
					recommended: true,
				},
				{
					id: "expert",
					label: "Experts",
					value: "Explain for experts",
					description: "Assume prior knowledge.",
				},
			],
		},
	],
};

async function newRun() {
	const projectId = (
		await createContentProject({ title: "Synthetic planning baseline", type: "video" })
	).project.id;
	const job = await buildAgentJob({
		projectId,
		instruction: "make a 90 second video about compounding",
		brief,
		contentType: "video",
	});
	await saveRun(job);
	return job;
}

async function capture(name: string, chat: ReturnType<typeof conversation>) {
	const snapshot = await chat.snapshot();
	const file = new URL(`../support/planning-baseline/${name}.json`, import.meta.url);
	if (process.env.MALEO_CAPTURE_PLANNING_BASELINE === "1") {
		await Bun.write(file, `${JSON.stringify(snapshot, null, 2)}\n`);
	}
	const baseline: typeof snapshot = await Bun.file(file).json();
	expect(baseline.job?.contentType).toBe("video");
	expect(baseline.job?.projectId).toBeTruthy();
	expect(snapshot.job?.status).toBe(baseline.job?.status);
	// Planning runs on the engine: no plan_story workflow rows, and the flow record on the run.
	expect(baseline.framework.runs.some((row) => row.workflowName === "plan_story")).toBe(false);
	expect(baseline.job?.run?.flows?.["call-workflow-plan_story"]?.workflow).toBe("plan_story");
	return snapshot.job!;
}

beforeEach(() => clearWorkflowRunsForTests());
afterEach(() => {
	removePlanningProviders();
	setDirectionRouterForTests(null);
});
afterAll(closeMaleoDb);

test("baseline stores a completed plan without media", async () => {
	installPlanningProviders("none", { grounded: false });
	const job = await newRun();
	const chat = conversation(job, [plan, answer("Plan ready.")]);
	await chat.start();
	const current = await capture("complete", chat);
	expect(getStoryPlan(current)?.sections).toHaveLength(1);
	expect(current.scenes).toEqual([]);
	expect(planningCalls.frames).toBe(1);
	expect(planningCalls.searches).toBe(0);
	await expectDifferential("complete", job.id);
});

test("baseline pre-research answer survives process restart", async () => {
	installPlanningProviders("none", { grounded: false });
	setStoryClarificationPlannerForTests(async () => preBatch);
	const job = await newRun();
	const chat = conversation(job, [plan, answer("Plan ready.")]);
	expect((await chat.start()).finishReason).toBe("suspended");
	await capture("pre-research", chat);
	expect(planningCalls.frames).toBe(0);
	await chat.restoreSnapshot();
	await chat.answer(
		encodeClarificationAnswer({
			batchId: preBatch.id,
			answers: [{ questionId: "audience", optionId: "new" }],
		}),
	);
	expect(planningCalls.frames).toBe(1);
	expect(planningCalls.drafts[0]).toContain("Explain for beginners");
	await expectDifferential("pre-research", job.id);
});

test("baseline post-research answer reuses held frame and research", async () => {
	installPlanningProviders("batch");
	const job = await newRun();
	const chat = conversation(job, [plan, answer("Plan ready.")]);
	expect((await chat.start()).finishReason).toBe("suspended");
	const current = await capture("post-research", chat);
	expect(current.run?.flows?.["call-workflow-plan_story"]?.calls.plan?.cursor).toBe("ask-evidence");
	const frames = planningCalls.frames;
	const searches = planningCalls.searches;
	await chat.restoreSnapshot();
	await chat.answer(
		encodeClarificationAnswer({
			batchId: "post-1",
			answers: [{ questionId: "case", optionId: "vt" }],
		}),
	);
	expect(planningCalls.frames).toBe(frames);
	expect(planningCalls.searches).toBe(searches);
	expect(planningCalls.drafts[0]).toContain("Vermont");
	await expectDifferential("post-research", job.id);
});

test("baseline replacement approval rejects without further planning", async () => {
	installPlanningProviders("none", { grounded: false });
	const job = await newRun();
	await conversation(job, [plan, answer("Plan ready.")]).start();
	const current = (await loadRun(job.id))!;
	const draft = getStoryPlan(current)!;
	const state = approveStoryDraft(draft.generationState!, "explicit");
	setStoryPlan(current, draft.targetSec, draft.sections, true, false, {
		...draft,
		generationState: state,
	});
	recordApprovedPlan(current, state.approvedSnapshot!);
	current.status = "running";
	await saveRun(current);
	// A second planning call on the same run: a new tool-call id, as a model issues.
	const chat = conversation(current, [
		callTool("workflow-plan_story", { inputData: { brief } }, "call-plan-again"),
		answer("Kept approved plan."),
	]);
	expect((await chat.start()).finishReason).toBe("suspended");
	await capture("replacement-approval", chat);
	const frames = planningCalls.frames;
	await chat.restoreSnapshot();
	await chat.answer("Reject");
	expect(planningCalls.frames).toBe(frames);
	expect(
		getStoryPlan((await loadRun(job.id))!)?.generationState?.approvedSnapshot?.revisionId,
	).toBe(state.approvedSnapshot?.revisionId);
	await expectDifferential("replacement-reject", job.id);
});

test("replacement approval resumes the same guard and plans only after acceptance", async () => {
	installPlanningProviders("none", { grounded: false });
	const job = await newRun();
	await conversation(job, [plan, answer("Plan ready.")]).start();
	const current = (await loadRun(job.id))!;
	const draft = getStoryPlan(current)!;
	const state = approveStoryDraft(draft.generationState!, "explicit");
	setStoryPlan(current, draft.targetSec, draft.sections, true, false, {
		...draft,
		generationState: state,
	});
	recordApprovedPlan(current, state.approvedSnapshot!);
	const replacement = await buildAgentJob({
		projectId: current.projectId,
		instruction: "replace the approved plan",
		brief,
		contentType: "video",
	});
	// A new request gets a new run identity; prior approved artifacts are its inputs.
	replacement.artifacts = structuredClone(current.artifacts);
	await saveRun(replacement);
	const chat = conversation(replacement, [plan, answer("New plan ready.")]);
	const before = planningCalls.frames;
	expect((await chat.start()).finishReason).toBe("suspended");
	expect(planningCalls.frames).toBe(before);
	expect((await loadRun(replacement.id))?.pendingActionId).toBeTruthy();
	await chat.restoreSnapshot();
	await chat.answer("Approve");
	expect(planningCalls.frames).toBe(before + 1);
	expect((await loadRun(replacement.id))?.scenes).toEqual([]);
	await expectDifferential("replacement-accept", replacement.id);
});

test("baseline matching research avoids retrieval while framing once", async () => {
	installPlanningProviders("none");
	const job = await newRun();
	setResearch(job, {
		topic: brief,
		queries: [brief],
		sources: [
			{
				title: "Held study",
				url: "https://example.test/held",
				excerpt: "A held study of compounding over thirty years.",
				retrievedAt: "2026-10-14T00:00:00.000Z",
			},
		],
		claims: [],
	});
	await saveRun(job);
	await conversation(job, [plan, answer("Plan ready.")]).start();
	expect(planningCalls.frames).toBe(1);
	expect(planningCalls.searches).toBe(0);
	expect(planningCalls.drafts).toHaveLength(1);
	await expectDifferential("matching-research", job.id);
});

test("baseline research outage produces an honest unverified draft", async () => {
	installPlanningProviders("none");
	setResearchProviderForTests({
		search: async () => {
			throw new Error("synthetic research outage");
		},
		readPage: async () => {
			throw new Error("synthetic research outage");
		},
	});
	const job = await newRun();
	await conversation(job, [plan, answer("Unverified plan ready.")]).start();
	const current = (await loadRun(job.id))!;
	expect(planningCalls.frames).toBe(1);
	expect(planningCalls.drafts).toHaveLength(1);
	expect(current.scenes).toEqual([]);
	expect(
		current.events.some(
			(event) => event.kind === "tool_call_completed" && event.note.includes("UNVERIFIED DRAFT"),
		),
	).toBe(true);
	await expectDifferential("research-outage", job.id);
});

test.each([
	{ name: "raw direction", raw: "  ink sketch  ", visual: "", calls: 1 },
	{ name: "explicit visual channel", raw: "ink sketch", visual: "existing visual", calls: 0 },
	{ name: "empty direction", raw: "  ", visual: "", calls: 0 },
])(
	"direction structure preserves $name routing and persistence",
	async ({ raw, visual, calls }) => {
		installPlanningProviders("none", { grounded: false });
		const seen: string[] = [];
		setDirectionRouterForTests(async (input) => {
			seen.push(input);
			return { story: "", visual: "ink sketch", voice: "calm", rules: "no text" };
		});
		const job = await newRun();
		job.direction = { raw, story: "", visual, voice: "", rules: "" };
		await saveRun(job);
		await conversation(job, [plan, answer("Plan ready.")]).start();
		expect(seen).toHaveLength(calls);
		if (calls) expect(seen[0]).toBe("ink sketch");
		expect((await loadRun(job.id))?.direction?.visual).toBe(calls ? "ink sketch" : visual);
		await expectDifferential(
			`direction-${raw.trim() ? (visual ? "explicit" : "raw") : "empty"}`,
			job.id,
		);
	},
);

test.each([
	{ instruction: "make a video; skip the questions", bypass: "skip_request" },
	{ instruction: "make a video in one shot", bypass: "one_shot" },
])("clarification structure honors $bypass without asking", async ({ instruction, bypass }) => {
	installPlanningProviders("none", { grounded: false });
	let questions = 0;
	setStoryClarificationPlannerForTests(async () => {
		questions++;
		return preBatch;
	});
	const job = await newRun();
	runState(job).instruction = instruction;
	await saveRun(job);
	const done = await conversation(job, [plan, answer("Plan ready.")]).start();
	expect(done.finishReason).not.toBe("suspended");
	expect(questions).toBe(0);
	expect((await loadRun(job.id))?.run?.storyClarification?.provenance?.bypass).toBe(bypass);
	await expectDifferential(`clarification-${bypass}`, job.id);
});

test("preparation preserves generated sections without another frame or draft", async () => {
	installPlanningProviders("none", { grounded: false });
	const job = await newRun();
	await conversation(job, [plan, answer("Plan ready.")]).start();
	const current = (await loadRun(job.id))!;
	const existing = getStoryPlan(current)!;
	const sections = existing.sections.map((section) => ({ ...section, status: "ready" as const }));
	setStoryPlan(current, existing.targetSec, sections, true, false, { ...existing });
	const before = { frames: planningCalls.frames, drafts: planningCalls.drafts.length };
	current.status = "running";
	const result = await planStory(current, { brief: "replace everything" });
	expect(result.note).toContain("not re-planning");
	expect(planningCalls.frames).toBe(before.frames);
	expect(planningCalls.drafts).toHaveLength(before.drafts);
	expect(getStoryPlan(current)?.sections).toEqual(sections);
});

test("preparation preserves Story, Voice and Rules material routing", async () => {
	installPlanningProviders("none", { grounded: false });
	const job = await newRun();
	job.direction = {
		raw: "",
		story: "STORY_SENTINEL",
		voice: "VOICE_SENTINEL",
		rules: "RULES_SENTINEL",
		visual: "VISUAL_SENTINEL",
	};
	await saveRun(job);
	await conversation(job, [plan, answer("Plan ready.")]).start();
	const draft = planningCalls.drafts[0]!;
	expect(draft).toContain("STORY_SENTINEL");
	expect(draft).toContain("VOICE_SENTINEL");
	expect(draft).toContain("RULES_SENTINEL");
	expect(draft).not.toContain("VISUAL_SENTINEL");
	await expectDifferential("material-routing", job.id);
});

test.each([true, false])("completion respects selected style image: %s", async (selected) => {
	installPlanningProviders("none", { grounded: false });
	let styles = 0;
	let bibles = 0;
	setStyleBibleGeneratorForTests(async () => {
		styles++;
		return "Synthetic style";
	});
	setStoryBibleAuthorForTests(async () => {
		bibles++;
		return {
			subjects: [{ id: "s", label: "subject" }],
			locations: [],
			medium: "ink",
			palette: "black",
			negatives: [],
		};
	});
	const job = await newRun();
	if (selected) job.styleImageUrl = "https://example.test/selected-style.png";
	await saveRun(job);
	await conversation(job, [plan, answer("Plan ready.")]).start();
	expect(styles).toBe(selected ? 0 : 1);
	expect(bibles).toBe(1);
	expect(getStoryPlan((await loadRun(job.id))!)?.sections).toHaveLength(1);
	expect((await loadRun(job.id))?.scenes).toEqual([]);
	await expectDifferential(`style-image-${selected}`, job.id);
});

test("failed style and Bible remain best effort after drafting", async () => {
	installPlanningProviders("none", { grounded: false });
	setStyleBibleGeneratorForTests(async () => {
		throw new Error("synthetic style failure");
	});
	setStoryBibleAuthorForTests(async () => {
		throw new Error("synthetic Bible failure");
	});
	const job = await newRun();
	await conversation(job, [plan, answer("Plan ready.")]).start();
	const result = getStoryPlan((await loadRun(job.id))!);
	expect(result?.sections).toHaveLength(1);
	expect(result?.bible).toBeUndefined();
	expect((await loadRun(job.id))?.run?.flows?.["call-workflow-plan_story"]?.status).toBe(
		"completed",
	);
	await expectDifferential("best-effort", job.id);
});

test("current completed planning outcome replays after reload without provider work", async () => {
	installPlanningProviders("none", { grounded: false });
	const job = await newRun();
	const chat = conversation(job, [plan, answer("Plan ready.")]);
	await chat.start();
	await chat.restoreSnapshot();
	clearAgentJobsForTests();
	const restored = (await loadRun(job.id))!;
	const record = restored.run?.flows?.["call-workflow-plan_story"];
	expect(record?.status).toBe("completed");
	const calls = structuredClone(planningCalls);
	const planned = structuredClone(getStoryPlan(restored));
	// A durable retry of the same tool call finds the completed record and runs no node.
	const result = await runToolFlow({
		registry: planningRegistry(),
		job: restored,
		toolCallId: "call-workflow-plan_story",
		workflow: "plan_story",
		input: { brief },
	});
	expect(result).toEqual({ status: "completed", outcome: record!.outcome! });
	expect(planningCalls).toEqual(calls);
	expect(getStoryPlan(restored)).toEqual(planned);
	expect(restored.scenes).toEqual([]);
});

test("a failed save of the question cursor refuses suspension and leaves no answerable action", async () => {
	installPlanningProviders("batch");
	const job = await newRun();
	const db = openDb();
	const write = db.run.bind(db);
	const failure = spyOn(db, "run").mockImplementation(async (sql, params) => {
		if (
			sql.includes("INSERT INTO workflow_run") &&
			typeof params?.[7] === "string" &&
			params[7].includes('"cursor":"ask-evidence"')
		)
			throw new Error("synthetic cursor save failure");
		return write(sql, params);
	});
	try {
		await expect(planStory(job, { brief })).rejects.toThrow("synthetic cursor save failure");
	} finally {
		failure.mockRestore();
	}
	clearAgentJobsForTests();
	const restored = (await loadRun(job.id))!;
	expect(restored.status).not.toBe("awaiting_input");
	expect(restored.pendingActionId).toBeUndefined();
	expect(await listPendingRequiredActions(job.id)).toEqual([]);
	expect(planningCalls.drafts).toEqual([]);
	const priorFrames = planningCalls.frames;
	const priorSearches = planningCalls.searches;
	const result = await planStory(restored, { brief });
	expect(result.suspended).toBe(true);
	// The frame and research were checkpointed before the failed save: the retry asks without repeating them.
	expect(planningCalls.frames).toBe(priorFrames);
	expect(planningCalls.searches).toBe(priorSearches);
	expect((await loadRun(job.id))?.run?.flows?.[PLANNING_CALL]?.calls).toEqual({});
	expect((await loadRun(job.id))?.run?.flows?.[PLANNING_CALL]?.cursor).toBe("ask-evidence");
});

test("workflow plan over generated sections ends with the not-re-planning note", async () => {
	installPlanningProviders("none", { grounded: false });
	const job = await newRun();
	await conversation(job, [plan, answer("Plan ready.")]).start();
	const current = (await loadRun(job.id))!;
	const existing = getStoryPlan(current)!;
	const sections = existing.sections.map((section) => ({ ...section, status: "ready" as const }));
	setStoryPlan(current, existing.targetSec, sections, true, false, { ...existing });
	const rerun = await buildAgentJob({
		projectId: current.projectId,
		instruction: "plan it again",
		brief,
		contentType: "video",
	});
	rerun.artifacts = structuredClone(current.artifacts);
	await saveRun(rerun);
	const before = { frames: planningCalls.frames, drafts: planningCalls.drafts.length };
	const chat = conversation(rerun, [plan, answer("Kept.")]);
	const result = await chat.start();
	const after = (await loadRun(rerun.id))!;
	// Observed before the fix: the stage runner failed it with "stage plan completed without producing story_plan, storyboard_table".
	// SAFETY: the planning tool's result is its outcome, under `result` while it ran as a Mastra workflow.
	const raw = result.toolResults?.[0]?.payload?.result as
		| { ok?: boolean; note?: string; result?: { ok: boolean; note: string } }
		| undefined;
	const outcome = raw?.result ?? raw;
	expect(outcome?.ok).toBe(true);
	expect(outcome?.note).toContain("not re-planning");
	expect(planningCalls.frames).toBe(before.frames);
	expect(planningCalls.drafts).toHaveLength(before.drafts);
	expect(getStoryPlan(after)?.sections).toEqual(sections);
	await expectDifferential("preserve-generated", rerun.id);
});
