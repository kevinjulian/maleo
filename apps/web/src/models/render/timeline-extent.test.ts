import { describe, expect, test } from "vite-plus/test";
import type { Clip } from "@maleo/shared";
import { hasRenderableVisual, timelineTotalSec } from "./timeline-extent.ts";

const clip = (over: Partial<Clip> & { id: string }): Clip => ({
	type: "image",
	startSec: 0,
	durationSec: 2,
	track: 0,
	...over,
});

describe("timelineTotalSec", () => {
	test("is the furthest clip end, and never below 1", () => {
		expect(
			timelineTotalSec([
				clip({ id: "a", startSec: 0, durationSec: 4 }),
				clip({ id: "b", startSec: 6, durationSec: 3 }),
			]),
		).toBe(9);
		expect(timelineTotalSec([])).toBe(1);
	});

	// A transition annotates a boundary; counting it would extend the reel past
	// its last frame and pad the export with nothing.
	test("a transition does not extend the reel", () => {
		const clips = [
			clip({ id: "a", startSec: 0, durationSec: 4 }),
			clip({ id: "t", type: "transition", startSec: 4, durationSec: 30 }),
		];
		expect(timelineTotalSec(clips)).toBe(4);
	});
});

describe("hasRenderableVisual", () => {
	test("any visual clip counts; audio alone does not", () => {
		expect(hasRenderableVisual([clip({ id: "a", type: "image" })])).toBe(true);
		expect(hasRenderableVisual([clip({ id: "t", type: "text" })])).toBe(true);
		expect(hasRenderableVisual([clip({ id: "s", type: "audio" })])).toBe(false);
		expect(hasRenderableVisual([])).toBe(false);
	});
});
