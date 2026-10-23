import { afterEach, describe, expect, test } from "bun:test";
import { buildToolContext } from "../tool-executor.ts";
import { setSceneFrameGeneratorForTests } from "../visual-gen.ts";
import { addText } from "./overlay/add-text.ts";
import { toolsForContentType } from "../registry.ts";
import { addAudio } from "./audio/add-audio.ts";
import { addOverlay } from "./visual/add-overlay.ts";
import type { AgentJob } from "../model.ts";

const job = (): AgentJob => ({
	id: "job",
	projectId: "p",
	contentType: "video",
	status: "running",
	events: [],
	scenes: [
		{
			id: 5,
			startSec: 0,
			name: "Open",
			durationSec: 4,
			shot: "wide",
			move: "static",
			transition: "fade",
			visual: "a",
			voiceover: "one",
		},
	],
	textOverlays: [{ id: 2, content: "Hi", startSec: 0, durationSec: 2, track: 0 }],
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
const inserted = (j: AgentJob) =>
	j.editCommands?.map((c) => (c.type === "clip.insert" ? c.clip : undefined));

afterEach(() => setSceneFrameGeneratorForTests(null));

describe("placements are clip inserts", () => {
	test("add_text inserts the text clip the projection builds, beside the existing one", async () => {
		const j = job();
		await call(addText, j, {
			content: "Chapter 2",
			startSec: 1,
			durationSec: 3,
			preset: "chapter",
		});

		const [clip] = inserted(j)!;
		expect(clip).toMatchObject({
			type: "text",
			startSec: 1,
			durationSec: 3,
			text: { content: "Chapter 2", preset: "chapter" },
		});
		expect(clip!.id).not.toBe("text:2");
		expect(j.textOverlays.map((t) => t.content)).toEqual(["Hi", "Chapter 2"]);
	});

	test("the video tool list has no add_infographic", () => {
		const names = toolsForContentType("video").map((tool) => tool.name);
		expect(names).toContain("add_text");
		expect(names).not.toContain("add_infographic");
	});

	test("add_audio with a url", async () => {
		const j = job();
		await call(addAudio, j, {
			kind: "sfx",
			content: "door",
			url: "door.mp3",
			startSec: 2,
			durationSec: 1,
		});
		expect(inserted(j)![0]).toMatchObject({
			type: "audio",
			startSec: 2,
			audio: { kind: "sfx", url: "door.mp3" },
		});
	});

	test("add_overlay with a url places it on its lane", async () => {
		const j = job();
		await call(addOverlay, j, { url: "b.png", startSec: 1, durationSec: 2 });
		expect(inserted(j)![0]).toMatchObject({ type: "image", track: 1, video: { url: "b.png" } });
	});

	test("add_overlay with a prompt generates the image, then places it by command", async () => {
		const j = job();
		setSceneFrameGeneratorForTests(async () => "/uploads/generated.png");
		await call(addOverlay, j, { prompt: "a product close-up", startSec: 0, durationSec: 2 });

		expect(j.events).toContainEqual({
			kind: "asset_created",
			assetType: "image",
			url: "/uploads/generated.png",
		});
		expect(inserted(j)![0]).toMatchObject({ video: { url: "/uploads/generated.png" } });
		expect(j.editCommands).toHaveLength(1);
	});
});
