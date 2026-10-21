import { describe, expect, test } from "bun:test";
import { removeClip, sceneEditCommand, updateClip, type EditorCommand } from "@maleo/shared/editor";
import type { Clip } from "@maleo/shared";
import { agentTimelineDoc } from "./document.ts";
import { executeEdit, jobFamiliesOf, runDocument } from "./edit-document.ts";
import { reconstructCheckpointJob } from "./rehydrate.ts";
import type { AgentJob } from "./model.ts";

/* Every field an agent scene can carry, with valid union members, so a field the
 * round trip drops shows up as a difference rather than a fallback. */
const fullScene = (id: number, name: string, startSec?: number): AgentJob["scenes"][number] => ({
	id,
	startSec,
	track: 0,
	name,
	durationSec: 4,
	contentDurationSec: 3.5,
	shot: "wide",
	move: "push",
	transition: "cut",
	transitionLocked: true,
	visual: "a room",
	voiceover: "hello",
	action: "walk",
	sfx: "door",
	image: `${name}.png`,
	audioUrl: `${name}.mp3`,
	layout: { xPct: 10, widthPct: 50 },
	refIds: ["r1"],
	useGlobalReferences: false,
	beat: "hook",
	emotion: "curiosity",
	intent: "i",
	question: "q",
	claim: "c",
	evidence: "e",
	sourceEvidence: [{ url: "u", quote: "q" }],
	analogy: "a",
	visualType: "diagram",
	onScreenText: "t",
	sectionTransition: { text: "x" },
	sceneKind: "storyboard",
	sceneKey: `${name}-key`,
	logicalSceneId: "l",
	sectionId: "s1",
	storyBeatId: "b",
	sourceRevisionId: "r",
	storyboardSceneId: "sb",
	imageSourceStoryboardSceneId: "is",
	editorialPatternId: "ep",
});

const effect: Clip = {
	id: "effect:1",
	type: "effect",
	startSec: 0,
	durationSec: 1,
	track: 0,
	effect: { id: 1, effect: "flash", start: 0, dur: 1, track: 0, intensity: 1 },
};

const job = (over: Partial<AgentJob> = {}): AgentJob => ({
	id: "job",
	projectId: "p1",
	contentType: "video",
	status: "running",
	events: [],
	scenes: [fullScene(7, "open", 0), fullScene(3, "close", 6)],
	textOverlays: [
		{
			id: 2,
			content: "Hi",
			startSec: 1,
			durationSec: 2,
			preset: "title",
			layout: { xPct: 5 },
			track: 1,
		},
	],
	infographicOverlays: [
		{
			id: 4,
			startSec: 0,
			durationSec: 3,
			track: 0,
			layout: { xPct: 1 },
			payload: { type: "stat_reveal", value: "1", label: "x" } as never,
		},
	],
	videoOverlays: [
		{
			id: 5,
			url: "v.mp4",
			kind: "video",
			label: "b",
			startSec: 0,
			durationSec: 2,
			track: 2,
			layout: { xPct: 3 },
			volume: 0.5,
			mediaStartSec: 1,
			mediaAssetId: "m",
		},
	],
	audioOverlays: [
		{
			id: 9,
			kind: "music",
			origin: "stock",
			content: "bed",
			url: "m.mp3",
			startSec: 0,
			durationSec: 5,
			track: 0,
			volume: 0.3,
			fadeIn: 1,
			fadeOut: 1,
		},
	],
	clientClips: [effect],
	characters: [],
	artifacts: [],
	aspect: "16:9",
	brief: "b",
	startedAt: 0,
	...over,
});

const families = (j: AgentJob) => ({
	scenes: j.scenes,
	textOverlays: j.textOverlays,
	infographicOverlays: j.infographicOverlays,
	videoOverlays: j.videoOverlays,
	audioOverlays: j.audioOverlays,
});

describe("job ↔ document round trip", () => {
	test("projecting a job and reading it back leaves every family unchanged", () => {
		const j = job();
		expect(jobFamiliesOf(agentTimelineDoc(j, j.clientClips), j.scenes)).toEqual(families(j));
	});

	test("a seeded scene keeps its editor id, not its position", () => {
		const doc = runDocument(job());
		expect(
			doc.clips
				.filter((c) => c.type !== "effect")
				.slice(0, 2)
				.map((c) => c.id),
		).toEqual(["scene:7", "scene:3"]);
	});

	test("an agent-created scene is minted above the seeded ids, the same id each time", () => {
		const j = job({ scenes: [fullScene(7, "open"), { ...fullScene(0, "new"), id: undefined }] });
		expect(runDocument(j).clips.map((c) => c.id)).toContain("scene:8");
		expect(runDocument(j).clips.map((c) => c.id)).toContain("scene:8");
	});
});

describe("executeEdit", () => {
	test("executes the command, writes the families back and records it", () => {
		const j = job();
		const command = updateClip("text:2", {
			text: { ...runDocument(j).clips.find((c) => c.id === "text:2")!.text!, content: "Hello" },
		});

		expect(executeEdit(j, command)).toEqual({ ok: true });
		expect(j.textOverlays[0]!.content).toBe("Hello");
		expect(j.scenes[0]!.audioUrl).toBe("open.mp3");
		expect(j.clientClips).toEqual([effect]);
		expect(j.editCommands).toEqual([command]);
	});

	test("a removal reaches the job's family", () => {
		const j = job();
		expect(executeEdit(j, removeClip("scene:7"))).toEqual({ ok: true });
		expect(j.scenes.map((s) => s.id)).toEqual([3]);
	});

	test("a refused command leaves the job exactly as it was", () => {
		const j = job();
		const before = structuredClone(j);
		const outcome = executeEdit(j, removeClip("scene:99"));

		expect(outcome.ok).toBe(false);
		expect(j).toEqual(before);
	});

	test("a clip on a file still uploading is refused and stays exactly as it was", () => {
		const j = job({
			videoOverlays: [{ ...job().videoOverlays[0]!, url: "pending:k1", mediaAssetId: "k1" }],
		});
		const before = structuredClone(j);
		const id = runDocument(j).clips.find((c) => c.id.startsWith("video:"))!.id;
		for (const command of [updateClip(id, { startSec: 3 }), removeClip(id)]) {
			const outcome = executeEdit(j, command);
			expect(outcome).toMatchObject({
				ok: false,
				error: expect.stringContaining("still uploading"),
			});
			expect(j).toEqual(before);
		}
	});

	test("a command that changes nothing is not recorded", () => {
		const j = job();
		const before = structuredClone(j);

		expect(executeEdit(j, updateClip("text:2", { track: 1 }))).toEqual({
			ok: false,
			error: "clip.update changed nothing",
		});
		expect(j).toEqual(before);
	});

	test("recorded commands survive a parked run's rehydration", () => {
		const j = job({
			status: "awaiting_input",
			editCommands: [removeClip("scene:7")],
			run: {
				instruction: "",
				transcript: "",
				step: 0,
				builtSomething: false,
				finishRejected: false,
				asks: 0,
			},
		});
		j.generatedCaptionSources = {
			"/api/media/00000000-0000-4000-8000-000000000001": {
				language: "en",
				provenance: { origin: "estimated", wordTimingOrigin: "estimated" },
			},
		};
		const rebuilt = reconstructCheckpointJob({
			status: "awaiting_input",
			job: { ...j, pendingQuestion: { question: "ok?", options: [] } },
		});
		expect(rebuilt?.editCommands).toEqual([removeClip("scene:7")]);
		expect(rebuilt?.generatedCaptionSources).toEqual(j.generatedCaptionSources);
	});
});

describe("a scene command keeps what only the editor holds", () => {
	test("cast, seed and frame provenance survive an agent's rename, and no other scene is written", async () => {
		const j = job();
		j.editorScenes = runDocument(j).clips.flatMap((c) =>
			c.scene ? [{ ...c.scene, castId: "cast-1", seed: 42, frameInputHash: "h1" }] : [],
		);
		const doc = runDocument(j);
		const command = sceneEditCommand(doc, 3, { name: "Renamed" });

		expect(executeEdit(j, command)).toEqual({ ok: true });
		const flat = (c: EditorCommand): EditorCommand[] =>
			c.type === "batch" ? c.commands.flatMap(flat) : [c];
		const writes = flat(command).filter((c) => c.type === "clip.update");
		expect(writes.map((c) => c.type === "clip.update" && c.id)).toEqual(["scene:3"]);
		const scene = runDocument(j).clips.find((c) => c.id === "scene:3")!.scene!;
		expect([scene.name, scene.castId, scene.seed, scene.frameInputHash]).toEqual([
			"Renamed",
			"cast-1",
			42,
			"h1",
		]);
	});
});
