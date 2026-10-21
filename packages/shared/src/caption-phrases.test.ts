import { expect, test } from "vite-plus/test";
import {
	CAPTION_PHRASE_DEFAULTS,
	groupCaptionWords,
	wrapCaptionPhrase,
} from "./caption-phrases.ts";
const words = (text: string, start = 0) =>
	text
		.split(" ")
		.map((text, i) => ({ text, startSec: start + i * 0.3, endSec: start + i * 0.3 + 0.2 }));

test("defaults are declared and phrases own fixed text with cue-local words", () => {
	expect(CAPTION_PHRASE_DEFAULTS).toMatchObject({
		maxWords: 7,
		maxCharsPerLine: 42,
		maxLines: 2,
		gapSec: 0.6,
		targetDurationSec: 3.5,
	});
	const cues = groupCaptionWords(words("one two three four five six seven eight", 10));
	expect(cues.map((cue) => cue.text)).toEqual(["one two three four five six seven", "eight"]);
	expect(cues[0]?.words[0]?.startSec).toBe(0);
	expect(cues[0]?.startSec).toBe(10);
	expect(cues.every((cue) => !cue.estimatedWordTiming)).toBe(true);
});

test("punctuation and section gaps separate phrases while short pauses stay inside", () => {
	const cues = groupCaptionWords([...words("Hello. There"), ...words("Next section", 3)]);
	expect(cues.map((cue) => cue.text)).toEqual(["Hello.", "There", "Next section"]);
	expect(cues[1]!.endSec).toBeLessThan(cues[2]!.startSec);
	const internal = groupCaptionWords([
		{ text: "Hello", startSec: 0, endSec: 0.2 },
		{ text: "again", startSec: 0.7, endSec: 1 },
	]);
	expect(internal).toHaveLength(1);
	expect(internal[0]?.endSec).toBe(1);
});

test("readable phrase targets preserve every word and bound generated lines", () => {
	const source = words(
		"Indonesian caption phrases should keep complete words while wrapping measured text safely across multiple readable phrases",
	);
	const cues = groupCaptionWords(source);
	expect(cues.flatMap((cue) => cue.words).map((word) => word.text)).toEqual(
		source.map((word) => word.text),
	);
	expect(
		cues.every(
			(cue) =>
				cue.text.split("\n").length <= 2 &&
				cue.text.split("\n").every((line) => Array.from(line).length <= 42),
		),
	).toBe(true);
});

test("long tokens, non-whitespace scripts and graphemes retain all text", () => {
	for (const text of ["x".repeat(180), "中文测试".repeat(50), "👩🏽‍💻e\u0301".repeat(80)]) {
		const cues = groupCaptionWords([{ text, startSec: 2, endSec: 8 }]);
		expect(
			cues
				.flatMap((cue) => cue.words)
				.map((word) => word.text)
				.join(""),
		).toBe(text);
		expect(cues.map((cue) => cue.text).join("")).toBe(text);
		expect(cues[0]?.startSec).toBe(2);
		expect(cues.at(-1)?.endSec).toBe(8);
		expect(cues.every((cue) => cue.estimatedWordTiming)).toBe(true);
	}
});

test("authored breaks and long authored captions are never truncated", () => {
	const text = "First line\nSecond line";
	expect(wrapCaptionPhrase(text)).toBe(text);
	expect(groupCaptionWords([{ text, startSec: 0, endSec: 2 }])[0]?.text).toBe(text);
	const long = "Already authored\n" + "x".repeat(120);
	expect(wrapCaptionPhrase(long)).toBe(long);
});

test("invalid or overlapping word times fail before grouping", () => {
	for (const word of [
		{ text: "a", startSec: -1, endSec: 1 },
		{ text: "a", startSec: 0, endSec: Infinity },
		{ text: "a", startSec: 1, endSec: 1 },
		{ text: " ", startSec: 0, endSec: 1 },
	])
		expect(() => groupCaptionWords([word])).toThrow();
	expect(() =>
		groupCaptionWords([
			{ text: "a", startSec: 0, endSec: 1 },
			{ text: "b", startSec: 0.5, endSec: 2 },
		]),
	).toThrow();
});
