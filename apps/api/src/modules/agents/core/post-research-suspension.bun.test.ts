/* Parking planning at its post-research question.
 *
 * The engine saves the flow record — frame, research key, cursor — after every
 * node, so by the time the question is raised the held state is already on the
 * run. These tests drive the planning core on the engine with the evidence
 * analysis stubbed, so the planning path, the flow record and the required action
 * are all real. */
import { setResearch } from "./research-state.ts";
import { dropJobArtifacts } from "./artifact-store.ts";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDir = mkdtempSync(join(tmpdir(), "post-research-suspend-"));
process.env.MALEO_DB_PATH = join(tmpDir, "test.db");

import { PLANNING_CALL, planStory } from "./__tests__/support/plan-story.ts";
import { setEvidenceAnalyzerForTests } from "./post-research-clarification.ts";
import { postResearchClarificationState } from "./story-clarification.ts";
import { getStoryPlan } from "./plan-state.ts";
import { loadRun, saveRun } from "./run-repository.ts";
import { startAgentJob } from "./run-bracket.ts";
import { clearAgentJobsForTests } from "./session-store.ts";
import { setResearchProviderForTests } from "./services/research.ts";
import {
	setStoryBibleAuthorForTests,
	setStoryFramePlannerForTests,
	setStoryPlannerForTests,
	setStyleBibleGeneratorForTests,
} from "../../../lib/content-generator.ts";
import type { AgentJob } from "./model.ts";
import type { StoryClarificationBatch } from "@maleo/shared";
import { createContentProject } from "@maleo/db/project-detail";
import { clearWorkflowRunsForTests } from "@maleo/db/workflow-run-db";
import { closeMaleoDb } from "@maleo/db/connection";

const BRIEF = "why compound interest is counter-intuitive";

const BATCH: StoryClarificationBatch = {
	id: "post-1",
	stage: "post_research",
	purpose: "story_brief",
	intro: "The sources disagree on one thing.",
	questions: [
		{
			id: "case",
			header: "Case study",
			question: "Which fund should the video follow?",
			options: [
				{
					id: "ohio",
					label: "Ohio",
					value: "Use the Ohio fund",
					description: "Frames it around a high-return fund.",
					recommended: true,
					sources: [{ title: "Ohio pension study", url: "https://example.test/ohio" }],
				},
				{
					id: "vt",
					label: "Vermont",
					value: "Use the Vermont fund",
					description: "A low-return counterexample.",
				},
			],
		},
	],
};

const RESEARCH = {
	topic: BRIEF,
	queries: ["compound interest"],
	sources: [
		{
			title: "Ohio pension study",
			url: "https://example.test/ohio",
			excerpt: "7.1% over 30 years.",
			retrievedAt: "2026-09-01T00:00:00.000Z",
		},
		{
			title: "Vermont pension study",
			url: "https://example.test/vermont",
			excerpt: "4.4% over 30 years.",
			retrievedAt: "2026-09-01T00:00:00.000Z",
		},
	],
	claims: [],
};

/* A run mid-`plan_story`: the decision was made, the tool is executing. This is
 * the state preparation actually suspends from. */
async function planningJob(title: string): Promise<AgentJob> {
	const projectId = (await createContentProject({ title, type: "video" })).project.id;
	const job = await startAgentJob({
		projectId,
		instruction: "make it",
		contentType: "video",
		context: { targetDurationSec: 90 },
	});
	job.status = "running";
	job.targetDurationSec = 90;
	setResearch(job, RESEARCH);
	job.run = {
		instruction: "make it",
		transcript: "",
		step: 2,
		builtSomething: false,
		finishRejected: false,
		asks: 0,
	};
	return job;
}

beforeEach(async () => {
	clearAgentJobsForTests();
	await clearWorkflowRunsForTests();
	// The frame is stubbed so preparation is deterministic and cheap; research is
	// already on the job, so the provider must never be reached.
	setStoryFramePlannerForTests(async () => ({
		planKind: "explainer",
		arc: "three_act",
		language: "en",
		grounding: { needed: true, questions: ["what returns are typical?"] },
	}));
	setResearchProviderForTests({
		search: async () => {
			throw new Error("research must not run");
		},
		readPage: async () => {
			throw new Error("research must not run");
		},
	} as unknown as Parameters<typeof setResearchProviderForTests>[0]);
	setStoryPlannerForTests(async () => [
		{ title: "Opening", narration: "A concise opening.", visualPrompt: "Base visual" },
	]);
	setStyleBibleGeneratorForTests(async () => "test style bible");
	setStoryBibleAuthorForTests(async () => ({
		subjects: [{ id: "s", label: "subject" }],
		locations: [{ id: "l", label: "place" }],
		medium: "m",
		palette: "p",
		negatives: ["n"],
	}));
});
afterEach(() => {
	setEvidenceAnalyzerForTests(null);
	setStoryFramePlannerForTests(null);
	setResearchProviderForTests(null);
	setStoryPlannerForTests(null);
	setStyleBibleGeneratorForTests(null);
	setStoryBibleAuthorForTests(null);
});
afterAll(async () => {
	await closeMaleoDb();
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("a material evidence decision parks the plan", () => {
	test("the tool reports suspension and drafts nothing", async () => {
		setEvidenceAnalyzerForTests(async () => ({ kind: "batch", batch: BATCH }));
		const job = await planningJob("suspend-drafts-nothing");

		const result = await planStory(job, { brief: BRIEF, targetDurationSec: 90 });

		expect(result.suspended).toBe(true);
		expect(result.note).toContain("1 editorial decision");
		// No plan exists yet — the skeleton and the draft have not run.
		expect(getStoryPlan(job)).toBeFalsy();
		expect(job.status).toBe("awaiting_input");
	});

	test("the flow record holds the frame, the research key and the cursor at the question", async () => {
		setEvidenceAnalyzerForTests(async () => ({ kind: "batch", batch: BATCH }));
		const job = await planningJob("suspend-checkpoint");

		await planStory(job, { brief: BRIEF, targetDurationSec: 90 });

		const record = job.run?.flows?.[PLANNING_CALL];
		expect(record).toMatchObject({
			workflow: "plan_story_core",
			status: "suspended",
			cursor: "ask-evidence",
		});
		expect(JSON.stringify(record?.state.framed)).toContain('"arc":"three_act"');
		expect(JSON.stringify(record?.state.hold)).toMatch(/"researchKey":"[^"]+"/);
		expect(JSON.stringify(record?.state.setup)).toContain('"targetSec":90');
	});

	test("the batch, its action id and the checkpoint all survive the snapshot", async () => {
		setEvidenceAnalyzerForTests(async () => ({ kind: "batch", batch: BATCH }));
		const job = await planningJob("suspend-survives-restart");

		await planStory(job, { brief: BRIEF, targetDurationSec: 90 });
		await saveRun(job);
		const reloaded = (await loadRun(job.id))!;

		expect(reloaded.status).toBe("awaiting_input");
		expect(reloaded.pendingActionId).toBeTruthy();
		expect(postResearchClarificationState(reloaded)?.status).toBe("pending");
		expect(postResearchClarificationState(reloaded)?.actionId).toBe(reloaded.pendingActionId);
		expect(postResearchClarificationState(reloaded)?.batch?.id).toBe("post-1");
		expect(reloaded.run?.flows?.[PLANNING_CALL]?.cursor).toBe("ask-evidence");
	});

	test("the question reaches the user as a batch, with its sourced options", async () => {
		setEvidenceAnalyzerForTests(async () => ({ kind: "batch", batch: BATCH }));
		const job = await planningJob("suspend-question-event");

		await planStory(job, { brief: BRIEF, targetDurationSec: 90 });

		const question = job.events.find((event) => event.kind === "question");
		expect(question).toBeTruthy();
		expect(job.pendingQuestion?.batch?.stage).toBe("post_research");
		expect(job.pendingQuestion?.batch?.questions[0]?.options[0]?.sources?.[0]?.url).toBe(
			"https://example.test/ohio",
		);
	});

	test("the pre-research checkpoint's own state is not overwritten", async () => {
		setEvidenceAnalyzerForTests(async () => ({ kind: "batch", batch: BATCH }));
		const job = await planningJob("suspend-keeps-pre-research");
		job.run!.storyClarification = {
			status: "answered",
			provenance: {
				batchId: "pre-1",
				stage: "pre_research",
				status: "answered",
				decisions: [
					{
						questionId: "q1",
						header: "Audience",
						question: "Who?",
						answer: "beginners",
						source: "option",
						status: "supplied",
					},
				],
			},
		};

		await planStory(job, { brief: BRIEF, targetDurationSec: 90 });

		// Two checkpoints, two slots. The earlier decisions are still there.
		expect(job.run?.storyClarification?.provenance?.decisions[0]?.answer).toBe("beginners");
		expect(postResearchClarificationState(job)?.status).toBe("pending");
	});
});

/* Every planning run is resumable now — it runs on the engine inside a tool call —
 * so the question is asked unless the request bypassed questions. */
describe("who is asked", () => {
	test("a run with no pending tool call is asked too", async () => {
		let analyzed = 0;
		setEvidenceAnalyzerForTests(async () => {
			analyzed++;
			return { kind: "batch", batch: BATCH };
		});
		const job = await planningJob("no-pending-call-asks");
		job.run!.pendingTool = undefined;

		const result = await planStory(job, { brief: BRIEF, targetDurationSec: 90 });

		expect(result.suspended).toBe(true);
		expect(analyzed).toBe(1);
	});

	test("an explicit one-shot or skip request is not asked", async () => {
		for (const bypass of ["one_shot", "skip_request"] as const) {
			let analyzed = 0;
			setEvidenceAnalyzerForTests(async () => {
				analyzed++;
				return { kind: "batch", batch: BATCH };
			});
			const job = await planningJob(`bypass-${bypass}`);
			job.run!.storyClarification = {
				status: "bypassed",
				provenance: { stage: "pre_research", status: "bypassed", bypass, decisions: [] },
			};

			const result = await planStory(job, { brief: BRIEF, targetDurationSec: 90 });

			expect(result.suspended).toBeUndefined();
			expect(analyzed).toBe(0);
		}
	});

	test("a bypass the SYSTEM recorded does not suppress the question", async () => {
		// "unavailable" means the pre-research generator produced nothing. That says
		// nothing about whether the sources raise a fork, so the question stands.
		setEvidenceAnalyzerForTests(async () => ({ kind: "batch", batch: BATCH }));
		const job = await planningJob("bypass-unavailable");
		job.run!.storyClarification = {
			status: "bypassed",
			provenance: {
				stage: "pre_research",
				status: "bypassed",
				bypass: "unavailable",
				decisions: [],
			},
		};

		const result = await planStory(job, { brief: BRIEF, targetDurationSec: 90 });

		expect(result.suspended).toBe(true);
	});
});

describe("no material choice means no interruption", () => {
	test("an empty analysis drafts the plan and opens nothing", async () => {
		setEvidenceAnalyzerForTests(async () => ({ kind: "none" }));
		const job = await planningJob("no-choice-continues");

		const result = await planStory(job, { brief: BRIEF, targetDurationSec: 90 });

		expect(result.suspended).toBeUndefined();
		expect(result.note).toContain("Planned");
		expect(getStoryPlan(job)?.sections).toHaveLength(1);
		expect(job.status).not.toBe("awaiting_input");
		expect(postResearchClarificationState(job)).toBeUndefined();
		expect(job.run?.flows?.[PLANNING_CALL]?.status).toBe("completed");
	});

	test("a failed analysis drafts the plan too, and says what happened", async () => {
		setEvidenceAnalyzerForTests(async () => ({ kind: "fallback", reason: "provider down" }));
		const job = await planningJob("fallback-continues");

		const result = await planStory(job, { brief: BRIEF, targetDurationSec: 90 });

		expect(result.suspended).toBeUndefined();
		expect(result.note).toContain("Planned");
		expect(getStoryPlan(job)?.sections).toHaveLength(1);
		// The degradation is visible rather than indistinguishable from "found nothing".
		const note = job.events.find(
			(event) => event.kind === "thinking_note" && event.title === "Evidence review",
		);
		expect(note).toBeTruthy();
		expect(JSON.stringify(note)).toContain("best judgment");
		expect(JSON.stringify(note)).toContain("provider down");
	});

	test("an ungrounded plan never reaches the analysis at all", async () => {
		let analyzed = 0;
		setEvidenceAnalyzerForTests(async () => {
			analyzed++;
			return { kind: "none" };
		});
		setStoryFramePlannerForTests(async () => ({
			planKind: "story",
			arc: "three_act",
			language: "en",
			grounding: { needed: false, questions: [] },
		}));
		const job = await planningJob("ungrounded-skips-analysis");
		dropJobArtifacts(job, "research_bundle");

		await planStory(job, { brief: BRIEF, targetDurationSec: 90 });

		expect(analyzed).toBe(0);
		expect(getStoryPlan(job)).toBeTruthy();
	});
});
