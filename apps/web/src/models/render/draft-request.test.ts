import { describe, expect, test } from "vite-plus/test";
import type { Clip, TrackFlags, AudioOverlay, Scene } from "@maleo/shared";
import { DEFAULT_CAPTIONS } from "@maleo/shared";
import { buildDraftRequest, hasRenderableVisual, timelineTotalSec } from "./draft-request.ts";

const clip = (over: Partial<Clip> & { id: string }): Clip => ({
	type: "image",
	startSec: 0,
	durationSec: 2,
	track: 0,
	...over,
});
const scene = (id: number, over: Partial<Scene> = {}): Scene =>
	({
		id,
		dur: 3,
		name: `S${id}`,
		shot: "Medium Shot",
		move: "Static",
		vis: "v",
		vo: "",
		img: false,
		...over,
	}) as Scene;
const audio = (over: Partial<AudioOverlay> = {}): AudioOverlay =>
	({ id: 1, url: "a.mp3", start: 0, dur: 2, track: 5, ...over }) as AudioOverlay;
/** A voiceover clip on the document, which is where the draft reads narration. */
const voClip = (track: number): Clip =>
	clip({
		id: `vo:${track}`,
		type: "audio",
		track,
		audio: {
			id: 1,
			kind: "voiceover",
			content: "hello there",
			start: 0,
			dur: 2,
			url: "",
			words: [],
		} as AudioOverlay,
	});

const input = (
	over: Partial<Parameters<typeof buildDraftRequest>[0]> = {},
): Parameters<typeof buildDraftRequest>[0] => ({
	clips: [],
	scenes: [],
	audioOverlays: [],
	captions: DEFAULT_CAPTIONS,
	trackFlags: {},
	sceneStart: () => 0,
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
		expect(hasRenderableVisual([clip({ id: "i", type: "infographic" })])).toBe(true);
		expect(hasRenderableVisual([clip({ id: "s", type: "audio" })])).toBe(false);
		expect(hasRenderableVisual([])).toBe(false);
	});
});

describe("buildDraftRequest", () => {
	test("maps scenes and audio through, using the document's scene starts", () => {
		const req = buildDraftRequest(
			input({
				scenes: [scene(1, { src: "a.png", dur: 3, move: "Zoom In" })],
				audioOverlays: [audio({ url: "music.mp3", start: 2, dur: 5 })],
				sceneStart: (id) => id * 10,
			}),
		);
		expect(req.scenes).toEqual([{ src: "a.png", start: 10, dur: 3, move: "Zoom In" }]);
		expect(req.audio[0]?.url).toBe("music.mp3");
		expect(req.audio[0]?.start).toBe(2);
	});

	/* The rule this module exists to keep in one place: what a hidden track drops
	 * from the draft must match what it drops from the server render. */
	test("a hidden base track drops every scene", () => {
		const flags: TrackFlags = { "-1": { hidden: true } };
		const req = buildDraftRequest(input({ scenes: [scene(1), scene(2)], trackFlags: flags }));
		expect(req.scenes).toEqual([]);
	});

	test("a muted track drops its audio", () => {
		const flags: TrackFlags = { 5: { muted: true } };
		const req = buildDraftRequest(
			input({
				audioOverlays: [audio({ track: 5 }), audio({ id: 2, track: 6, url: "keep.mp3" })],
				trackFlags: flags,
			}),
		);
		expect(req.audio.map((a) => a.url)).toEqual(["keep.mp3"]);
	});

	test("caption output reads canonical cues and never voiceover words", () => {
		const vo = voClip(4);
		expect(buildDraftRequest(input({ clips: [vo] })).captionCues).toEqual([]);
		const cue: Clip = {
			id: "caption:1",
			type: "caption",
			startSec: 0,
			durationSec: 2,
			track: 1,
			caption: {
				text: "Authored\ncaption",
				words: [],
				sources: [],
				provenance: { origin: "manual", wordTimingOrigin: "estimated" },
				protection: { text: false, timing: false, segmentation: false, style: false },
				revision: 0,
				groupId: "g1",
				status: "current",
			},
		};
		expect(buildDraftRequest(input({ clips: [vo, cue] })).captionCues).toEqual([cue]);
		expect(
			buildDraftRequest(input({ clips: [cue], trackFlags: { 1: { hidden: true } } })).captionCues,
		).toEqual([]);
		expect(() =>
			buildDraftRequest(
				input({ clips: [{ ...cue, caption: { ...cue.caption!, status: "needs-refresh" } }] }),
			),
		).toThrow("Refresh captions");
	});

	test("captions off emits no words at all", () => {
		const vo = voClip(4);
		const req = buildDraftRequest(
			input({ clips: [vo], captions: { ...DEFAULT_CAPTIONS, enabled: false } }),
		);
		expect(req.captionCues).toEqual([]);
	});
});
