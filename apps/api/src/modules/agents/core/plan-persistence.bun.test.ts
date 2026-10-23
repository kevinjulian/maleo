import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { persist, loadPriorArtifacts } from "./persistence.ts";
import type { AgentJob } from "./model.ts";
import type { PipelineArtifact } from "@maleo/shared";
import { storyPlanArtifactOf } from "@maleo/shared";
import { fixtureArtifacts } from "./artifact-fixtures.ts";

const dbPath = join(tmpdir(), "maleo-plan-persistence.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

function videoJob(projectId: string, artifacts: PipelineArtifact[]): AgentJob {
	return {
		id: `job-${Date.now()}`,
		projectId,
		contentType: "video",
		status: "running",
		events: [],
		scenes: [],
		textOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts,
		aspect: "9:16",
		brief: "",
		startedAt: Date.now(),
	};
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await resetDb();
});

afterEach(async () => {
	await resetDb();
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
});

describe("longform plan persistence round-trip", () => {
	// Regression for the "No editable content produced" 0-scene bug: plan_longform
	// creates the longform_plan on the in-memory job, but under the granular Inngest
	// path the approve→generate step rehydrates via loadPriorArtifacts (storyboards
	// only). Unless the plan is persisted into a storyboard version, generate finds
	// no plan and no-ops. planStoryFlow now calls persist(job); this proves the
	// persist → load round-trip recovers the plan.
	test("a persisted longform_plan is recovered by loadPriorArtifacts", async () => {
		const projectId = (await createContentProject({ title: "t", type: "video" })).project.id;
		await persist(
			videoJob(
				projectId,
				fixtureArtifacts(projectId, [
					{
						kind: "story_plan",
						payload: { targetSec: 120, sections: [], planningBrief: "hidup bahagia" },
					},
				]),
			),
		);

		const recovered = await loadPriorArtifacts(projectId);
		const found = storyPlanArtifactOf(recovered)?.payload;
		expect(found).toBeDefined();
		expect(found?.targetSec).toBe(120);
	});

	/* The revision loop redrafts against a CHANGED brief, so a bundle resolved by
	 * brief fingerprint disappears on the second iteration. `researchKey` is the
	 * plan's own identity for its evidence, and it has to survive the round-trip
	 * for `researchForPlan` to find the bundle after a rehydrate. */
	test("the grounding decision and the research key survive a rehydrate", async () => {
		const projectId = (await createContentProject({ title: "t", type: "video" })).project.id;
		await persist(
			videoJob(
				projectId,
				fixtureArtifacts(projectId, [
					{
						kind: "story_plan",
						payload: {
							targetSec: 120,
							sections: [],
							planningBrief: "sejarah Majapahit",
							factual: true,
							researchKey: "sejarah majapahit",
						},
					},
				]),
			),
		);

		const found = storyPlanArtifactOf(await loadPriorArtifacts(projectId))?.payload;
		expect(found?.factual).toBe(true);
		expect(found?.researchKey).toBe("sejarah majapahit");
	});

	test("the newest longform_plan survives a later clips-only autosave version", async () => {
		const projectId = (await createContentProject({ title: "t", type: "video" })).project.id;
		await persist(
			videoJob(
				projectId,
				fixtureArtifacts(projectId, [
					{ kind: "story_plan", payload: { targetSec: 90, sections: [] } },
				]),
			),
		);
		// Simulate a client timeline autosave: a newer storyboard version with clips but
		// NO artifacts. loadPriorArtifacts must still recover the plan from the older one.
		await persist(videoJob(projectId, []));

		const recovered = await loadPriorArtifacts(projectId);
		expect(recovered.some((a) => a.kind === "story_plan")).toBe(true);
	});
});
