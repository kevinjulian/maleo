import { describe, expect, test } from "vite-plus/test";
import {
	previewFrameAt,
	sceneAtTime,
	sceneSpans,
	sceneStartOf,
	visualUrlAt,
} from "./preview-frame.ts";
import type { Scene } from "@maleo/shared";

const scene = (over: Partial<Scene> & { id: number }): Scene =>
	({
		dur: 3,
		name: "",
		shot: "",
		move: "",
		vis: "",
		vo: "",
		refIds: [],
		voiceIds: [],
		noteIds: [],
		...over,
	}) as Scene;

describe("preview frame", () => {
	test("a scene without an explicit start sits after the ones before it", () => {
		const scenes = [scene({ id: 1, dur: 2 }), scene({ id: 2, dur: 3 }), scene({ id: 3 })];
		expect(sceneStartOf(scenes, 1)).toBe(0);
		expect(sceneStartOf(scenes, 2)).toBe(2);
		expect(sceneStartOf(scenes, 3)).toBe(5);
	});

	test("an explicit start wins over the sequential position", () => {
		const scenes = [scene({ id: 1, dur: 2 }), scene({ id: 2, start: 10 })];
		expect(sceneStartOf(scenes, 2)).toBe(10);
	});

	test("a time in a gap covers no scene", () => {
		const scenes = [scene({ id: 1, dur: 2 }), scene({ id: 2, start: 10 })];
		expect(sceneAtTime(scenes, 5)).toBeUndefined();
	});

	test("the topmost track wins where two scenes overlap", () => {
		const scenes = [
			scene({ id: 1, dur: 5, start: 0 }),
			scene({ id: 2, dur: 5, start: 0, track: 1 }),
		];
		expect(sceneAtTime(scenes, 1)?.id).toBe(2);
	});

	test("a single-image beat shows the scene's own source", () => {
		const scenes = [scene({ id: 1, src: "a.png" })];
		expect(visualUrlAt(scenes, scenes[0]!, 1)).toBe("a.png");
	});

	test("a multi-image beat shows the clip live at the time, last match winning", () => {
		const s = scene({
			id: 1,
			dur: 6,
			src: "a.png",
			visualClips: [
				{ id: "v1", url: "one.png", startSec: 0, durationSec: 3, primary: true },
				{ id: "v2", url: "two.png", startSec: 3, durationSec: 3 },
			],
		} as Partial<Scene> & { id: number });
		const scenes = [s];
		expect(visualUrlAt(scenes, s, 1)).toBe("one.png");
		expect(visualUrlAt(scenes, s, 4)).toBe("two.png");
	});

	test("a multi-image beat falls back to the primary clip outside every span", () => {
		const s = scene({
			id: 1,
			dur: 6,
			src: "a.png",
			visualClips: [
				{ id: "v1", url: "one.png", startSec: 1, durationSec: 1 },
				{ id: "v2", url: "two.png", startSec: 4, durationSec: 1, primary: true },
			],
		} as Partial<Scene> & { id: number });
		expect(visualUrlAt([s], s, 3)).toBe("two.png");
	});

	test("the frame is the scene and its image together", () => {
		const scenes = [scene({ id: 1, dur: 2, src: "a.png" }), scene({ id: 2, dur: 2, src: "b.png" })];
		expect(previewFrameAt(scenes, 3)).toEqual({ scene: scenes[1], visualUrl: "b.png" });
		expect(previewFrameAt(scenes, 99)).toEqual({ scene: undefined, visualUrl: undefined });
	});
});

describe("scene spans", () => {
	test("a run of scenes is contiguous", () => {
		const scenes = [scene({ id: 1, dur: 2 }), scene({ id: 2, dur: 3 })];
		expect(sceneSpans(scenes)).toEqual([
			{ start: 0, end: 2 },
			{ start: 2, end: 5 },
		]);
	});

	test("an explicit start moves the span and what follows it", () => {
		const scenes = [
			scene({ id: 1, dur: 2 }),
			scene({ id: 2, dur: 2, start: 10 }),
			scene({ id: 3, dur: 1 }),
		];
		expect(sceneSpans(scenes)).toEqual([
			{ start: 0, end: 2 },
			{ start: 10, end: 12 },
			{ start: 12, end: 13 },
		]);
	});

	test("a multi-image beat contributes its visual clips too", () => {
		const s = scene({
			id: 1,
			dur: 4,
			visualClips: [
				{ id: "v1", url: "one.png", startSec: 0, durationSec: 2 },
				{ id: "v2", url: "two.png", startSec: 2, durationSec: 2 },
			],
		} as Partial<Scene> & { id: number });
		expect(sceneSpans([s])).toEqual([
			{ start: 0, end: 4 },
			{ start: 0, end: 2 },
			{ start: 2, end: 4 },
		]);
	});
});
