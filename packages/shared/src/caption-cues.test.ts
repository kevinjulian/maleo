import { describe, expect, test } from "vite-plus/test";
import {
	CaptionClipSchema,
	CaptionSetSchema,
	captionSourceReferencesValid,
	captionTrackFor,
	type CaptionCue,
} from "./caption-cues.ts";
import type { Clip } from "./timeline-doc.ts";

test("caption lane allocation reuses declared lanes and reserves other empty lanes", () => {
	expect(captionTrackFor({ clips: [] })).toBe(0);
	expect(
		captionTrackFor({ clips: [], trackFlags: { 0: { group: "audio" }, 1: { group: "effect" } } }),
	).toBe(2);
	expect(
		captionTrackFor({ clips: [], trackFlags: { 0: { group: "audio" }, 1: { group: "caption" } } }),
	).toBe(1);
	expect(
		captionTrackFor({
			clips: [{ id: "caption:1", type: "caption", startSec: 0, durationSec: 1, track: 3 }],
			trackFlags: { 1: { group: "caption" } },
		}),
	).toBe(3);
});

const cue: CaptionCue = {
	text: "Hello\nworld!",
	words: [
		{ text: "Hello", startSec: 0, endSec: 0.8 },
		{ text: "world!", startSec: 1, endSec: 2 },
	],
	provenance: { origin: "imported", wordTimingOrigin: "estimated" },
	sources: [
		{ clipId: "video:1", mediaId: "m1", mediaRevision: "r1", sourceStartSec: 10, sourceEndSec: 12 },
	],
	protection: { text: true, timing: false, segmentation: true, style: false },
	revision: 0,
	groupId: "g1",
	status: "current",
	style: { fontSize: 48, motion: "Pop" },
};
const clip = {
	id: "caption:1",
	type: "caption",
	startSec: 1,
	durationSec: 2,
	track: 1,
	caption: cue,
};

describe("canonical caption admission", () => {
	test("preserves authored breaks, words, provenance and protection", () => {
		expect(CaptionClipSchema.parse(clip)).toEqual(clip);
	});
	test("requires bounded, ordered cue-local words and matching authored text", () => {
		for (const durationSec of [0, -1, Infinity, NaN])
			expect(CaptionClipSchema.safeParse({ ...clip, durationSec }).success).toBe(false);
		for (const word of [
			{ text: "world!", startSec: 0.2, endSec: 2 },
			{ text: "world!", startSec: 1, endSec: 2.1 },
			{ text: "wrong", startSec: 1, endSec: 2 },
			{ text: "world!", startSec: -1, endSec: 2 },
		]) {
			expect(
				CaptionClipSchema.safeParse({ ...clip, caption: { ...cue, words: [cue.words[0], word] } })
					.success,
			).toBe(false);
		}
	});
	test("rejects invalid style, placement and source intervals", () => {
		for (const patch of [
			{ startSec: -1 },
			{ startSec: Infinity },
			{ track: 0.5 },
			{ track: -1 },
			{ startSec: Number.MAX_VALUE, durationSec: Number.MAX_VALUE },
		])
			expect(CaptionClipSchema.safeParse({ ...clip, ...patch }).success).toBe(false);
		for (const style of [
			{ fontSize: -1 },
			{ motion: "Unknown" },
			{ maxWidth: 101 },
			{ injected: true },
		])
			expect(CaptionClipSchema.safeParse({ ...clip, caption: { ...cue, style } }).success).toBe(
				false,
			);
		expect(
			CaptionClipSchema.safeParse({
				...clip,
				caption: { ...cue, sources: [{ ...cue.sources[0], sourceEndSec: 10 }] },
			}).success,
		).toBe(false);
	});
	test("accepts explicit empty initialized sets and protected deleted ranges", () => {
		const set = {
			initialized: true,
			language: "auto",
			revision: 0,
			appliedRunIds: [],
			deletedRanges: [],
		};
		expect(CaptionSetSchema.parse(set)).toEqual(set);
		expect(CaptionSetSchema.safeParse({ ...set, initialized: false }).success).toBe(false);
		expect(CaptionSetSchema.safeParse({ ...set, revision: 0x100000000 }).success).toBe(false);
		const deleted = { id: "d1", groupId: "g1", startSec: 1, endSec: 3, sources: cue.sources };
		expect(CaptionSetSchema.safeParse({ ...set, deletedRanges: [deleted] }).success).toBe(true);
		expect(
			CaptionSetSchema.safeParse({ ...set, deletedRanges: [{ ...deleted, endSec: 1 }] }).success,
		).toBe(false);
	});
	test("validates current source instances, retaining removed-source evidence only when stale", () => {
		const source: Clip = { id: "video:1", type: "video", startSec: 0, durationSec: 20, track: 0 };
		expect(captionSourceReferencesValid(cue, [source])).toBe(true);
		expect(captionSourceReferencesValid(cue, [])).toBe(false);
		expect(captionSourceReferencesValid(cue, [{ ...source, type: "text" }])).toBe(false);
		expect(captionSourceReferencesValid({ ...cue, status: "needs-refresh" }, [])).toBe(true);
		expect(captionSourceReferencesValid({ ...cue, sources: [] }, [])).toBe(true);
	});
	test("preserves non-whitespace writing and astral characters", () => {
		const text = "你好🌍";
		expect(
			CaptionClipSchema.parse({
				...clip,
				caption: { ...cue, text, words: [{ text, startSec: 0, endSec: 2 }] },
			}).caption.text,
		).toBe(text);
	});
});

test("word text follows JavaScript whitespace rules across bindings", () => {
	expect(
		CaptionClipSchema.safeParse({ ...clip, caption: { ...cue, text: "Hello\uFEFFworld!" } })
			.success,
	).toBe(true);
	expect(
		CaptionClipSchema.safeParse({ ...clip, caption: { ...cue, text: "Hello\u0085world!" } })
			.success,
	).toBe(false);
});
