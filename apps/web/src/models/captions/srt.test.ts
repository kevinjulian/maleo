import { expect, test } from "vite-plus/test";
import { captionClipsToSrt, fromSrtTime, importSrtCaptions, parseSrt, toSrtTime } from "./srt.ts";
import { engineExecutor, replaceScope } from "@maleo/shared/editor";
import { testEngine } from "@models/editor-engine/engine-fixture.ts";
import type { EditScope } from "@maleo/shared/editor";

const sample =
	"1\n00:00:01,234 --> 00:00:03,579\nHello\nworld!\n\n2\n00:00:04,000 --> 00:00:05,000\nNext cue\n";
const empty = { schemaVersion: 2 as const, clips: [], markers: [] };

test("SRT reuses an empty caption lane and respects its lock", () => {
	const doc = {
		...empty,
		trackFlags: { 0: { group: "audio" as const }, 1: { group: "caption" as const, locked: false } },
	};
	const result = importSrtCaptions(doc, parseSrt(sample), "reuse");
	expect(result.clips.every((clip) => clip.track === 1)).toBe(true);
	expect(result.trackFlags).toEqual(doc.trackFlags);
	doc.trackFlags[1].locked = true;
	expect(() => importSrtCaptions(doc, parseSrt(sample), "locked")).toThrow("Unlock");
});

test("timestamp rounding carries milliseconds across second, minute and hour boundaries", () => {
	expect(toSrtTime(1.9996)).toBe("00:00:02,000");
	expect(toSrtTime(59.9996)).toBe("00:01:00,000");
	expect(toSrtTime(3599.9996)).toBe("01:00:00,000");
	expect(fromSrtTime("01:02:03.4")).toBe(3723.4);
	for (const value of ["00:60:00,000", "00:00:61,000", "-1:00:00,000", "NaN"])
		expect(fromSrtTime(value)).toBeNull();
	expect(() => toSrtTime(Infinity)).toThrow();
});

test("import without narration preserves authored cues, breaks and millisecond intervals", () => {
	const parsed = parseSrt(sample);
	expect(parsed.malformedBlocks).toBe(0);
	expect(parsed.cues[0]?.text).toBe("Hello\nworld!");
	const doc = importSrtCaptions(empty, parsed, "import-1");
	expect(doc.clips).toHaveLength(2);
	expect(doc.clips.every((clip) => clip.type === "caption")).toBe(true);
	expect(doc.clips[0]?.caption?.provenance).toEqual({
		origin: "imported",
		wordTimingOrigin: "estimated",
	});
	expect(doc.clips[0]?.caption?.sources).toEqual([]);
	expect(parseSrt(captionClipsToSrt(doc.clips)).cues).toEqual(parsed.cues);
});

test("CRLF, missing indices, malformed blocks and overlapping cues have explicit diagnostics", () => {
	const result = parseSrt(
		"00:00:01,000 --> 00:00:03,000\r\nFirst\r\n\r\nbad block\r\n\r\n2\r\n00:00:02,000 --> 00:00:04,000\r\nSecond",
	);
	expect(result.cues).toHaveLength(2);
	expect(result.malformedBlocks).toBe(1);
	expect(result.overlappingCues).toBe(1);
});

test("invalid files leave existing cues unchanged and locked tracks refuse replacement", () => {
	const doc = importSrtCaptions(empty, parseSrt(sample), "first");
	const before = JSON.stringify(doc);
	expect(() => importSrtCaptions(doc, parseSrt("invalid"), "second")).toThrow("No valid captions");
	expect(JSON.stringify(doc)).toBe(before);
	expect(() =>
		importSrtCaptions({ ...doc, trackFlags: { 0: { locked: true } } }, parseSrt(sample), "second"),
	).toThrow("Unlock");
});

test("short cues retain positive local estimated word intervals without losing text", () => {
	const parsed = parseSrt("1\n00:00:00,000 --> 00:00:00,001\nA very short cue");
	const doc = importSrtCaptions(empty, parsed, "short");
	const words = doc.clips[0]!.caption!.words;
	expect(words.every((word) => word.endSec > word.startSec && word.endSec <= 0.001)).toBe(true);
	expect(words.map((word) => word.text).join(" ")).toBe("A very short cue");
});

test("one import command has exact undo and retains unrelated document fields", () => {
	const executor = engineExecutor(testEngine);
	const scope: EditScope = { doc: empty, mediaAssets: [], slides: [], posts: [] };
	const imported = importSrtCaptions(scope.doc, parseSrt(sample), "undo");
	const output = executor.execute(
		scope,
		replaceScope({ ...scope, doc: imported }, "captions.import"),
	);
	expect(output.scope.doc).toEqual(imported);
	expect(executor.execute(output.scope, output.inverse).scope).toEqual(scope);
});
