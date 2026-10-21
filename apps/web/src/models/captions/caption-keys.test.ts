import { expect, test } from "vite-plus/test";
import { captionSplitTime } from "./caption-keys.ts";

const cue = (
	text: string,
	words: Array<{ text: string; startSec: number; endSec: number }>,
	startSec = 10,
	durationSec = 2,
) => ({ startSec, durationSec, caption: { text, words } });

test("caret between words splits at the next word", () => {
	const value = cue("hello world", [
		{ text: "hello", startSec: 0, endSec: 0.8 },
		{ text: "world", startSec: 1, endSec: 2 },
	]);
	expect(captionSplitTime(value, 5)).toBeCloseTo(10.9);
	expect(captionSplitTime(value, 6)).toBeCloseTo(10.9);
});

test("caret inside a word splits before that word", () => {
	const value = cue("hello world", [
		{ text: "hello", startSec: 0, endSec: 0.8 },
		{ text: "world", startSec: 1, endSec: 2 },
	]);
	expect(captionSplitTime(value, 9)).toBeCloseTo(10.9);
});

test("caret at the start, inside the first word or at the end does nothing", () => {
	const value = cue("hello world", [
		{ text: "hello", startSec: 0, endSec: 0.8 },
		{ text: "world", startSec: 1, endSec: 2 },
	]);
	expect(captionSplitTime(value, 0)).toBeNull();
	expect(captionSplitTime(value, 2)).toBeNull();
	expect(captionSplitTime(value, 11)).toBeNull();
});

test("a cue without words uses the engine's character-proportional estimate", () => {
	// "ab cdef": 6 characters over 3s, so "cdef" starts at 2/6 * 3 = 1s.
	expect(captionSplitTime(cue("ab cdef", [], 0, 3), 3)).toBeCloseTo(1);
	expect(captionSplitTime(cue("ab\ncdef", [], 0, 3), 3)).toBeCloseTo(1);
});

test("dense words resolve to the boundary the caret names", () => {
	const value = cue("a b c d", [
		{ text: "a", startSec: 0, endSec: 0.1 },
		{ text: "b", startSec: 0.1, endSec: 0.2 },
		{ text: "c", startSec: 0.2, endSec: 0.3 },
		{ text: "d", startSec: 0.3, endSec: 0.4 },
	]);
	expect(captionSplitTime(value, 4)).toBeCloseTo(10.2);
	expect(captionSplitTime(value, 6)).toBeCloseTo(10.3);
});

test("zero-length words split at their shared start, which the engine resolves to the first", () => {
	const value = cue("one two three", [
		{ text: "one", startSec: 0, endSec: 0.5 },
		{ text: "two", startSec: 0.5, endSec: 0.5 },
		{ text: "three", startSec: 0.5, endSec: 1 },
	]);
	expect(captionSplitTime(value, 4)).toBeCloseTo(10.5);
	// The caret before "three" maps to the same time as before "two"; the engine
	// takes the first boundary, so this split is refused rather than misplaced.
	expect(captionSplitTime(value, 8)).toBeNull();
});
