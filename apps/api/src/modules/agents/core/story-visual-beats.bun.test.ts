/* The regression lock for story visual-beat correlation.
 *
 * Every story test in this package passed while 45.8% of adjacent visual beats
 * shipped the same picture, because they assert shapes and this is a
 * distribution. So this one drives ONE section through the real pipeline —
 * real TTS measurement, real beat splitting at the template's maxVisualBeatSec,
 * real prompt resolution — and counts what came out:
 *
 *   one provider-facing visual per measured beat, and no two adjacent beats
 *   carrying the same authored visual.
 *
 * The fixture is deliberately lopsided: 3 planned shots against a narration long
 * enough to cut ~8 beats. Before per-beat authoring existed that gap was closed
 * by reusing planned prompts, so this test fails on the old path and names the
 * reuse count when it does. */
import { storyInputsOf } from "./story-inputs.ts";
import { agentTimelineDoc } from "./document.ts";
import {
	approvedPlanArtifact,
	artifactRefOf,
	artifactsOfKind,
	generationBatchArtifact,
	isArtifactReady,
	pipelineArtifactKinds,
	resolveArtifactRef,
	timelineDocumentArtifact,
} from "@maleo/shared";
import { dropJobArtifacts } from "./artifact-store.ts";
import { recordApprovedPlan } from "./approval-state.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { removeProjectReference } from "@maleo/db/references";
import {
	authoredStoryVisualText,
	adjacentDuplicateStoryImagePromptIndexes,
	canonicalizeLegacyStoryPlan,
	storyBibleSchema,
} from "@maleo/shared";
import {
	setStyleBibleGeneratorForTests,
	setStoryPlannerForTests,
} from "../../../lib/content-generator.ts";
import { setStoryBeatVisualAuthorForTests } from "../../../lib/story/image-director.ts";
import { setTtsSynthesizerForTests } from "../../../lib/tts-synth.ts";
import { setAssetRetryDelayForTests, setSceneFrameGeneratorForTests } from "./visual-gen.ts";
import { getStoryPlan, setStoryPlan } from "./plan-state.ts";
import {
	generateStoryAssetsFlow,
	normalizeStoredInfographicDirection,
	regenerateLongformSectionFlow,
} from "./services/story-assets.ts";
import {
	approveCurrentStoryPlan,
	currentStoryDirectionFingerprint,
	executeStoryboardCommand,
} from "./services/storyboard-command-service.ts";
import type { AgentJob } from "./model.ts";
import type { StorySection } from "../../../lib/story.ts";
import { upsertGeneratedReference } from "./generated-reference.ts";

/** Unwrap an approval that the test expects to succeed. */
function approvedState(outcome: Awaited<ReturnType<typeof approveCurrentStoryPlan>>) {
	if (!outcome.ok) throw new Error(`approval refused: ${outcome.message}`);
	return outcome.state;
}

const dbPath = join(tmpdir(), "maleo-story-visual-beats.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;
let imagePrompts: string[] = [];
let imageRefIds: Array<readonly string[] | undefined> = [];
let authoringCalls: Array<{ beats: number; plannedShots: readonly string[] }> = [];
let ttsCalls = 0;

test("a stored infographic beat is repaired without rewriting the story", () => {
	/* A plan stored before infographics were removed: the section was never read
	 * through the current schema, so it still carries the removed values. */
	const section = {
		id: "section-1",
		semanticBeatId: "beat-1",
		title: "Trade routes break",
		narration: "Copper stops moving.",
		visualPrompt: "An empty Bronze Age harbor",
		estimatedDurationSec: 5,
		motionGraphic: { needed: false, kind: "none" },
		editorial: {
			purpose: "explain",
			presentation: "infographic",
			visualConcept: "Trade routes fading from a map",
			noveltyKey: "routes-fade",
			sfxCue: null,
			motionGraphic: { needed: true, kind: "stat_reveal", value: "42%" },
		},
	} as unknown as StorySection;
	const [normalized] = normalizeStoredInfographicDirection([section]);
	expect(normalized?.narration).toBe(section.narration);
	expect(normalized?.editorial?.presentation).toBe("narrative");
	expect(normalized?.editorial).not.toHaveProperty("motionGraphic");
	expect(normalized).not.toHaveProperty("motionGraphic");
});

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

/** A real WAV header for `seconds` of 16-bit mono 16 kHz audio, so the pipeline
 *  measures a duration instead of falling back to ffprobe on an empty file. */
function wavBytes(seconds: number): Uint8Array {
	const byteRate = 16000 * 2;
	const dataSize = Math.max(2, Math.round(byteRate * seconds));
	const bytes = new Uint8Array(44 + dataSize);
	const view = new DataView(bytes.buffer);
	const tag = (offset: number, text: string): void => {
		for (let i = 0; i < 4; i++) bytes[offset + i] = text.charCodeAt(i);
	};
	tag(0, "RIFF");
	view.setUint32(4, 36 + dataSize, true);
	tag(8, "WAVE");
	tag(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 16000, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	tag(36, "data");
	view.setUint32(40, dataSize, true);
	return bytes;
}

/* Long sentences on purpose. A visual beat is cut at the template's
 * `maxVisualBeatSec`, so a sentence this long becomes several beats — and every
 * beat inside one sentence carried the same planned prompt, which is where the
 * measured adjacent reuse came from. */
const SENTENCES = [
	"You wake inside a narrow wax cell with a body that is still hardening, and the queen's scent arrives long before you understand anything at all about this world you were born into.",
	"White larvae curl inside the open cells around you, always hungry and always waiting, so you carry food through warm corridors that shake with the vibration of thousands of working sisters.",
	"Your antennae learn to read the chemical trails that run along every wax wall, and the colony answers each signal without any single voice ever giving the order aloud.",
	"The hive entrance becomes the edge of a world that is far too bright, and your wings shake through a first flight over ground that falls away beneath you like a canyon.",
];
const NARRATION = SENTENCES.join(" ");

function fixtureSection(): StorySection {
	return {
		id: "sec-1",
		title: "Born into wax",
		narration: NARRATION,
		visualPrompt: "macro view of a wax comb interior",
		// Three operator-approved planned shots against eight measured beats — the
		// gap the reconciliation layer used to close by repeating a prompt.
		visualPrompts: [
			"macro view of a wax comb interior lit from one side",
			"nursery cells packed with pale curled larvae",
			"hive entrance flooded with hard outside light",
		],
		shotCues: [SENTENCES[0]!, SENTENCES[1]!, SENTENCES[3]!],
		estimatedDurationSec: 45,
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
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: [],
		aspect: "9:16",
		brief: "a first-person story of a worker bee's life",
		startedAt: Date.now(),
		styleImageUrl: "/style.png",
		targetDurationSec: 45,
	};
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await resetDb();
	imagePrompts = [];
	imageRefIds = [];
	authoringCalls = [];
	ttsCalls = 0;
	setAssetRetryDelayForTests(0);
	setStyleBibleGeneratorForTests(async () => "test style bible");
	setSceneFrameGeneratorForTests(async (scene) => {
		imagePrompts.push(scene.visual);
		imageRefIds.push(scene.refIds);
		return `/uploads/frame-${imagePrompts.length}.png`;
	});
	// Speech at a plausible rate, so beat splitting sees real proportions rather
	// than one constant duration for every text it is handed.
	setTtsSynthesizerForTests(async ({ text }) => {
		ttsCalls++;
		return {
			bytes: wavBytes(Math.max(0.5, text.trim().split(/\s+/).filter(Boolean).length / 2.6)),
			ext: "wav",
		};
	});
	// One distinct authored visual per beat, without a provider call. The pipeline
	// still owns the beat count; this only stands in for the model's wording.
	setStoryBeatVisualAuthorForTests(async (_section, beats, opts) => {
		authoringCalls.push({ beats: beats.length, plannedShots: opts?.plannedShots ?? [] });
		return beats.map((beat, index) => ({
			beatIndex: index,
			visualMoment: `authored visual ${index + 1} — ${beat.text.slice(0, 40)}`,
			endState: `end of authored beat ${index + 1}`,
		}));
	});
});

afterEach(async () => {
	setStyleBibleGeneratorForTests(null);
	setSceneFrameGeneratorForTests(null);
	setTtsSynthesizerForTests(null);
	setStoryBeatVisualAuthorForTests(null);
	setStoryPlannerForTests(null);
	await resetDb();
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
});

async function generateFixture() {
	const projectId = (await createContentProject({ title: "Beats", type: "video" })).project.id;
	const job = videoJob(projectId);
	setStoryPlan(job, 45, [fixtureSection()], false, false, {
		planningBrief: job.brief,
		factual: false,
		visualStyle: "test style bible",
		structure: "narration_section",
		language: "en",
	});
	await approveCurrentStoryPlan(job, "explicit");
	await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));
	const section = getStoryPlan(job)?.sections[0];
	if (!section) throw new Error("fixture section vanished from the plan");
	return { job, section };
}

function directedSection(binding: { entityId: string } | { plannedKey: string }): StorySection {
	const section = fixtureSection();
	return {
		...section,
		editorial: {
			purpose: "explain",
			presentation: "explainer",
			visualConcept: "bee lifecycle",
			noveltyKey: "bee-life",
			sfxCue: null,
			shots: section.visualPrompts!.map((visualIntent, index) => ({
				index,
				visualIntent,
				role: "continuity" as const,
				bindings: [binding],
				rationale: "Keeps approved subject visible.",
			})),
		},
	};
}

function markDirected(job: AgentJob, ref: string): void {
	const plan = getStoryPlan(job)!;
	const aliases = [{ ref, aliases: [] }];
	// Recorded as an approval: generation consumes the recorded approval.
	const approvedSnapshot = {
		...plan.generationState!.approvedSnapshot!,
		referenceAliases: aliases,
	};
	setStoryPlan(job, plan.targetSec, plan.sections, true, false, {
		...plan,
		referenceAliases: aliases,
		generationState: { ...plan.generationState!, approvedSnapshot },
	});
	recordApprovedPlan(job, approvedSnapshot);
}

async function attachTestEntity(projectId: string, key: string) {
	return (
		await upsertGeneratedReference({
			projectId,
			key,
			role: "character",
			label: key,
			description: `${key} reference`,
			canonicalImageUrl: `/api/image-gen/files/${key}.png`,
			purpose: "story-reference",
		})
	).entity;
}

describe("story visual beats", () => {
	test("every generated output records approved semantic provenance", async () => {
		const { job, section } = await generateFixture();
		const revision = getStoryPlan(job)!.generationState!.approvedSnapshot!.revisionId;
		for (const segment of section.voiceSegments ?? [])
			expect(segment).toMatchObject({
				sourceBeatId: section.semanticBeatId,
				sourceRevisionId: revision,
				inputHash: expect.any(String),
			});
		for (const segment of section.visualSegments ?? [])
			expect(segment).toMatchObject({
				sourceBeatId: section.semanticBeatId,
				sourceRevisionId: revision,
				inputHash: expect.any(String),
			});
		expect(section.imageInputHashes?.every(Boolean)).toBe(true);
		expect(section.imageSourceRevisionIds?.every((value) => value === revision)).toBe(true);
		expect(
			job.scenes.every(
				(scene) =>
					scene.storyBeatId === section.semanticBeatId && scene.sourceRevisionId === revision,
			),
		).toBe(true);
	});

	test("a draft mutation during generation cannot change captured revision or prose", async () => {
		const projectId = (await createContentProject({ title: "Concurrent draft", type: "video" }))
			.project.id;
		const job = videoJob(projectId);
		setStoryPlan(job, 45, [fixtureSection()], false, false, {
			planningBrief: job.brief,
			factual: false,
			visualStyle: "test style bible",
			structure: "narration_section",
			language: "en",
		});
		const approved = approvedState(await approveCurrentStoryPlan(job, "explicit"));
		let edited = false;
		setStoryBeatVisualAuthorForTests(async (_section, beats) => {
			if (!edited) {
				edited = true;
				await executeStoryboardCommand(
					job,
					approved.draft.revisionId,
					{
						type: "update_beat",
						beatId: approved.draft.sections[0]!.beats[0]!.id,
						fields: { narration: "Later draft" },
					},
					{ newRevisionId: "later-draft", save: () => {} },
				);
			}
			return beats.map((_beat, index) => ({
				beatIndex: index,
				visualMoment: `captured ${index}`,
				endState: `captured end ${index}`,
			}));
		});
		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));
		const plan = getStoryPlan(job)!;
		expect(plan.generationState!.draft).toMatchObject({
			revisionId: "later-draft",
			sections: [{ beats: [{ narration: "Later draft" }] }],
		});
		expect(plan.generationState!.approvedSnapshot!.sections[0]!.beats[0]!.narration).toBe(
			NARRATION,
		);
		expect(plan.sections[0]!.narration).toBe("Later draft");
		expect(
			plan.sections[0]!.voiceSegments?.every(
				(segment) =>
					segment.sourceRevisionId === approved.approvedSnapshot!.revisionId &&
					segment.text !== "Later draft",
			),
		).toBe(true);
	});

	test("review extension drafts additions without generating their media", async () => {
		const projectId = (await createContentProject({ title: "Review extension", type: "video" }))
			.project.id;
		const job = videoJob(projectId);
		job.targetDurationSec = 120;
		setStoryPlan(job, 120, [fixtureSection()], false, false, {
			planningBrief: job.brief,
			factual: false,
			visualStyle: "test style bible",
			structure: "narration_section",
			language: "en",
		});
		await approveCurrentStoryPlan(job, "explicit", "review_additions");
		setStoryPlannerForTests(async () => [
			{
				title: "Unseen addition",
				narration: "Unapproved narration",
				visualPrompt: "Unapproved visual",
			},
		]);
		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));
		const plan = getStoryPlan(job)!;
		expect(plan.generationState!.approvedSnapshot!.sections).toHaveLength(1);
		expect(plan.generationState!.draft.sections).toHaveLength(2);
		const addition = plan.sections.find((section) => section.title === "Unseen addition");
		expect(addition?.audioUrl).toBeUndefined();
		expect(addition?.imageUrl).toBeUndefined();
		expect(job.scenes.every((scene) => scene.name !== "Unseen addition")).toBe(true);
	});

	test("auto extension approves additions before provider work", async () => {
		const projectId = (await createContentProject({ title: "Auto extension", type: "video" }))
			.project.id;
		const job = videoJob(projectId);
		job.targetDurationSec = 80;
		setStoryPlan(job, 80, [fixtureSection()], false, false, {
			planningBrief: job.brief,
			factual: false,
			visualStyle: "test style bible",
			structure: "narration_section",
			language: "en",
		});
		const initial = approvedState(
			await approveCurrentStoryPlan(job, "explicit", "auto_approve_additions"),
		);
		setStoryPlannerForTests(async () => [
			{ title: "Approved addition", narration: NARRATION, visualPrompt: "Approved visual" },
		]);
		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));
		const plan = getStoryPlan(job)!;
		const extension = plan.generationState!.approvedSnapshot!;
		expect(extension).toMatchObject({
			approvalMode: "implicit_extension",
			extensionPolicy: "auto_approve_additions",
			parentRevisionId: initial.approvedSnapshot!.revisionId,
		});
		const addition = plan.sections.find((section) => section.title === "Approved addition")!;
		expect(addition.status).toBe("ready");
		expect(
			addition.voiceSegments?.every((segment) => segment.sourceRevisionId === extension.revisionId),
		).toBe(true);
		expect(
			addition.imageSourceRevisionIds?.every((revision) => revision === extension.revisionId),
		).toBe(true);
	});

	/* A directed plan's extension adds sections, which necessarily changes the
	 * direction inputs. That used to refuse the approval and then dereference the
	 * refusal, crashing mid-run after speech and images were paid for. */
	test("auto extension approves additions on a directed plan", async () => {
		const projectId = (await createContentProject({ title: "Directed extension", type: "video" }))
			.project.id;
		const job = videoJob(projectId);
		job.targetDurationSec = 80;
		setStoryPlan(job, 80, [fixtureSection()], false, false, {
			planningBrief: job.brief,
			factual: false,
			visualStyle: "test style bible",
			structure: "narration_section",
			language: "en",
			referenceAliases: [],
			plannedReferences: [],
			generationState: canonicalizeLegacyStoryPlan([fixtureSection()]),
		});
		const planned = getStoryPlan(job)!;
		setStoryPlan(job, 80, planned.sections, false, false, {
			...planned,
			directionFingerprint: await currentStoryDirectionFingerprint(job, planned.sections),
		});
		const initial = await approveCurrentStoryPlan(job, "explicit", "auto_approve_additions");
		expect(initial.ok).toBe(true);
		setStoryPlannerForTests(async () => [
			{ title: "Approved addition", narration: NARRATION, visualPrompt: "Approved visual" },
		]);
		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));
		const plan = getStoryPlan(job)!;
		const extension = plan.generationState!.approvedSnapshot!;
		expect(extension.approvalMode).toBe("implicit_extension");
		expect(plan.sections.find((section) => section.title === "Approved addition")?.status).toBe(
			"ready",
		);
	});

	test("a directed extension blocked on operator input keeps the approved sections", async () => {
		const projectId = (await createContentProject({ title: "Blocked extension", type: "video" }))
			.project.id;
		const job = videoJob(projectId);
		job.targetDurationSec = 80;
		setStoryPlan(job, 80, [fixtureSection()], false, false, {
			planningBrief: job.brief,
			factual: false,
			visualStyle: "test style bible",
			structure: "narration_section",
			language: "en",
			referenceAliases: [],
			plannedReferences: [],
			generationState: canonicalizeLegacyStoryPlan([fixtureSection()]),
		});
		const planned = getStoryPlan(job)!;
		setStoryPlan(job, 80, planned.sections, false, false, {
			...planned,
			directionFingerprint: await currentStoryDirectionFingerprint(job, planned.sections),
		});
		await approveCurrentStoryPlan(job, "explicit", "auto_approve_additions");
		const approved = getStoryPlan(job)!;
		setStoryPlan(job, 80, approved.sections, false, false, {
			...approved,
			directionBlocked: true,
			directionErrors: ["planned_product: jar needs an operator-supplied reference"],
		});
		setStoryPlannerForTests(async () => [
			{ title: "Approved addition", narration: NARRATION, visualPrompt: "Approved visual" },
		]);
		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));
		const plan = getStoryPlan(job)!;
		expect(plan.generationState!.approvedSnapshot!.approvalMode).toBe("explicit");
		expect(plan.sections[0]!.status).toBe("ready");
	});

	test("same-count narration edit keeps stale media until approved regeneration", async () => {
		const { job, section } = await generateFixture();
		const old = {
			audioUrl: section.audioUrl,
			imageUrl: section.imageUrl,
			speechHash: section.speechInputHash,
			ttsCalls,
			imageCalls: imagePrompts.length,
		};
		const state = getStoryPlan(job)!.generationState!;
		const changedNarration = NARRATION.replace("narrow", "shallow");
		await executeStoryboardCommand(
			job,
			state.draft.revisionId,
			{
				type: "update_beat",
				beatId: section.semanticBeatId!,
				fields: { narration: changedNarration },
			},
			{ newRevisionId: "same-count", save: () => {} },
		);
		const stale = getStoryPlan(job)!.sections[0]!;
		expect([stale.audioUrl, stale.imageUrl, ttsCalls, imagePrompts.length]).toEqual([
			old.audioUrl,
			old.imageUrl,
			old.ttsCalls,
			old.imageCalls,
		]);
		await approveCurrentStoryPlan(job, "explicit");
		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));
		const regenerated = getStoryPlan(job)!.sections[0]!;
		expect(regenerated.speechInputHash).not.toBe(old.speechHash);
		expect(ttsCalls).toBeGreaterThan(old.ttsCalls);
		expect(imagePrompts.length).toBeGreaterThan(old.imageCalls);
	});

	test("visual-only edit reuses speech and regenerates frames", async () => {
		const { job, section } = await generateFixture();
		const old = {
			speechHash: section.speechInputHash,
			visualHash: section.visualInputHash,
			ttsCalls,
			imageCalls: imagePrompts.length,
		};
		const state = getStoryPlan(job)!.generationState!;
		await executeStoryboardCommand(
			job,
			state.draft.revisionId,
			{
				type: "update_beat",
				beatId: section.semanticBeatId!,
				fields: { visualPrompt: "different approved visual" },
			},
			{ newRevisionId: "visual-only", save: () => {} },
		);
		await approveCurrentStoryPlan(job, "explicit");
		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));
		const regenerated = getStoryPlan(job)!.sections[0]!;
		expect(regenerated.speechInputHash).toBe(old.speechHash);
		expect(regenerated.visualInputHash).not.toBe(old.visualHash);
		expect(ttsCalls).toBe(old.ttsCalls);
		expect(imagePrompts.length).toBeGreaterThan(old.imageCalls);
	});
	/* Baseline for `standardize-pipeline-artifact-contracts` (tasks 0.2 and 3.4):
	 * staleness is decided per section from leaf hashes, so a visual edit to one
	 * section regenerates only that section's frames and leaves its sibling's
	 * frames, hashes and speech untouched. Stage-level envelopes must not change
	 * this. */
	test("a visual edit stales one section and leaves its sibling reusable", async () => {
		const projectId = (await createContentProject({ title: "Beats", type: "video" })).project.id;
		const job = videoJob(projectId);
		const sibling: StorySection = {
			...fixtureSection(),
			id: "sec-2",
			title: "Out into light",
			visualPrompt: "hive entrance at dawn",
		};
		setStoryPlan(job, 90, [fixtureSection(), sibling], false, false, {
			planningBrief: job.brief,
			factual: false,
			visualStyle: "test style bible",
			structure: "narration_section",
			language: "en",
		});
		await approveCurrentStoryPlan(job, "explicit");
		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));
		const [first, second] = getStoryPlan(job)!.sections;
		const before = {
			authoringCalls: authoringCalls.length,
			imageUrls: first!.imageUrls,
			imageHashes: first!.imageInputHashes,
			visualHash: first!.visualInputHash,
			speechHash: first!.speechInputHash,
			imageRevisions: first!.imageSourceRevisionIds,
			visualRevisions: first!.visualSegments?.map((beat) => beat.sourceRevisionId),
			siblingVisualHash: second!.visualInputHash,
			ttsCalls,
			imageCalls: imagePrompts.length,
		};
		const state = getStoryPlan(job)!.generationState!;
		await executeStoryboardCommand(
			job,
			state.draft.revisionId,
			{
				type: "update_beat",
				beatId: second!.semanticBeatId!,
				fields: { visualPrompt: "hive entrance in a summer storm" },
			},
			{ newRevisionId: "sibling-visual", save: () => {} },
		);
		await approveCurrentStoryPlan(job, "explicit");
		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));
		const [untouched, edited] = getStoryPlan(job)!.sections;
		expect({
			imageUrls: untouched!.imageUrls,
			imageHashes: untouched!.imageInputHashes,
			visualHash: untouched!.visualInputHash,
			speechHash: untouched!.speechInputHash,
		}).toEqual({
			imageUrls: before.imageUrls,
			imageHashes: before.imageHashes,
			visualHash: before.visualHash,
			speechHash: before.speechHash,
		});
		// Reused output keeps the revision it was produced under.
		expect({
			imageRevisions: untouched!.imageSourceRevisionIds,
			visualRevisions: untouched!.visualSegments?.map((beat) => beat.sourceRevisionId),
		}).toEqual({ imageRevisions: before.imageRevisions, visualRevisions: before.visualRevisions });
		expect(edited!.visualInputHash).not.toBe(before.siblingVisualHash);
		expect(ttsCalls).toBe(before.ttsCalls);
		expect(authoringCalls.length - before.authoringCalls).toBe(1);
		expect(imagePrompts.length - before.imageCalls).toBe(edited!.imageUrls?.length ?? 0);
	});

	/* The approved plan crosses into generation as an artifact (standardize-
	 * pipeline-artifact-contracts 3.2): approval records it with a reference to
	 * the plan revision it froze, and generation refuses without it exactly as it
	 * always refused without an approved revision. */
	test("approval records the frozen snapshot as an artifact referencing the plan it froze", async () => {
		const { job } = await generateFixture();
		const approved = artifactsOfKind(job.artifacts, approvedPlanArtifact)[0]!;
		expect(approved.payload.revisionId).toBe(
			getStoryPlan(job)!.generationState!.approvedSnapshot!.revisionId,
		);
		expect(approved.inputRefs.map((ref) => ref.kind)).toEqual(["story_plan"]);
	});

	/* 3.3: a completed narrated build's timeline is an artifact referencing the
	 * batch it was built from, which references the approved plan — the chain
	 * resolves end to end by exact content. */
	test("a finished build's timeline references its generation batch, which references the approval", async () => {
		const { job } = await generateFixture();
		const timeline = artifactsOfKind(job.artifacts, timelineDocumentArtifact)[0]!;
		const batch = artifactsOfKind(job.artifacts, generationBatchArtifact)[0]!;
		const approved = artifactsOfKind(job.artifacts, approvedPlanArtifact)[0]!;
		const lookup = (id: string) => job.artifacts.find((artifact) => artifact.id === id);
		expect(timeline.inputRefs).toEqual([artifactRefOf(batch)]);
		expect(resolveArtifactRef(timeline.inputRefs[0]!, lookup).ok).toBe(true);
		expect(batch.inputRefs).toEqual([artifactRefOf(approved)]);
		expect(timeline.payload.clipCount).toBe(agentTimelineDoc(job).clips.length);
		// Ready, and every generated asset is accounted for.
		expect(isArtifactReady(pipelineArtifactKinds, batch)).toBe(true);
		const section = getStoryPlan(job)!.sections[0]!;
		expect(
			batch.payload.items.filter((item) => item.asset === "frame").map((item) => item.url),
		).toEqual(section.imageUrls!);
		expect(batch.payload.items.find((item) => item.asset === "speech")).toMatchObject({
			status: "ready",
			url: section.audioUrl,
		});
		// Lineage is not duplicated: the approval is the reference, the reuse hash
		// stays on the asset.
		expect(Object.keys(batch.payload)).toEqual(["items"]);
		expect(batch.payload.items.every((item) => !("inputHash" in item))).toBe(true);
	});

	test("generation without the approved-plan artifact refuses as before", async () => {
		const { job } = await generateFixture();
		dropJobArtifacts(job, approvedPlanArtifact.kind);
		const before = imagePrompts.length;
		expect(
			(await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]))).note,
		).toBe("Story plan is not approved. Approve current draft before generating assets.");
		expect(imagePrompts.length).toBe(before);
	});

	test("an older approval does not authorize a plan that holds a different one", async () => {
		const { job } = await generateFixture();
		const state = getStoryPlan(job)!.generationState!;
		await executeStoryboardCommand(
			job,
			state.draft.revisionId,
			{
				type: "update_beat",
				beatId: getStoryPlan(job)!.sections[0]!.semanticBeatId!,
				fields: { visualPrompt: "a new visual" },
			},
			{ newRevisionId: "re-approved", save: () => {} },
		);
		const plan = getStoryPlan(job)!;
		// The plan claims an approval of the new revision that was never recorded.
		setStoryPlan(job, plan.targetSec, plan.sections, false, false, {
			...plan,
			generationState: {
				...plan.generationState!,
				approvedSnapshot: { ...state.approvedSnapshot!, revisionId: "re-approved" },
			},
		});
		expect(
			(await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]))).note,
		).toBe("Story plan is not approved. Approve current draft before generating assets.");
	});

	/* Replaces the old status filter as the guard on recovery spend: every pass
	 * rechecks every section, so finished work must cost nothing to recheck. */
	test("a second pass over finished sections makes no provider call", async () => {
		const { job } = await generateFixture();
		const before = {
			ttsCalls,
			authoringCalls: authoringCalls.length,
			imageCalls: imagePrompts.length,
			imageUrls: getStoryPlan(job)!.sections[0]!.imageUrls,
		};
		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));
		expect({
			ttsCalls,
			authoringCalls: authoringCalls.length,
			imageCalls: imagePrompts.length,
			imageUrls: getStoryPlan(job)!.sections[0]!.imageUrls,
		}).toEqual(before);
	});

	test("the fixture cuts more beats than it planned shots", async () => {
		const { section } = await generateFixture();
		expect(section.visualSegments?.length ?? 0).toBeGreaterThan(section.visualPrompts?.length ?? 0);
	});

	test("one provider-facing visual per measured beat", async () => {
		const { section } = await generateFixture();
		const beats = section.visualSegments?.length ?? 0;
		expect(beats).toBeGreaterThan(0);
		expect(imagePrompts.length).toBe(beats);
	});

	test("no two adjacent beats carry the same authored visual", async () => {
		const { section } = await generateFixture();
		const authored = (section.visualSegments ?? []).map((segment) =>
			authoredStoryVisualText(segment.visualPrompt),
		);
		const duplicates = adjacentDuplicateStoryImagePromptIndexes(authored);
		expect(
			`${duplicates.length} adjacent beats reuse a visual (at ${duplicates.join(", ") || "—"})`,
		).toBe("0 adjacent beats reuse a visual (at —)");
	});

	test("the pipeline sends the injected authored visuals to the provider", async () => {
		const { section } = await generateFixture();
		// Each beat's persisted visual is what the override wrote for that beat, and
		// each provider prompt is that visual with the project's layers around it.
		for (const [index, segment] of (section.visualSegments ?? []).entries()) {
			expect(segment.visualPrompt).toStartWith(`authored visual ${index + 1} — `);
			expect(imagePrompts[index]).toContain(`authored visual ${index + 1} — `);
		}
	});

	test("planned shots reach authoring as intent and never become the prompt", async () => {
		const { section } = await generateFixture();
		expect(authoringCalls[0]?.plannedShots).toEqual(section.visualPrompts ?? []);
		for (const prompt of imagePrompts) {
			for (const planned of section.visualPrompts ?? []) expect(prompt).not.toContain(planned);
		}
	});

	test("the authoring call is traced like every other generation call", async () => {
		const { job } = await generateFixture();
		const started = job.events.filter(
			(event) => event.kind === "tool_call_started" && event.tool === "author_beat_visuals",
		);
		const completed = job.events.filter(
			(event) => event.kind === "tool_call_completed" && event.tool === "author_beat_visuals",
		);
		expect(started).toHaveLength(1);
		expect(completed).toHaveLength(1);
		expect(started[0]).toMatchObject({ args: { sectionId: "sec-1", plannedShots: 3 } });
	});

	test("an authoring failure fails the section retryably and generates no image", async () => {
		setStoryBeatVisualAuthorForTests(async () => {
			throw new Error("provider unavailable");
		});
		const { section } = await generateFixture();
		expect(section.status).toBe("failed");
		expect(section.error).toContain("Visual authoring failed");
		// Never a planned prompt reused in its place.
		expect(imagePrompts).toEqual([]);
	});

	/* The coverage gate's single retry.
	 *
	 * `drone` is deliberately a subject the NARRATION never names, so invariant 4
	 * stays silent and only the planned-shot coverage invariant is under test. The
	 * first authoring pass casts a subject but not that one; whether the section
	 * survives is then entirely a question of whether a second pass happened. */
	const COVERAGE_BIBLE = storyBibleSchema.parse({
		subjects: [
			{ id: "worker-bee", label: "worker bee" },
			{ id: "drone", label: "drone bee", aliases: ["drone"] },
		],
		locations: [{ id: "hive", label: "honeycomb interior" }],
	});

	async function generateWithCoverageBible(castPerPass: readonly (readonly string[])[]) {
		const projectId = (await createContentProject({ title: "Coverage retry", type: "video" }))
			.project.id;
		const job = videoJob(projectId);
		const section = fixtureSection();
		setStoryPlan(
			job,
			45,
			[
				{
					...section,
					visualPrompts: [...section.visualPrompts!, "a drone hovering at the entrance"],
				},
			],
			false,
			false,
			{
				planningBrief: job.brief,
				factual: false,
				visualStyle: "test style bible",
				structure: "narration_section",
				language: "en",
				bible: COVERAGE_BIBLE,
			},
		);
		await approveCurrentStoryPlan(job, "explicit");
		let pass = 0;
		setStoryBeatVisualAuthorForTests(async (_section, beats) => {
			const cast = castPerPass[Math.min(pass, castPerPass.length - 1)]!;
			pass++;
			return beats.map((beat, index) => ({
				beatIndex: index,
				subjectIds: index === 0 ? [...cast] : [],
				visualMoment: `authored visual ${index + 1} — ${beat.text.slice(0, 40)}`,
				endState: `end of authored beat ${index + 1}`,
			}));
		});
		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));
		return { section: getStoryPlan(job)!.sections[0]!, passes: () => pass };
	}

	test("a coverage violation re-authors once and the section survives", async () => {
		const { section, passes } = await generateWithCoverageBible([
			["worker-bee"],
			["worker-bee", "drone"],
		]);
		expect(passes()).toBe(2);
		expect(section.status).toBe("ready");
		expect(section.error).toBeUndefined();
	});

	test("a coverage violation that survives the retry fails the section retryably", async () => {
		const { section, passes } = await generateWithCoverageBible([["worker-bee"]]);
		expect(passes()).toBe(2);
		expect(section.status).toBe("failed");
		expect(section.error).toContain("planned_shot_coverage");
		expect(section.error).toContain("drone");
		expect(imagePrompts).toEqual([]);
	});

	test("directed binding coverage retries once before image spend", async () => {
		const projectId = (await createContentProject({ title: "Binding retry", type: "video" }))
			.project.id;
		const entity = await attachTestEntity(projectId, "worker");
		const job = videoJob(projectId);
		setStoryPlan(job, 45, [directedSection({ entityId: entity.id })], false, false, {
			planningBrief: job.brief,
			factual: false,
			visualStyle: "test style bible",
			structure: "narration_section",
			language: "en",
		});
		await approveCurrentStoryPlan(job, "explicit");
		markDirected(job, `entity:${entity.id}`);
		let passes = 0;
		setStoryBeatVisualAuthorForTests(async (_section, beats) => {
			passes++;
			return beats.map((beat, index) => ({
				beatIndex: index,
				visualMoment: `pass ${passes} beat ${index} ${beat.text.slice(0, 10)}`,
				referenceBindings: passes === 1 || index > 0 ? [] : [{ entityId: entity.id }],
			}));
		});

		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));

		expect(passes).toBe(2);
		expect(getStoryPlan(job)?.sections[0]?.status).toBe("ready");
		expect(imagePrompts.length).toBeGreaterThan(0);
	});

	test("continued directed binding failure spends no image calls", async () => {
		const projectId = (await createContentProject({ title: "Binding failure", type: "video" }))
			.project.id;
		const entity = await attachTestEntity(projectId, "worker");
		const job = videoJob(projectId);
		setStoryPlan(job, 45, [directedSection({ entityId: entity.id })], false, false, {
			planningBrief: job.brief,
			factual: false,
			visualStyle: "test style bible",
			structure: "narration_section",
			language: "en",
		});
		await approveCurrentStoryPlan(job, "explicit");
		markDirected(job, `entity:${entity.id}`);
		let passes = 0;
		setStoryBeatVisualAuthorForTests(async (_section, beats) => {
			passes++;
			return beats.map((beat, index) => ({
				beatIndex: index,
				visualMoment: `beat ${index} ${beat.text.slice(0, 10)}`,
				referenceBindings: [],
			}));
		});

		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));

		expect(passes).toBe(2);
		expect(getStoryPlan(job)?.sections[0]?.error).toContain("reference_binding_coverage");
		expect(imagePrompts).toEqual([]);
	});

	test("detached direct binding fails before authoring, speech, or image spend", async () => {
		const projectId = (await createContentProject({ title: "Detached direct", type: "video" }))
			.project.id;
		const entity = await attachTestEntity(projectId, "worker");
		const job = videoJob(projectId);
		setStoryPlan(job, 45, [directedSection({ entityId: entity.id })], false, false, {
			planningBrief: job.brief,
			factual: false,
			visualStyle: "test style bible",
			structure: "narration_section",
			language: "en",
		});
		await approveCurrentStoryPlan(job, "explicit");
		markDirected(job, `entity:${entity.id}`);
		await removeProjectReference(projectId, entity.id);

		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));

		expect(getStoryPlan(job)?.sections[0]?.error).toContain("reference_detached");
		expect(authoringCalls).toEqual([]);
		expect(ttsCalls).toBe(0);
		expect(imagePrompts).toEqual([]);
	});

	test("detached materialized planned binding fails before provider spend", async () => {
		const projectId = (await createContentProject({ title: "Detached planned", type: "video" }))
			.project.id;
		const entity = await attachTestEntity(projectId, "planned-worker");
		const job = videoJob(projectId);
		const plannedReferences = [
			{
				key: "worker",
				role: "character" as const,
				label: "Worker",
				description: "Worker reference",
				status: "planned" as const,
			},
		];
		setStoryPlan(job, 45, [directedSection({ plannedKey: "worker" })], false, false, {
			planningBrief: job.brief,
			factual: false,
			visualStyle: "test style bible",
			structure: "narration_section",
			language: "en",
			plannedReferences,
		});
		await approveCurrentStoryPlan(job, "explicit");
		markDirected(job, "planned:worker");
		const plan = getStoryPlan(job)!;
		setStoryPlan(job, plan.targetSec, plan.sections, true, false, {
			...plan,
			generationState: {
				...plan.generationState!,
				materialization: {
					revisionId: plan.generationState!.approvedSnapshot!.revisionId,
					byKey: { worker: entity.id },
				},
			},
		});
		await removeProjectReference(projectId, entity.id);

		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));

		expect(getStoryPlan(job)?.sections[0]?.error).toContain("reference_detached");
		expect(authoringCalls).toEqual([]);
		expect(ttsCalls).toBe(0);
		expect(imagePrompts).toEqual([]);
	});

	test("adjacent measured beats resolve their own directed subjects", async () => {
		const projectId = (await createContentProject({ title: "Beat bindings", type: "video" }))
			.project.id;
		const first = await attachTestEntity(projectId, "first-worker");
		const second = await attachTestEntity(projectId, "second-worker");
		const job = videoJob(projectId);
		const section = directedSection({ entityId: first.id });
		section.editorial!.shots![1]!.bindings = [{ entityId: second.id }];
		setStoryPlan(job, 45, [section], false, false, {
			planningBrief: job.brief,
			factual: false,
			visualStyle: "test style bible",
			structure: "narration_section",
			language: "en",
		});
		await approveCurrentStoryPlan(job, "explicit");
		markDirected(job, `entity:${first.id}`);
		setStoryBeatVisualAuthorForTests(async (_section, beats) =>
			beats.map((beat, index) => ({
				beatIndex: index,
				visualMoment: `bound beat ${index} ${beat.text.slice(0, 10)}`,
				referenceBindings: [{ entityId: index === 0 ? first.id : second.id }],
			})),
		);

		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));

		expect(imageRefIds[0]).toEqual([first.id]);
		expect(imageRefIds[1]).toEqual([second.id]);
	});

	test("more approved shots than measured beats is not itself a violation", async () => {
		const projectId = (await createContentProject({ title: "Shot surplus", type: "video" })).project
			.id;
		const job = videoJob(projectId);
		const section = fixtureSection();
		// One short sentence cuts few beats; eight approved shots cannot each own one.
		// The target matches that one sentence so the expansion loop stays out of it.
		job.targetDurationSec = 2;
		setStoryPlan(
			job,
			2,
			[
				{
					...section,
					narration: "You wake inside a narrow wax cell.",
					visualPrompts: Array.from({ length: 8 }, (_, index) => `approved shot ${index + 1}`),
					shotCues: undefined,
				},
			],
			false,
			false,
			{
				planningBrief: job.brief,
				factual: false,
				visualStyle: "test style bible",
				structure: "narration_section",
				language: "en",
				bible: COVERAGE_BIBLE,
			},
		);
		await approveCurrentStoryPlan(job, "explicit");
		await generateStoryAssetsFlow(job, storyInputsOf(job, ["approved", "research"]));
		const generated = getStoryPlan(job)!.sections[0]!;
		expect(generated.visualPrompts?.length ?? 0).toBeGreaterThan(
			generated.visualSegments?.length ?? 0,
		);
		expect(generated.status).toBe("ready");
	});

	test("a regenerated section resolves visuals by the same rules as a full build", async () => {
		const { job, section } = await generateFixture();
		const beats = section.visualSegments?.length ?? 0;
		imagePrompts = [];
		await regenerateLongformSectionFlow(job, 0, storyInputsOf(job, ["approved", "research"]));
		const regenerated = getStoryPlan(job)?.sections[0];
		expect(regenerated?.visualSegments).toHaveLength(beats);
		expect(imagePrompts).toHaveLength(beats);
		const authored = (regenerated?.visualSegments ?? []).map((segment) =>
			authoredStoryVisualText(segment.visualPrompt),
		);
		expect(adjacentDuplicateStoryImagePromptIndexes(authored)).toEqual([]);
	});
});
