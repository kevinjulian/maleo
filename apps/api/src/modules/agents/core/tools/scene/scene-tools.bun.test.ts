import { describe, expect, test } from "bun:test";
import { mediaUrl, mintMediaId } from "@maleo/shared";
import { buildToolContext } from "../../tool-executor.ts";
import { sceneEditCommand } from "@maleo/shared/editor";
import { runDocument } from "../../edit-document.ts";
import { viewTimeline } from "../read/view-timeline.ts";
import { updateScene } from "./update-scene.ts";
import { removeScene } from "./remove-scene.ts";
import type { AgentJob } from "../../model.ts";

const job = (): AgentJob => ({
	id: "job",
	projectId: "p",
	contentType: "video",
	status: "running",
	events: [],
	scenes: [
		{
			id: 40,
			startSec: 0,
			name: "Open",
			durationSec: 3,
			shot: "wide",
			move: "static",
			transition: "fade",
			visual: "a",
			voiceover: "one",
			audioUrl: "vo1.mp3",
		},
		{
			id: 12,
			startSec: 3,
			name: "Middle",
			durationSec: 4,
			shot: "wide",
			move: "static",
			transition: "fade",
			visual: "b",
			voiceover: "two",
		},
		{
			id: 77,
			startSec: 9,
			name: "Close",
			durationSec: 2,
			shot: "wide",
			move: "static",
			transition: "fade",
			visual: "c",
			voiceover: "three",
		},
	],
	textOverlays: [],
	infographicOverlays: [],
	videoOverlays: [],
	audioOverlays: [],
	characters: [],
	artifacts: [],
	aspect: "16:9",
	brief: "b",
	startedAt: 0,
});

const call = <A>(
	tool: { handler?: (ctx: ReturnType<typeof buildToolContext>, args: A) => Promise<unknown> },
	j: AgentJob,
	args: A,
) => tool.handler!(buildToolContext(j), args);

describe("update_scene", () => {
	test("records the scene's update command and changes only that scene", async () => {
		const j = job();
		const before = runDocument(j);
		await call(updateScene, j, { index: 1, durationSec: 5, name: "Longer" });

		expect(j.editCommands).toEqual([sceneEditCommand(before, 12, { name: "Longer", dur: 5 })]);
		const scene = j.scenes[1]!;
		expect([scene.id, scene.name, scene.durationSec, scene.startSec]).toEqual([12, "Longer", 5, 3]);
		expect(j.scenes[2]!.startSec).toBe(9);
		expect(j.scenes[0]!.audioUrl).toBe("vo1.mp3");
		expect(runDocument(j).markers.find((m) => m.id === 12)?.endSec).toBe(8);
	});

	test("view_timeline next in the run shows the edit", async () => {
		const j = job();
		await call(updateScene, j, { index: 1, durationSec: 5, name: "Longer" });
		const { note } = (await call(viewTimeline, j, {})) as { note: string };
		expect(note).toContain("#2 Longer 3.0-8.0s");
	});

	test("view_timeline counts a clip on a minted identity still importing as read-only", async () => {
		const mediaId = mintMediaId();
		const overlay = {
			id: 5,
			url: mediaUrl(mediaId),
			kind: "video" as const,
			label: "b",
			startSec: 0,
			durationSec: 2,
			track: 2,
		};
		const j = { ...job(), videoOverlays: [overlay], pendingMediaIds: [mediaId] };
		expect(((await call(viewTimeline, j, {})) as { note: string }).note).toContain(
			"1 clip(s) use a file still uploading",
		);
		const done = { ...job(), videoOverlays: [overlay], pendingMediaIds: [] };
		expect(((await call(viewTimeline, done, {})) as { note: string }).note).not.toContain(
			"uploading",
		);
	});

	test("an empty string clears an optional field", async () => {
		const j = job();
		await call(updateScene, j, { index: 0, claim: "x" });
		await call(updateScene, j, { index: 0, claim: "" });
		expect(j.scenes[0]!.claim).toBeUndefined();
		expect(j.editCommands).toHaveLength(2);
	});

	test("an index outside the timeline is an error and records nothing", async () => {
		const j = job();
		await expect(call(updateScene, j, { index: 3, name: "x" })).rejects.toThrow(
			"No scene at index 3",
		);
		expect(j.editCommands).toBeUndefined();
	});
});

describe("remove_scene", () => {
	test("removes the scene and its marker, leaving the others where they are", async () => {
		const j = job();
		await call(removeScene, j, { index: 0 });

		expect(j.scenes.map((s) => [s.id, s.startSec])).toEqual([
			[12, 3],
			[77, 9],
		]);
		expect(runDocument(j).markers.map((m) => m.id)).toEqual([12, 77]);
		expect(j.editCommands).toHaveLength(1);
	});

	test("an index outside the timeline is an error and records nothing", async () => {
		const j = job();
		await expect(call(removeScene, j, { index: 9 })).rejects.toThrow("No scene at index 9");
		expect(j.scenes).toHaveLength(3);
		expect(j.editCommands).toBeUndefined();
	});
});
