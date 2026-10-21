import { describe, expect, test } from "vite-plus/test";
import { chapterSpans } from "./StoryboardReel";

const timings = (durations: number[]): Array<{ startSec: number; endSec: number }> => {
	let at = 0;
	return durations.map((d) => {
		const span = { startSec: at, endSec: at + d };
		at += d;
		return span;
	});
};

describe("chapter pills count chapters, not scenes", () => {
	test("a five-scene video in two chapters yields two spans", () => {
		// The pill reads "1/2" over the first chapter and "2/2" over the second.
		// Before chapters it read "1/5".."5/5" — one per scene.
		const scenes = [
			{ label: "Opening", chapter: "Intro" },
			{ label: "Middle", chapter: "Intro" },
			{ label: "Turn", chapter: "The Turn" },
			{ label: "Rise", chapter: "The Turn" },
			{ label: "Close", chapter: "The Turn" },
		];
		const spans = chapterSpans(scenes, timings([3, 4, 2, 5, 1]));
		expect(spans).toEqual([
			{ label: "Intro", startSec: 0, endSec: 7 },
			{ label: "The Turn", startSec: 7, endSec: 15 },
		]);
	});

	test("a span covers its whole chapter, first scene start to last scene end", () => {
		const scenes = [{ chapter: "One" }, { chapter: "One" }, { chapter: "One" }];
		expect(chapterSpans(scenes, timings([2, 3, 4]))).toEqual([
			{ label: "One", startSec: 0, endSec: 9 },
		]);
	});

	test("a chapter that recurs after another starts a new span", () => {
		// Same rule the timeline uses: runs are CONSECUTIVE, so a repeat never
		// merges backwards across a different chapter.
		const scenes = [{ chapter: "A" }, { chapter: "B" }, { chapter: "A" }];
		expect(chapterSpans(scenes, timings([1, 1, 1])).map((s) => s.label)).toEqual(["A", "B", "A"]);
	});

	test("scenes with no chapter collapse to one span", () => {
		// A storyboard from before chapters existed. One span means the pill hides
		// itself (it needs two), rather than counting scenes as chapters.
		const scenes = [{ label: "Opening" }, { label: "Middle" }, { label: "Close" }];
		expect(chapterSpans(scenes, timings([1, 2, 3]))).toEqual([
			{ label: "Opening", startSec: 0, endSec: 6 },
		]);
	});

	test("a scene with no timing is skipped rather than crashing the render", () => {
		expect(chapterSpans([{ chapter: "A" }, { chapter: "B" }], timings([1]))).toEqual([
			{ label: "A", startSec: 0, endSec: 1 },
		]);
	});
});
