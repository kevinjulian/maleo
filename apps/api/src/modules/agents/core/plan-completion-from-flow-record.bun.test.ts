/* Completing a parked plan from its flow record alone.
 *
 * The point of saving after every node is that the work after the wait costs only
 * a draft. Completion that re-ran the frame would pay for a model call it already
 * made; re-running research would pay again and could return different sources
 * than the ones the user was just asked about.
 *
 * Each test parks planning at its post-research question, reloads the run the way
 * a restarted process would — state from the record, nothing from memory — then
 * stubs the frame planner and the research provider to THROW and answers. A
 * resume that re-runs either fails loudly instead of passing quietly. */
import { dropJobArtifacts } from "./artifact-store.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setResearch } from "./research-state.ts";
import { loadRun, saveRun } from "./run-repository.ts";
import { startAgentJob } from "./run-bracket.ts";
import { clearAgentJobsForTests } from "./session-store.ts";
import { getStoryPlan } from "./plan-state.ts";
import { fingerprintBrief } from "./services/util.ts";
import { setResearchProviderForTests } from "./services/research.ts";
import { setEvidenceAnalyzerForTests } from "./post-research-clarification.ts";
import { encodeClarificationAnswer } from "./story-clarification.ts";
import {
	setStoryBibleAuthorForTests,
	setStoryFramePlannerForTests,
	setStoryPlannerForTests,
	setStyleBibleGeneratorForTests,
	type StoryPlanOpts,
} from "../../../lib/content-generator.ts";
import type { AgentJob } from "./model.ts";
import type { StoryClarificationBatch } from "@maleo/shared";
import { createContentProject } from "@maleo/db/project-detail";
import { clearWorkflowRunsForTests } from "@maleo/db/workflow-run-db";
import { closeMaleoDb } from "@maleo/db/connection";
import { afterAll } from "bun:test";
import { planStory } from "./__tests__/support/plan-story.ts";

const BRIEF = "why compound interest is counter-intuitive";
const RESEARCH_TOPIC = BRIEF;

const HELD_RESEARCH = {
	topic: RESEARCH_TOPIC,
	queries: ["compound interest returns"],
	sources: [
		{
			title: "Ohio pension study",
			url: "https://example.test/ohio",
			excerpt: "Ohio's fund compounded at 7.1% over 30 years.",
			retrievedAt: "2026-09-01T00:00:00.000Z",
		},
		{
			title: "Federal Reserve note",
			url: "https://example.test/fed",
			excerpt: "Household savings rarely compound uninterrupted.",
			retrievedAt: "2026-09-01T00:00:00.000Z",
		},
	],
	claims: [],
};

const BATCH: StoryClarificationBatch = {
	id: "post-1",
	stage: "post_research",
	purpose: "story_brief",
	questions: [
		{
			id: "case",
			header: "Case study",
			question: "Which fund?",
			options: [
				{
					id: "ohio",
					label: "Ohio",
					value: "Use the Ohio fund",
					description: "High return.",
					recommended: true,
					sources: [{ title: "Ohio pension study", url: "https://example.test/ohio" }],
				},
				{
					id: "fed",
					label: "Household",
					value: "Use household savings",
					description: "Low return.",
				},
			],
		},
	],
};
const ANSWER = encodeClarificationAnswer({
	batchId: "post-1",
	answers: [{ questionId: "case", optionId: "ohio" }],
});

/* Planning parked at its post-research question, persisted, then reloaded — which
 * is all a restarted process has. */
async function restartedParkedJob(
	title: string,
	prepare?: (job: AgentJob) => void,
): Promise<AgentJob> {
	const projectId = (await createContentProject({ title, type: "video" })).project.id;
	const job = await startAgentJob({
		projectId,
		instruction: "make it",
		contentType: "video",
		context: { targetDurationSec: 90 },
	});
	job.status = "running";
	setResearch(job, HELD_RESEARCH);
	job.run = {
		instruction: "make it",
		transcript: "",
		step: 2,
		builtSomething: false,
		finishRejected: false,
		asks: 0,
	};
	prepare?.(job);
	setStoryFramePlannerForTests(async () => ({
		planKind: "explainer",
		arc: "three_act",
		language: "en",
		grounding: { needed: true, questions: ["what returns are typical?"] },
	}));
	setEvidenceAnalyzerForTests(async () => ({ kind: "batch", batch: BATCH }));
	const parked = await planStory(job, { brief: BRIEF, targetDurationSec: 90, sectionCount: 4 });
	if (!parked.suspended) throw new Error("planning did not park at its question");
	await saveRun(job);
	clearAgentJobsForTests();
	const reloaded = await loadRun(job.id);
	if (!reloaded) throw new Error("the parked run did not persist");
	reloaded.status = "running";
	// From here on, both earlier stages are paid for: re-entering either is the bug.
	setStoryFramePlannerForTests(async () => {
		frameCalls++;
		throw new Error("the frame must not run again");
	});
	return reloaded;
}

let frameCalls = 0;
let researchCalls = 0;

beforeEach(async () => {
	clearAgentJobsForTests();
	await clearWorkflowRunsForTests();
	frameCalls = 0;
	researchCalls = 0;
	// Research is already held on the job: the provider must never be reached.
	setResearchProviderForTests({
		search: async () => {
			researchCalls++;
			throw new Error("research must not run again");
		},
		readPage: async () => {
			researchCalls++;
			throw new Error("research must not run again");
		},
	} as unknown as Parameters<typeof setResearchProviderForTests>[0]);
	setStyleBibleGeneratorForTests(async () => "test style bible");
	setStoryBibleAuthorForTests(async () => ({
		subjects: [{ id: "s", label: "subject" }],
		locations: [{ id: "l", label: "place" }],
		medium: "test medium",
		palette: "test palette",
		negatives: ["none"],
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
afterAll(closeMaleoDb);

describe("completion after a restart", () => {
	test("drafts the plan without re-running the frame or research", async () => {
		let draftedAgainst: { brief: string; sources: number } | undefined;
		setStoryPlannerForTests(async (brief, _target, opts?: StoryPlanOpts) => {
			draftedAgainst = { brief, sources: opts?.research?.sources.length ?? 0 };
			return [{ title: "Opening", narration: "A concise opening.", visualPrompt: "Base visual" }];
		});
		const job = await restartedParkedJob("complete-no-rerun");

		const result = await planStory(
			job,
			{ brief: BRIEF, targetDurationSec: 90 },
			{ answer: ANSWER },
		);

		expect(frameCalls).toBe(0);
		expect(researchCalls).toBe(0);
		expect(result.note).toContain("Planned");
		expect(getStoryPlan(job)?.sections).toHaveLength(1);
		// The held sources reached the draft, resolved by the held research key.
		expect(draftedAgainst?.sources).toBe(2);
		expect(draftedAgainst?.brief).toContain(BRIEF);
		expect(draftedAgainst?.brief).toContain("Use the Ohio fund");
	});

	test("the plan keeps the held research identity and the pre-research provenance", async () => {
		setStoryPlannerForTests(async () => [
			{ title: "Opening", narration: "A concise opening.", visualPrompt: "Base visual" },
		]);
		const job = await restartedParkedJob("complete-provenance", (draft) => {
			draft.run!.storyClarification = {
				status: "answered",
				provenance: {
					batchId: "batch-1",
					stage: "pre_research",
					status: "answered",
					decisions: [
						{
							questionId: "q1",
							header: "Audience",
							question: "Who is this for?",
							answer: "beginners",
							source: "option",
							status: "supplied",
						},
					],
				},
			};
		});

		await planStory(job, { brief: BRIEF, targetDurationSec: 90 }, { answer: ANSWER });

		const plan = getStoryPlan(job);
		expect(plan?.researchKey).toBe(fingerprintBrief(RESEARCH_TOPIC));
		expect(plan?.factual).toBe(true);
		expect(plan?.clarification?.status).toBe("answered");
		expect(plan?.clarification?.decisions[0]?.answer).toBe("beginners");
	});

	test("held state comes from the flow record, not from the resumed call or the transcript", async () => {
		let seenSectionCount = 0;
		setStoryPlannerForTests(async (_brief, _target, opts?: StoryPlanOpts) => {
			seenSectionCount = opts?.sectionCount ?? 0;
			return [{ title: "Opening", narration: "A concise opening.", visualPrompt: "Base visual" }];
		});
		const job = await restartedParkedJob("complete-ignores-transcript");
		job.run!.transcript =
			"\nStep 1: the plan is a 12-section documentary in Indonesian about something else entirely.";

		await planStory(
			job,
			{ brief: "a totally different brief", targetDurationSec: 5, sectionCount: 12 },
			{ answer: ANSWER },
		);

		expect(seenSectionCount).toBe(4);
		expect(frameCalls).toBe(0);
	});

	test("held research that is gone drafts ungrounded and says so", async () => {
		setStoryPlannerForTests(async () => [
			{ title: "Opening", narration: "A concise opening.", visualPrompt: "Base visual" },
		]);
		const job = await restartedParkedJob("complete-lost-research");
		dropJobArtifacts(job, "research_bundle"); // the bundle did not survive

		const result = await planStory(
			job,
			{ brief: BRIEF, targetDurationSec: 90 },
			{ answer: ANSWER },
		);

		expect(result.note).toContain("UNVERIFIED DRAFT");
		expect(getStoryPlan(job)?.researchKey).toBeFalsy();
		expect(researchCalls).toBe(0); // it does NOT silently research again
	});
});
