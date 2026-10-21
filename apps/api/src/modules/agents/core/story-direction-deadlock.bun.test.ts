/* The regression lock for the approval deadlock.
 *
 * Observed live: edit a beat in the storyboard, undo that edit, press Approve —
 * refused, forever, with no way out but a full re-plan. Two rules combined to
 * produce it. A staling edit marked the plan `needsDirection` and nothing ever
 * cleared that mark; re-direction before approval ran only when the direction
 * inputs had drifted, and undoing the edit restored them. So the mark outlived
 * its cause and every later approval was refused by it.
 *
 * These tests drive that exact sequence, and the pair of rules that bound it:
 * repair runs for a plan that needs direction, and does not run for a blocker
 * only the operator can clear. */
import { storyInputsOf } from "./story-inputs.ts";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { setStorySequenceDirectorForTests } from "../../../lib/story/creative-director.ts";
import { getStoryPlan, setStoryPlan } from "./plan-state.ts";
import { refreshStoryDirectionForApproval } from "./services/planning.ts";
import {
	approveCurrentStoryPlan,
	currentStoryDirectionFingerprint,
	executeStoryboardCommand,
} from "./services/storyboard-command-service.ts";
import type { AgentJob } from "./model.ts";
import type { StorySection } from "../../../lib/story.ts";

const dbPath = join(tmpdir(), "maleo-story-direction-deadlock.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;
let directorCalls = 0;

const NARRATION = "Copper stops moving through the harbour.";

function editorial(index: number) {
	return {
		purpose: index ? ("reveal" as const) : ("establish" as const),
		presentation: "narrative" as const,
		visualConcept: `Concept ${index}`,
		noveltyKey: `novel-${index}`,
		sfxCue: null,
	};
}

function sections(): StorySection[] {
	return [0, 1].map((index) => ({
		id: `section-${index}`,
		sectionId: `section-${index}`,
		semanticBeatId: `beat-${index}`,
		title: `Section ${index}`,
		narration: index ? "The routes close one by one." : NARRATION,
		visualPrompt: `Image ${index}`,
		estimatedDurationSec: 5,
		editorial: editorial(index),
	})) as unknown as StorySection[];
}

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

function videoJob(projectId: string): AgentJob {
	return {
		id: `job-${Date.now()}`,
		projectId,
		contentType: "video",
		status: "running",
		events: [],
		scenes: [],
		textOverlays: [],
		infographicOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: [],
		aspect: "9:16",
		brief: "a bronze age collapse explainer",
		startedAt: Date.now(),
		styleImageUrl: "/style.png",
		targetDurationSec: 45,
	};
}

/** A job holding a directed, approvable plan — the state an operator reaches
 *  right after direction succeeds and before they touch anything. */
async function directedJob(): Promise<AgentJob> {
	const projectId = (await createContentProject({ title: "Deadlock", type: "video" })).project.id;
	const job = videoJob(projectId);
	const drafted = sections();
	setStoryPlan(job, 45, drafted, false, false, {
		planningBrief: job.brief,
		factual: false,
		visualStyle: "test style bible",
		structure: "narration_section",
		language: "en",
		// `referenceAliases` is the directed-plan marker the approval rule reads.
		referenceAliases: [],
		plannedReferences: [],
		needsDirection: false,
		directionErrors: [],
	});
	const plan = getStoryPlan(job)!;
	setStoryPlan(job, 45, plan.sections, false, false, {
		...plan,
		directionFingerprint: await currentStoryDirectionFingerprint(job, plan.sections),
	});
	return job;
}

async function updateNarration(
	job: AgentJob,
	narration: string,
	revisionId: string,
): Promise<void> {
	const state = getStoryPlan(job)!.generationState!;
	const beatId = state.draft.sections[0]!.beats[0]!.id;
	const result = await executeStoryboardCommand(
		job,
		state.draft.revisionId,
		{
			type: "update_beat",
			beatId,
			fields: { narration },
		},
		{ newRevisionId: revisionId, save: () => {} },
	);
	if (!result.ok) throw new Error(`edit refused: ${result.message}`);
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await resetDb();
	directorCalls = 0;
	setStorySequenceDirectorForTests(async () => {
		directorCalls += 1;
		return {
			plannedReferences: [],
			referenceAliases: [],
			beats: [0, 1].map((index) => ({
				beatId: `beat-${index}`,
				editorial: {
					...editorial(index),
					shots: [
						{
							index: 0,
							visualIntent: `Shot ${index}`,
							role: index ? "novelty" : "continuity",
							bindings: [],
							rationale: "Matches the narration.",
						},
					],
				},
			})),
		};
	});
});

afterEach(async () => {
	setStorySequenceDirectorForTests(null);
	await resetDb();
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
});

test("an edit that is undone does not lock approval", async () => {
	const job = await directedJob();
	expect((await approveCurrentStoryPlan(job, "explicit")).ok).toBe(true);

	await updateNarration(job, "A later draft of the same beat.", "edited");
	expect(getStoryPlan(job)!.needsDirection).toBe(true);

	// Undo: the narration — and with it the direction fingerprint — is back to
	// exactly what direction last saw.
	await updateNarration(job, NARRATION, "undone");
	const undone = getStoryPlan(job)!;
	expect(undone.directionFingerprint).toBe(
		await currentStoryDirectionFingerprint(job, undone.sections),
	);
	expect(undone.needsDirection).toBe(true);

	await refreshStoryDirectionForApproval(job, storyInputsOf(job));

	expect(getStoryPlan(job)!.needsDirection).toBe(false);
	expect((await approveCurrentStoryPlan(job, "explicit")).ok).toBe(true);
});

test("a blocker only the operator can clear spends no direction call", async () => {
	const job = await directedJob();
	const plan = getStoryPlan(job)!;
	setStoryPlan(job, 45, plan.sections, false, false, {
		...plan,
		needsDirection: true,
		directionBlocked: true,
		directionErrors: ["beat-0: shot 1 requires a product with no roster entity"],
	});

	expect(await refreshStoryDirectionForApproval(job, storyInputsOf(job))).toBe(false);
	expect(directorCalls).toBe(0);

	const refused = await approveCurrentStoryPlan(job, "explicit");
	expect(refused.ok).toBe(false);
	if (refused.ok) throw new Error("expected refusal");
	expect(refused.reason).toBe("blocking_requirement");
	expect(refused.message).toContain("no roster entity");
});
