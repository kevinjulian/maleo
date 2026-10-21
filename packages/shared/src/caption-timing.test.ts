import { describe, expect, it } from "vite-plus/test";
import {
	buildCaptionWords,
	clampCaptionWordsToClip,
	estimateWordTimings,
} from "./caption-timing.ts";

describe("estimateWordTimings", () => {
	it("returns one word per token, within the clip window, in order", () => {
		const words = estimateWordTimings("The quick brown fox", 10, 4);
		expect(words.map((w) => w.text)).toEqual(["The", "quick", "brown", "fox"]);
		expect(words[0]!.startSec).toBe(10);
		expect(words[words.length - 1]!.endSec).toBeLessThanOrEqual(14 + 1e-6);
		// strictly non-decreasing timeline
		for (let i = 1; i < words.length; i++)
			expect(words[i]!.startSec).toBeGreaterThanOrEqual(words[i - 1]!.startSec);
	});

	it("gives sentence-ending punctuation a longer trailing gap than a plain word", () => {
		// "end." then "next" — the gap after "end." should exceed a normal inter-word gap.
		const w = estimateWordTimings("alpha end. next beta", 0, 8);
		const gapAfterPeriod = w[2]!.startSec - w[1]!.endSec; // after "end."
		const gapPlain = w[3]!.startSec - w[2]!.endSec; // after "next"
		expect(gapAfterPeriod).toBeGreaterThan(gapPlain);
	});

	it("handles empty / zero-duration input", () => {
		expect(estimateWordTimings("", 0, 5)).toEqual([]);
		expect(estimateWordTimings("hi there", 0, 0)).toEqual([]);
	});
});

describe("buildCaptionWords", () => {
	it("concatenates clips in start order with absolute offsets", () => {
		const words = buildCaptionWords([
			{ content: "second clip", start: 5, dur: 2 },
			{ content: "first clip", start: 0, dur: 2 },
		]);
		expect(words[0]!.text).toBe("first");
		expect(words[0]!.startSec).toBe(0);
		const secondClipStart = words.find((w) => w.text === "second")!;
		expect(secondClipStart.startSec).toBeGreaterThanOrEqual(5);
	});

	it("prefers a clip's real aligned words over estimation", () => {
		const aligned = [
			{ text: "exact", startSec: 1, endSec: 1.5 },
			{ text: "words", startSec: 1.5, endSec: 2 },
		];
		const words = buildCaptionWords([
			{ content: "ignored placeholder text", start: 1, dur: 1, words: aligned },
		]);
		expect(words).toEqual(aligned);
	});

	it("clamps real aligned words to the clip window", () => {
		const words = buildCaptionWords([
			{
				content: "ignored",
				start: 10,
				dur: 2,
				words: [
					{ text: "before", startSec: 9.5, endSec: 10.2 },
					{ text: "inside", startSec: 10.5, endSec: 11 },
					{ text: "overflow", startSec: 11.8, endSec: 20 },
					{ text: "after", startSec: 12.1, endSec: 13 },
				],
			},
		]);
		expect(words).toEqual([
			{ text: "before", startSec: 10, endSec: 10.2 },
			{ text: "inside", startSec: 10.5, endSec: 11 },
			{ text: "overflow", startSec: 11.8, endSec: 12 },
		]);
		expect(clampCaptionWordsToClip(undefined, 0, 1)).toEqual([]);
	});
});
