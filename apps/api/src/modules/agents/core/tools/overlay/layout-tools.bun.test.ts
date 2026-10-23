import { describe, expect, test } from "bun:test";
import { defaultClipLayout } from "@maleo/shared";
import { setKeys, updateClip } from "@maleo/shared/editor";
import { buildToolContext } from "../../tool-executor.ts";
import { runDocument } from "../../edit-document.ts";
import { setClipLayout } from "./set-clip-layout.ts";
import { setKeyframes } from "./set-keyframes.ts";
import type { AgentJob } from "../../model.ts";

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
			image: "a.png",
			layout: { xPct: 0, widthPct: 100 },
		},
	],
	textOverlays: [
		{
			id: 2,
			content: "Hi",
			startSec: 0,
			durationSec: 2,
			preset: "title",
			layout: { xPct: 10, yPct: 60 },
			track: 0,
		},
	],
	videoOverlays: [{ id: 3, url: "v.mp4", kind: "video", startSec: 0, durationSec: 3, track: 1 }],
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

describe("set_clip_layout", () => {
	test("a text overlay: one clip update carrying the merged layout", async () => {
		const j = job();
		const text = runDocument(j).clips.find((c) => c.id === "text:2")!.text!;
		await call(setClipLayout, j, { target: "text", index: 0, yPct: 20 });

		const layout = { ...defaultClipLayout("text"), xPct: 10, yPct: 20 };
		expect(j.editCommands).toEqual([updateClip("text:2", { text: { ...text, layout } })]);
		expect(j.textOverlays[0]!.layout).toEqual(layout);
	});

	test("an overlay clip", async () => {
		const j = job();
		await call(setClipLayout, j, { target: "video", index: 0, widthPct: 40, opacity: 3 });
		expect(j.editCommands?.[0]).toMatchObject({ type: "clip.update", id: "video:3" });
		expect(j.videoOverlays[0]!.layout).toEqual({
			...defaultClipLayout("video"),
			widthPct: 40,
			opacity: 1,
		});
	});

	test("a scene: the scene's layout, through the scene edit", async () => {
		const j = job();
		await call(setClipLayout, j, { target: "scene", index: 0, xPct: 25, fit: "contain" });
		expect(j.editCommands).toHaveLength(1);
		expect(j.scenes[0]!.layout).toEqual({
			...defaultClipLayout("scene"),
			xPct: 25,
			widthPct: 100,
			fit: "contain",
		});
	});

	test("a missing index is an error and records nothing", async () => {
		const j = job();
		await expect(call(setClipLayout, j, { target: "text", index: 3, xPct: 1 })).rejects.toThrow(
			"No text overlay at index 3",
		);
		expect(j.editCommands).toBeUndefined();
	});
});

describe("set_keyframes", () => {
	test("records the clip.setKeys command the key lanes commit, keys sorted", async () => {
		const j = job();
		await call(setKeyframes, j, {
			target: "video",
			index: 0,
			property: "volume",
			keys: [
				{ t: 3, v: 0 },
				{ t: 0, v: 1 },
			],
		});
		expect(j.editCommands).toEqual([
			setKeys("video:3", "volume", [
				{ t: 0, v: 1 },
				{ t: 3, v: 0 },
			]),
		]);
	});

	test("a refusal records nothing", async () => {
		const j = job();
		await call(setKeyframes, j, {
			target: "text",
			index: 0,
			property: "opacity",
			keys: [{ t: 9, v: 1 }],
		});
		expect(j.editCommands).toBeUndefined();
	});
});
