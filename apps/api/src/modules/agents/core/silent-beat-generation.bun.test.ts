/* A beat-structure story with no narration.
 *
 * The design argued that a short silent video is just a plan whose sections
 * carry empty narration, because the narration pipeline treats audio as
 * optional. That was reasoning, not evidence — this is the evidence. What it
 * pins: no TTS is billed for a section with nothing to say, the section still
 * gets its image, and the run does not fail on the missing audio. */
import { storyInputsOf } from "./story-inputs.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { setStyleBibleGeneratorForTests } from "../../../lib/content-generator.ts";
import { setStoryBeatVisualAuthorForTests } from "../../../lib/story/image-director.ts";
import { setTtsSynthesizerForTests } from "../../../lib/tts-synth.ts";
import { setAssetRetryDelayForTests, setSceneFrameGeneratorForTests } from "./visual-gen.ts";
import { setStoryPlan, getStoryPlan } from "./plan-state.ts";
import { buildStoryBeatIntent, beatVisualIntentSchema, storyBibleSchema } from "@maleo/shared";
import { generateStoryAssetsFlow, imageOnlyPrompt } from "./services/story-assets.ts";
import { approveCurrentStoryPlan } from "./services/storyboard-command-service.ts";
import type { AgentJob } from "./model.ts";
import type { StorySection } from "../../../lib/story.ts";

const fixtureBeatIntent = (beatIndex: number, visualMoment: string) =>
	beatVisualIntentSchema.parse({ beatIndex, visualMoment });

const dbPath = join(tmpdir(), "maleo-silent-beat.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;
let ttsCalls = 0;
let imageCalls = 0;

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

/** A beat: something to show, nothing to say. */
function silentBeat(i: number): StorySection {
	return {
		id: `beat-${i}`,
		title: `Beat ${i}`,
		narration: "",
		visualPrompt: `close-up of the bottle, angle ${i}`,
		estimatedDurationSec: 5,
	};
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
		brief: "a 15 second ad for a stainless steel water bottle",
		startedAt: Date.now(),
		styleImageUrl: "/style.png",
		targetDurationSec: 15,
	};
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await resetDb();
	ttsCalls = 0;
	imageCalls = 0;
	setAssetRetryDelayForTests(0);
	setStyleBibleGeneratorForTests(async () => "test style bible");
	setStoryBeatVisualAuthorForTests(async (_section, beats) =>
		beats.map((beat, index) => ({
			beatIndex: index,
			visualMoment: `visual ${index + 1}: ${beat.text || `silent beat ${index + 1}`}`,
		})),
	);
	setSceneFrameGeneratorForTests(async () => {
		imageCalls++;
		return "/uploads/test-frame.png";
	});
	setTtsSynthesizerForTests(async () => {
		ttsCalls++;
		return { bytes: new Uint8Array(44), ext: "wav" };
	});
});

afterEach(async () => {
	setStyleBibleGeneratorForTests(null);
	setStoryBeatVisualAuthorForTests(null);
	setSceneFrameGeneratorForTests(null);
	setTtsSynthesizerForTests(null);
	await resetDb();
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
});

async function generateSilentPlan() {
	const projectId = (await createContentProject({ title: "Silent", type: "video" })).project.id;
	const job = videoJob(projectId);
	const sections = [silentBeat(1), silentBeat(2), silentBeat(3)];
	setStoryPlan(job, 15, sections, false, false, {
		planningBrief: job.brief,
		factual: false,
		visualStyle: "test style bible",
		structure: "beat",
		language: "en",
	});
	await approveCurrentStoryPlan(job, "explicit");
	const result = await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));
	return { job, result, sections: getStoryPlan(job)?.sections ?? [] };
}

describe("beat-structure story with no narration", () => {
	test("strips raw POV lifecycle labels from provider image prompt text", () => {
		const cleaned = imageOnlyPrompt(
			[
				"macro bee-scale view of antennae emerging from wax comb",
				"viewerRole: worker bee",
				"bodyConstraints: compound eyes and pollen baskets",
				"cameraRole: body_detail",
				"noveltyKey: bee birth body",
			].join("\n"),
		);
		expect(cleaned).toBe("macro bee-scale view of antennae emerging from wax comb");
	});

	test("bills no TTS for sections that have nothing to say", async () => {
		await generateSilentPlan();
		expect(ttsCalls).toBe(0);
	});

	test("still generates an image for every beat", async () => {
		const { sections } = await generateSilentPlan();
		expect(imageCalls).toBeGreaterThanOrEqual(3);
		for (const s of sections) expect(s.imageUrl ?? s.imageUrls?.[0]).toBeTruthy();
	});

	test("refuses a saved prose-only beat before any provider call", async () => {
		const projectId = (await createContentProject({ title: "Unstructured beat", type: "video" }))
			.project.id;
		const job = videoJob(projectId);
		setStoryPlan(
			job,
			5,
			[
				{
					...silentBeat(1),
					visualSegments: [
						{ text: "", visualPrompt: "old prose", durationSec: 5, voiceSegmentIndex: 0 },
					],
				},
			],
			false,
			false,
			{
				planningBrief: job.brief,
				factual: false,
				visualStyle: "test style bible",
				structure: "beat",
				language: "en",
			},
		);
		await approveCurrentStoryPlan(job, "explicit");
		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));
		const section = getStoryPlan(job)?.sections[0];
		expect(section?.status).toBe("failed");
		expect(section?.error).toContain("Visual beat 1 has no authored intent");
		expect(imageCalls).toBe(0);
		expect(ttsCalls).toBe(0);
	});

	test("does not fail the run over the absent voiceover", async () => {
		const { sections } = await generateSilentPlan();
		for (const s of sections) expect(s.status).not.toBe("failed");
		for (const s of sections) expect(s.error).toBeUndefined();
	});

	test("every beat lands on the timeline with a real duration", async () => {
		const { job } = await generateSilentPlan();
		expect(job.scenes.length).toBeGreaterThanOrEqual(3);
		for (const scene of job.scenes) expect(scene.durationSec).toBeGreaterThan(0);
	});

	test("rejects repeated POV shot grammar before image generation", async () => {
		const projectId = (await createContentProject({ title: "Repeated POV", type: "video" })).project
			.id;
		const job = videoJob(projectId);
		setStoryPlan(
			job,
			10,
			[
				{
					...silentBeat(1),
					visualPrompts: ["bee in wax comb one", "bee in wax comb two"],
					povShots: [
						{
							cameraRole: "body_detail",
							location: "wax comb",
							bodyAction: "cleaning cell",
							noveltyKey: "one",
						},
						{
							cameraRole: "body_detail",
							location: "Wax   comb",
							bodyAction: "cleaning-cell",
							noveltyKey: "two",
						},
					],
				},
			],
			false,
			false,
			{
				planningBrief: "pov born as worker bee",
				factual: false,
				visualStyle: "test style bible",
				structure: "beat",
				language: "en",
				povLifecycle: {
					viewerRole: "worker bee",
					bodyConstraints: "compound eyes and antennae",
					endingFate: "dies exhausted",
				},
			},
		);
		await approveCurrentStoryPlan(job, "explicit");

		const result = await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));
		const section = getStoryPlan(job)?.sections[0];

		expect(result.note).toContain("No sections are ready");
		expect(imageCalls).toBe(0);
		expect(section?.status).toBe("failed");
		expect(section?.error).toContain("POV shot diversity failed");
	});

	test("compiles a beat into fields, with the story's constants supplied once", () => {
		const rawSentence = "Kamu memberi makan, membersihkan, dan menjaga suhu sarang tetap hidup.";
		const bible = storyBibleSchema.parse({
			subjects: [{ id: "worker", label: "worker bee" }],
			medium: "Sketch Stickman watercolor style",
			negatives: ["human presence"],
		});
		const beats = [
			{
				text: rawSentence,
				visual: "mouthparts feeding curled white larvae inside warm nursery comb, macro bee-scale",
			},
			{
				text: "Di depanmu, larva putih bergerak pelan di dalam sel.",
				visual: "single pale larva curling in an open wax cell, shallow depth",
			},
		];
		const intents = beats.map((beat, index) =>
			buildStoryBeatIntent({
				bible,
				beat: fixtureBeatIntent(index, beat.visual),
				visual: "only sketch stickman as reference",
				rules: "no human presence\nno human hand",
				aspect: "9:16",
			}),
		);

		// The authored visual is the scene; direction and hard constraints are fields
		// beside it rather than sentences appended to it.
		expect(intents[0]!.scene.visualMoment).toContain("mouthparts feeding curled white larvae");
		expect(intents[0]!.constraints.mustAvoid).toContain("human hand");
		expect(intents[0]!.constraints.mustInclude).toContain("only sketch stickman as reference");
		expect(intents[0]!.style?.medium).toBe("Sketch Stickman watercolor style");

		// Narration text never reaches the provider.
		expect(JSON.stringify(intents[0])).not.toContain(rawSentence);
		expect(JSON.stringify(intents[0])).not.toContain("Narration beat");

		// The two things that used to make every adjacent prompt differ regardless of
		// content, and so made the duplicate check unreachable.
		expect(JSON.stringify(intents[0])).not.toContain("Final visual beat");
		expect(JSON.stringify(intents[0])).not.toContain("composition:");

		// The story's constants are identical across beats; only the scene moves.
		expect(intents[1]!.style).toEqual(intents[0]!.style);
		expect(intents[1]!.negative).toEqual(intents[0]!.negative);
		expect(intents[1]!.scene.visualMoment).not.toBe(intents[0]!.scene.visualMoment);
	});

	test("skips image generation when final adjacent prompts still duplicate", async () => {
		setStoryBeatVisualAuthorForTests(async (_section, beats) =>
			beats.map((_beat, index) => ({ beatIndex: index, visualMoment: "same bee prompt" })),
		);
		const projectId = (await createContentProject({ title: "Duplicate prompts", type: "video" }))
			.project.id;
		const job = videoJob(projectId);
		setStoryPlan(
			job,
			10,
			[
				{
					...silentBeat(1),
					visualPrompts: ["same bee prompt", "same bee prompt"],
				},
			],
			false,
			false,
			{
				planningBrief: "silent duplicate prompt test",
				factual: false,
				visualStyle: "test style bible",
				structure: "beat",
				language: "en",
			},
		);
		await approveCurrentStoryPlan(job, "explicit");

		const result = await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));
		const section = getStoryPlan(job)?.sections[0];

		expect(result.note).toContain("No sections are ready");
		expect(imageCalls).toBe(0);
		expect(section?.status).toBe("failed");
		expect(section?.error).toContain("repeat the same visual");
	});
});
