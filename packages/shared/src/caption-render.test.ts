import { expect, test } from "vite-plus/test";
import {
	buildRenderStoryboardFromDoc,
	captionOutputBlockers,
	renderCaptionClips,
} from "./render-storyboard.ts";
import { DEFAULT_CAPTIONS } from "./caption-config.ts";
import type { Clip } from "./timeline-doc.ts";

const cue: Clip = {
	id: "caption:authored",
	type: "caption",
	startSec: 1.234,
	durationSec: 2.345,
	track: 2,
	caption: {
		text: "Corrected\nwords",
		words: [
			{ text: "Corrected", startSec: 0, endSec: 1 },
			{ text: "words", startSec: 1.2, endSec: 2 },
		],
		provenance: { origin: "imported", wordTimingOrigin: "estimated" },
		sources: [],
		protection: { text: true, timing: true, segmentation: true, style: true },
		revision: 3,
		groupId: "g",
		status: "current",
		style: { fontFamily: "serif", style: "Plain", fill: "#ffff00" },
	},
};
const refs = { images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } };

test("common render projection preserves authored cue identity, times, breaks and style", () => {
	const built = buildRenderStoryboardFromDoc({ format: "9:16", length: "6" }, refs, {
		schemaVersion: 2,
		markers: [],
		clips: [cue],
		captions: DEFAULT_CAPTIONS,
	});
	expect(built.storyboard.captionCues).toEqual([cue]);
	expect(built.storyboard.captions).toEqual(DEFAULT_CAPTIONS);
	expect(built.storyboard.voiceover).toBeUndefined();
	expect(renderCaptionClips([cue], DEFAULT_CAPTIONS, { 2: { muted: true } })).toEqual([cue]);
	expect(renderCaptionClips([cue], DEFAULT_CAPTIONS, { 2: { hidden: true } })).toEqual([]);
	expect(renderCaptionClips([cue], { ...DEFAULT_CAPTIONS, enabled: false })).toEqual([]);
});

test("stale visible output names recovery; disabling cue, track or captions clears blocker", () => {
	const stale = { ...cue, caption: { ...cue.caption!, status: "needs-refresh" as const } };
	expect(captionOutputBlockers([stale], DEFAULT_CAPTIONS)).toEqual([
		expect.stringContaining(
			"Caption caption:authored needs refresh. Refresh captions or disable captions",
		),
	]);
	expect(renderCaptionClips([stale], DEFAULT_CAPTIONS)).toEqual([]);
	expect(captionOutputBlockers([stale], DEFAULT_CAPTIONS, { 2: { hidden: true } })).toEqual([]);
	expect(captionOutputBlockers([stale], { ...DEFAULT_CAPTIONS, enabled: false })).toEqual([]);
	expect(
		captionOutputBlockers(
			[{ ...stale, caption: { ...stale.caption, style: { enabled: false } } }],
			DEFAULT_CAPTIONS,
		),
	).toEqual([]);
});
