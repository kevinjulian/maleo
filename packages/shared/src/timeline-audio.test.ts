import { expect, test } from "vite-plus/test";
import { timelineAudioSources } from "./timeline-audio.ts";
import { timelineAudioGain } from "./audio-gain.ts";
import { buildRenderStoryboardFromDoc } from "./render-storyboard.ts";
import type { TimelineDoc } from "./timeline-doc.ts";

const refs = { images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } };
const doc: TimelineDoc = {
	schemaVersion: 2,
	markers: [],
	clips: [
		{
			id: "audio:1",
			type: "audio",
			startSec: 3,
			durationSec: 4,
			track: 1,
			audio: {
				id: 1,
				kind: "voiceover",
				content: "Speech",
				url: "/api/media/voice",
				start: 3,
				dur: 4,
				volume: 0.5,
				fadeIn: 1,
				fadeOut: 1,
			},
		},
		{
			id: "video:1",
			type: "video",
			startSec: 2,
			durationSec: 3,
			track: 0,
			video: { id: 1, kind: "video", url: "/api/media/video", start: 2, dur: 3, volume: 0.7 },
		},
	],
};

test("recognition and render keep explicit source placement, gain and mute", () => {
	expect(timelineAudioSources(doc)).toMatchObject([
		{ clipId: "audio:1", startSec: 3, durationSec: 4, volume: 0.5, fadeInSec: 1 },
		{ clipId: "video:1", startSec: 2, durationSec: 3, volume: 0.7, duckUnderVoice: 1 },
	]);
	const render = buildRenderStoryboardFromDoc(
		{ format: "9:16", length: "8" },
		refs,
		doc,
	).storyboard;
	expect(render.audioOverlays?.[0]).toMatchObject({
		startSec: 3,
		durationSec: 4,
		volume: 0.5,
		fadeInSec: 1,
	});
	expect(render.videoOverlays?.[0]?.volume).toBe(0.7);
	expect(timelineAudioSources(doc, { 0: { muted: true }, 1: { hidden: true } })).toEqual([]);
});

test("extracted native audio never doubles its linked audio overlay; scene video retains its identity", () => {
	const extracted = structuredClone(doc);
	extracted.clips[1]!.video!.layout = {
		xPct: 0,
		yPct: 0,
		widthPct: 100,
		heightPct: 100,
		fit: "cover",
		sourceAudioExtraction: {
			audioClipId: "audio:1",
			priorVolume: 0.7,
			source: {
				url: "/api/media/video",
				startSec: 0,
				durationSec: 3,
				playbackRate: 1,
				preservePitch: false,
				reverse: false,
			},
			audioSnapshot: doc.clips[0]!.audio!,
		},
	};
	expect(timelineAudioSources(extracted).map((source) => source.clipId)).toEqual(["audio:1"]);
	const scene: TimelineDoc = {
		schemaVersion: 2,
		markers: [],
		clips: [
			{
				id: "scene:1",
				type: "image",
				startSec: 4,
				durationSec: 5,
				track: 0,
				scene: {
					id: 1,
					dur: 5,
					name: "Source",
					shot: "",
					move: "",
					vis: "",
					vo: "",
					img: true,
					visualClips: [
						{
							id: "visual:1",
							kind: "video",
							url: "/api/media/video",
							label: "Footage",
							startSec: 0,
							durationSec: 3,
							mediaStartSec: 2,
						},
					],
				},
			},
		],
	};
	expect(timelineAudioSources(scene)).toMatchObject([
		{
			clipId: "scene:1",
			visualId: "visual:1",
			startSec: 4,
			durationSec: 5,
			mediaStartSec: 2,
			volume: 1,
		},
	]);
	expect(timelineAudioSources(scene, { [-1]: { muted: true } })).toEqual([]);
});

test("shared production gain retains edge fades, ambient baseline and dialogue duck depth", () => {
	const clip = {
		kind: "music" as const,
		startSec: 0,
		durationSec: 5,
		volume: 0.5,
		fadeInSec: 1,
		fadeOutSec: 1,
	};
	const ranges = [{ startSec: 1, endSec: 4 }];
	expect(timelineAudioGain(clip, 0, 30, ranges)).toBe(0);
	expect(timelineAudioGain(clip, 60, 30, ranges)).toBeCloseTo(0.175);
	expect(timelineAudioGain({ ...clip, duckUnderVoice: 1 }, 60, 30, ranges)).toBe(0.5);
	expect(timelineAudioGain({ ...clip, kind: "ambient", duckUnderVoice: 1 }, 60, 30, ranges)).toBe(
		0.16,
	);
	expect(timelineAudioGain({ ...clip, kind: "voiceover" }, 135, 30, ranges)).toBe(0.25);
});
