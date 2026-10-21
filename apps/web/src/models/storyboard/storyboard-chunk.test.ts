import { describe, expect, it } from "vite-plus/test";
import { chunkScenes, continuityNote, sceneTimings, totalDurationSec } from "./storyboard-chunk.ts";
import type { Scene } from "@maleo/shared";

function scene(id: number, dur: number): Scene {
	return {
		id,
		dur,
		name: `S${id}`,
		shot: "Medium Shot",
		move: "Static",
		vis: "",
		vo: "",
		img: false,
	};
}

describe("sceneTimings", () => {
	it("accumulates start/end seconds", () => {
		const t = sceneTimings([scene(1, 3), scene(2, 4), scene(3, 5)]);
		expect(t).toEqual([
			{ startSec: 0, endSec: 3 },
			{ startSec: 3, endSec: 7 },
			{ startSec: 7, endSec: 12 },
		]);
	});

	it("treats zero/invalid duration as 1s", () => {
		const t = sceneTimings([scene(1, 0), scene(2, 2)]);
		expect(t[0]).toEqual({ startSec: 0, endSec: 1 });
		expect(t[1]).toEqual({ startSec: 1, endSec: 3 });
	});
});

describe("totalDurationSec", () => {
	it("sums clamped durations", () => {
		expect(totalDurationSec([scene(1, 3), scene(2, 0)])).toBe(4);
		expect(totalDurationSec([])).toBe(0);
	});
});

describe("chunkScenes", () => {
	it("keeps a short storyboard in one chunk", () => {
		const chunks = chunkScenes([scene(1, 3), scene(2, 4), scene(3, 3)]);
		expect(chunks.length).toBe(1);
		expect(chunks[0].part).toBe(1);
		expect(chunks[0].startSec).toBe(0);
		expect(chunks[0].endSec).toBe(10);
		expect(chunks[0].scenes.length).toBe(3);
	});

	it("splits when the duration cap would be exceeded", () => {
		const chunks = chunkScenes([scene(1, 6), scene(2, 6), scene(3, 6)], { maxDurationSec: 10 });
		expect(chunks.length).toBe(3);
		expect(chunks[1].startSec).toBe(6);
		expect(chunks[1].endSec).toBe(12);
	});

	it("splits on the scene-count cap even when duration fits", () => {
		const scenes = [1, 2, 3, 4, 5, 6].map((i) => scene(i, 1));
		const chunks = chunkScenes(scenes, { maxScenes: 5, maxDurationSec: 100 });
		expect(chunks.length).toBe(2);
		expect(chunks[0].scenes.length).toBe(5);
		expect(chunks[1].scenes.length).toBe(1);
	});

	it("gives an over-length single scene its own chunk", () => {
		const chunks = chunkScenes([scene(1, 25), scene(2, 3)], { maxDurationSec: 10 });
		expect(chunks.length).toBe(2);
		expect(chunks[0].scenes.length).toBe(1);
		expect(chunks[0].endSec).toBe(25);
		expect(chunks[1].startSec).toBe(25);
	});

	it("keeps global timings continuous across chunks", () => {
		const chunks = chunkScenes([scene(1, 8), scene(2, 8), scene(3, 8)], { maxDurationSec: 10 });
		const flat = chunks.flatMap((c) => c.timings);
		expect(flat).toEqual([
			{ startSec: 0, endSec: 8 },
			{ startSec: 8, endSec: 16 },
			{ startSec: 16, endSec: 24 },
		]);
	});

	it("returns no chunks for an empty storyboard", () => {
		expect(chunkScenes([])).toEqual([]);
	});
});

describe("continuityNote", () => {
	it("is null for single-part storyboards and for part 1", () => {
		expect(continuityNote(1, 1)).toBeNull();
		expect(continuityNote(1, 3)).toBeNull();
	});

	it("references the previous part", () => {
		const note = continuityNote(2, 3);
		expect(note).toContain("Part 2 of 3");
		expect(note).toContain("part 1");
	});
});
