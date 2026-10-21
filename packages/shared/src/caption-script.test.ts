import { describe, expect, it } from "vite-plus/test";
import {
	alignCaptionWordsToScript,
	captionsToCaptionWords,
	offsetCaptionWords,
} from "./caption-script.ts";

describe("captionsToCaptionWords", () => {
	it("converts Remotion Caption ms timings to second timings with offset", () => {
		const words = captionsToCaptionWords(
			[
				{ text: " hello", startMs: 120, endMs: 480, timestampMs: 250, confidence: 0.9 },
				{ text: "world", startMs: 500, endMs: 900, timestampMs: null, confidence: null },
			],
			3.5,
		);
		expect(words).toEqual([
			{ text: "hello", startSec: 3.62, endSec: 3.98 },
			{ text: "world", startSec: 4, endSec: 4.4 },
		]);
	});

	it("drops empty or zero-length captions", () => {
		const words = captionsToCaptionWords([
			{ text: " ", startMs: 100, endMs: 200, timestampMs: null, confidence: null },
			{ text: "bad", startMs: 300, endMs: 300, timestampMs: null, confidence: null },
		]);
		expect(words).toEqual([]);
	});

	it("applies offsets after local cached words are read", () => {
		const words = offsetCaptionWords(
			[
				{ text: "local", startSec: 0.12, endSec: 0.48 },
				{ text: "word", startSec: 0.5, endSec: 0.9 },
			],
			121.342,
		);
		expect(words).toEqual([
			{ text: "local", startSec: 121.462, endSec: 121.822 },
			{ text: "word", startSec: 121.842, endSec: 122.242 },
		]);
	});

	it("uses script text while preserving Whisper timing anchors", () => {
		const words = alignCaptionWordsToScript(
			[
				{ text: "teruntuhan", startSec: 0.22, endSec: 0.73 },
				{ text: "besar", startSec: 0.73, endSec: 1.09 },
				{ text: "jarang", startSec: 1.09, endSec: 1.54 },
				{ text: "satu", startSec: 5.37, endSec: 5.38 },
				{ text: "arah", startSec: 5.38, endSec: 5.67 },
			],
			"Keruntuhan besar jarang satu arah",
		);
		expect(words.map((word) => word.text)).toEqual([
			"Keruntuhan",
			"besar",
			"jarang",
			"satu",
			"arah",
		]);
		expect(words[0]?.startSec).toBe(0.22);
		expect(words[0]?.endSec).toBe(0.73);
		expect((words[3]?.endSec ?? 0) - (words[3]?.startSec ?? 0)).toBeGreaterThan(0.08);
	});
});

it("refuses oversized script alignment before allocating its matrix", () => {
	expect(() =>
		alignCaptionWordsToScript(
			Array.from({ length: 2100 }, () => ({ text: "word", startSec: 0, endSec: 1 })),
			"word ".repeat(2100),
		),
	).toThrow("split narration");
});
