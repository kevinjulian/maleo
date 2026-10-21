import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { storyInputsOf } from "./story-inputs.ts";
import { recordApprovedPlan } from "./approval-state.ts";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { listProjectReferences } from "@maleo/db/references";
import { setTtsSynthesizerForTests } from "../../../lib/tts-synth.ts";
import { setStoryBeatVisualAuthorForTests } from "../../../lib/story/image-director.ts";
import { setAssetRetryDelayForTests, setSceneFrameGeneratorForTests } from "./visual-gen.ts";
import { getStoryPlan, setStoryPlan } from "./plan-state.ts";
import { generateStoryAssetsFlow } from "./services/story-assets.ts";
import { approveCurrentStoryPlan } from "./services/storyboard-command-service.ts";
import type { AgentJob } from "./model.ts";
import type { StorySection } from "../../../lib/story.ts";

const dbPath = join(tmpdir(), "maleo-story-reference-preflight.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;
let imageCalls: Array<{ name: string; refIds?: string[] }> = [];

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

function videoJob(projectId: string): AgentJob {
	return {
		id: "job-story-refs",
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
		brief: "pov kamu hidup di jaman batu",
		startedAt: Date.now(),
		styleImageUrl: "/style.png",
		targetDurationSec: 5,
	};
}

function section(): StorySection {
	return {
		id: "sec-1",
		title: "Batu pertama",
		narration: "",
		visualPrompt: "First-person hands chip a stone blade.",
		visualPrompts: ["First-person hands chip a stone blade."],
		refKeys: ["pov_protagonist"],
		visualRefKeys: [["pov_protagonist"]],
		estimatedDurationSec: 5,
		status: "draft",
	};
}

async function setupPlan(
	job: AgentJob,
	role: "character" | "location" | "product" | "prop" = "character",
): Promise<void> {
	setStoryPlan(job, 5, [section()], false, false, {
		planningBrief: job.brief,
		factual: false,
		visualStyle: "paleo sketch style",
		structure: "beat",
		language: "id",
		plannedReferences: [
			{
				key: "pov_protagonist",
				role,
				label: "POV manusia zaman batu",
				description: "First-person hands with rough hide wraps holding chipped stone tools.",
				visibilityMode: role === "product" ? "object" : "hands_body",
				status: "planned",
				sectionIds: ["sec-1"],
			},
		],
	});
	await approveCurrentStoryPlan(job, "explicit");
}

/* A directed approval: the frozen snapshot carries reference aliases. Recorded
 * as an approval, the way the approval path records one, because generation
 * consumes the recorded approval and not the plan's copy of it. */
function markApprovedPlanDirected(job: AgentJob): void {
	const plan = getStoryPlan(job)!;
	const approvedSnapshot = { ...plan.generationState!.approvedSnapshot!, referenceAliases: [] };
	setStoryPlan(job, plan.targetSec, plan.sections, true, false, {
		...plan,
		referenceAliases: [],
		generationState: { ...plan.generationState!, approvedSnapshot },
	});
	recordApprovedPlan(job, approvedSnapshot);
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await resetDb();
	imageCalls = [];
	setAssetRetryDelayForTests(0);
	setTtsSynthesizerForTests(async () => {
		throw new Error("TTS should not run for silent beat");
	});
	setStoryBeatVisualAuthorForTests(async (_section, beats) =>
		beats.map((_beat, index) => ({ beatIndex: index, visualMoment: `stone tool ${index + 1}` })),
	);
	setSceneFrameGeneratorForTests(async (scene) => {
		imageCalls.push({ name: scene.name, refIds: scene.refIds });
		return `/uploads/${imageCalls.length}.png`;
	});
});

afterEach(async () => {
	setSceneFrameGeneratorForTests(null);
	setTtsSynthesizerForTests(null);
	setStoryBeatVisualAuthorForTests(null);
	await resetDb();
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
});

describe("story reference preflight", () => {
	test("materializes planned prop references before section images", async () => {
		const projectId = (await createContentProject({ title: "POV", type: "video" })).project.id;
		const job = videoJob(projectId);
		await setupPlan(job, "prop");

		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]), "tool-ref");

		const plan = getStoryPlan(job);
		const ref = plan?.plannedReferences?.[0];
		expect(ref?.status).toBe("materialized");
		const entityId = ref?.entityId;
		expect(entityId).toBeTruthy();
		if (!entityId) throw new Error("expected materialized entity id");
		expect(plan?.sections[0]?.refIds).toEqual([entityId]);
		expect(plan?.sections[0]?.visualRefIds?.[0]).toEqual([entityId]);
		expect(
			(await listProjectReferences(projectId, { sceneKey: null })).map((row) => row.id),
		).toEqual([entityId]);
		expect(imageCalls[0]?.name).toBe("POV manusia zaman batu");
		expect(imageCalls.length).toBeGreaterThanOrEqual(2);
		expect(
			imageCalls.some((call) => call.name === "Batu pertama" && call.refIds?.[0] === entityId),
		).toBe(true);
	});

	/* This test used to assert the opposite: that a generated character reference
	 * held generation until it was "approved". That gate was unsatisfiable —
	 * nothing in the repository could write `materialized`, and a retry
	 * regenerated the image and re-threw, spending a provider call per attempt.
	 * `generation-cast-selection` requires the preflight to materialize every
	 * missing cast reference and hand image generation entity ids, which is what
	 * is asserted now. */
	test("materializes planned character references before section images", async () => {
		const projectId = (await createContentProject({ title: "POV", type: "video" })).project.id;
		const job = videoJob(projectId);
		await setupPlan(job);

		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]), "tool-ref");

		const plan = getStoryPlan(job);
		const ref = plan?.plannedReferences?.[0];
		expect(ref?.status).toBe("materialized");
		const entityId = ref?.entityId;
		expect(entityId).toBeTruthy();
		if (!entityId) throw new Error("expected materialized entity id");
		expect(plan?.sections[0]?.refIds).toEqual([entityId]);
		// Section images render, carrying the entity id rather than a plan-local key.
		expect(
			imageCalls.some((call) => call.name === "Batu pertama" && call.refIds?.[0] === entityId),
		).toBe(true);
	});

	test("directed materialization reads frozen definitions and records resolution outside them", async () => {
		const projectId = (await createContentProject({ title: "POV", type: "video" })).project.id;
		const job = videoJob(projectId);
		await setupPlan(job, "prop");
		markApprovedPlanDirected(job);
		const approvedBefore = structuredClone(getStoryPlan(job)!.generationState!.approvedSnapshot);
		const plan = getStoryPlan(job)!;
		setStoryPlan(job, plan.targetSec, plan.sections, true, false, {
			...plan,
			plannedReferences: plan.plannedReferences?.map((ref) => ({
				...ref,
				label: "edited after approval",
			})),
		});

		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]), "tool-ref");

		const materialized = getStoryPlan(job)!;
		const entityId = materialized.generationState?.materialization?.byKey.pov_protagonist;
		expect(entityId).toBeTruthy();
		if (!entityId) throw new Error("expected materialized entity id");
		expect(materialized.generationState?.approvedSnapshot).toEqual(approvedBefore);
		expect(materialized.plannedReferences?.[0]?.label).toBe("edited after approval");
		expect(materialized.plannedReferences?.[0]?.entityId).toBeUndefined();
		expect(imageCalls[0]?.name).toBe("POV manusia zaman batu");
		expect(
			(await listProjectReferences(projectId, { sceneKey: null })).map((row) => row.id),
		).toEqual([entityId]);

		imageCalls = [];
		await generateStoryAssetsFlow(
			job,
			storyInputsOf(job, ["approved", "research"]),
			"tool-ref-retry",
		);
		expect(getStoryPlan(job)?.generationState?.materialization?.byKey.pov_protagonist).toBe(
			entityId,
		);
		expect(imageCalls.every((call) => call.name !== "POV manusia zaman batu")).toBe(true);
	});

	test("materializes a planned location once", async () => {
		const projectId = (await createContentProject({ title: "POV", type: "video" })).project.id;
		const job = videoJob(projectId);
		await setupPlan(job, "location");
		markApprovedPlanDirected(job);

		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]), "tool-ref");
		const firstId = getStoryPlan(job)?.generationState?.materialization?.byKey.pov_protagonist;
		await generateStoryAssetsFlow(
			job,
			storyInputsOf(job, ["approved", "research"]),
			"tool-ref-retry",
		);

		expect(firstId).toBeTruthy();
		expect(getStoryPlan(job)?.generationState?.materialization?.byKey.pov_protagonist).toBe(
			firstId,
		);
		expect(await listProjectReferences(projectId, { sceneKey: null })).toHaveLength(1);
	});

	/* The regression guard for the CLASS of bug, not just this instance: a
	 * preflight may only refuse on something the operator can resolve. A failed
	 * materialization is retryable and reported; a reference waiting on an
	 * approval no surface can give is a dead end. */
	test("the preflight never blocks on an approval no surface can grant", async () => {
		const source = await Bun.file(new URL("./services/story-assets.ts", import.meta.url)).text();
		expect(source).not.toContain("need approval before image generation");
		// If a future change reintroduces a status the preflight refuses on, it must
		// also ship the writer that clears it. Nothing writes "generated" as a
		// terminal state for a materialized reference any more.
		expect(source).not.toContain("status: needsApproval");
	});

	test("product references are never generated", async () => {
		const projectId = (await createContentProject({ title: "POV", type: "video" })).project.id;
		const job = videoJob(projectId);
		await setupPlan(job, "product");
		markApprovedPlanDirected(job);
		const approvedBefore = structuredClone(getStoryPlan(job)!.generationState!.approvedSnapshot);

		const result = await generateStoryAssetsFlow(
			job,
			storyInputsOf(job, ["approved", "research"]),
			"tool-ref",
		);

		const plan = getStoryPlan(job)!;
		expect(plan.plannedReferences?.[0]?.status).toBe("planned");
		expect(plan.plannedReferences?.[0]?.error).toBeUndefined();
		expect(plan.generationState?.approvedSnapshot).toEqual(approvedBefore);
		expect(plan.generationState?.materialization).toBeUndefined();
		expect(result.note).toContain("Product references must be user-selected");
		expect(imageCalls).toEqual([]);
		expect(await listProjectReferences(projectId, { sceneKey: null })).toEqual([]);
	});

	test("blocks dependent generation when reference materialization fails", async () => {
		const projectId = (await createContentProject({ title: "POV", type: "video" })).project.id;
		const job = videoJob(projectId);
		await setupPlan(job);
		setSceneFrameGeneratorForTests(async (scene) => {
			imageCalls.push({ name: scene.name, refIds: scene.refIds });
			throw new Error("image backend down");
		});

		const result = await generateStoryAssetsFlow(
			job,
			storyInputsOf(job, ["approved", "research"]),
			"tool-ref",
		);

		expect(result.note).toContain("Story reference materialization failed");
		expect(imageCalls.length).toBeGreaterThanOrEqual(1);
		expect(imageCalls.every((call) => call.name === "POV manusia zaman batu")).toBe(true);
		expect(getStoryPlan(job)?.sections[0]?.imageUrl).toBeUndefined();
	});
});
