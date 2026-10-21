import { expect, test } from "vite-plus/test";
import { buildRenderStoryboard, buildRenderStoryboardFromDoc } from "./render-storyboard.ts";
import {
	processedAudioSource,
	sourceAudioBlockers,
	type ProcessedAudio,
} from "./processed-audio.ts";
import { toTimelineDoc } from "./timeline-doc.ts";
import { reverseMediaBlockers } from "./reverse-media.ts";
import type { AudioOverlay, ClipLayout, Scene, VideoOverlay } from "./timeline-model.ts";

const url = "/api/media/11111111-1111-4111-8111-111111111111",
	output = "/api/media/22222222-2222-4222-8222-222222222222";
const media: ProcessedAudio = {
	url: output,
	sourceUrl: url,
	sourceRevision: "r1",
	startSec: 1,
	durationSec: 4,
	playbackRate: 0.5,
	preservePitch: true,
	reverse: false,
};
const layout: ClipLayout = {
	xPct: 0,
	yPct: 0,
	widthPct: 100,
	fit: "contain",
	playbackRate: 0.5,
	preservePitch: true,
	audioMedia: media,
};
const video: VideoOverlay = {
	id: 1,
	kind: "video",
	track: 0,
	url,
	start: 2,
	dur: 8,
	mediaStartSec: 1,
	layout,
	volume: 0.75,
};
const audio: AudioOverlay = {
	id: 2,
	kind: "music",
	content: "",
	url,
	start: 12,
	dur: 8,
	mediaStartSec: 1,
	volume: 0.5,
	...layout,
};
const refs = { images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } };
const visual = {
	id: "v1",
	kind: "video" as const,
	url,
	label: "Camera",
	startSec: 0,
	durationSec: 8,
	mediaStartSec: 1,
	primary: true,
	layout,
	volume: 0.6,
};
const scene: Scene = {
	id: 1,
	name: "Scene",
	shot: "Wide",
	move: "Static",
	vis: "",
	vo: "",
	img: true,
	src: url,
	start: 24,
	dur: 8,
	visualClips: [visual],
};

test("shared preview/export separates retimed audio exactly once for free, single and multi visuals", () => {
	const single = buildRenderStoryboard({ format: "16:9" }, refs, [scene], {
		videoOverlays: [video],
		audioOverlays: [audio],
	}).storyboard;
	expect(single.scenes[0]?.visualClips?.[0]).toMatchObject({
		url,
		volume: 0,
		layout: { playbackRate: 0.5 },
	});
	expect(single.videoOverlays?.[0]).toMatchObject({ url, volume: 0, durationSec: 8 });
	expect(single.audioOverlays).toHaveLength(3);
	expect(
		single.audioOverlays?.map((a) => [a.url, a.startSec, a.durationSec, a.volume, a.loopSource]),
	).toEqual([
		[output, 12, 8, 0.5, false],
		[output, 24, 8, 0.6, false],
		[output, 2, 8, 0.75, false],
	]);
	expect(single.audioOverlays?.slice(1).every((a) => a.duckUnderVoice === 1)).toBe(true);
	const multiScene = {
		...scene,
		dur: 16,
		visualClips: [visual, { ...visual, id: "v2", startSec: 8, primary: false }],
	};
	const multi = buildRenderStoryboard({ format: "16:9" }, refs, [multiScene]).storyboard;
	expect(multi.visualTimeline?.map((v) => v.volume)).toEqual([0, 0]);
	expect(multi.audioOverlays?.map((a) => a.startSec)).toEqual([24, 32]);
	const doc = toTimelineDoc([scene], [video], [], [audio]);
	expect(buildRenderStoryboardFromDoc({ format: "16:9" }, refs, doc).storyboard).toEqual(single);
	const reloaded = JSON.parse(JSON.stringify(doc));
	expect(buildRenderStoryboardFromDoc({ format: "16:9" }, refs, reloaded).storyboard).toEqual(
		single,
	);
	expect(video.volume).toBe(0.75);
	expect(visual.volume).toBe(0.6);
});

test("contained trim and reverse sample forward derivative; stale output never falls back", () => {
	expect(processedAudioSource(url, 2, 4, layout)).toEqual({ url: output, mediaStartSec: 2 });
	expect(
		processedAudioSource(url, 2, 2, {
			...layout,
			reverse: true,
			audioMedia: { ...media, reverse: true },
		}),
	).toEqual({ url: output, mediaStartSec: 4 });
	const stale = { ...video, layout: { ...layout, preservePitch: false } };
	expect(sourceAudioBlockers({ videoOverlays: [stale] })).toHaveLength(1);
	const rendered = buildRenderStoryboard({}, refs, [], { videoOverlays: [stale] }).storyboard;
	expect(rendered.videoOverlays?.[0]?.volume).toBe(0);
	expect(rendered.audioOverlays).toEqual([]);
	expect(
		sourceAudioBlockers({ audioOverlays: [{ ...audio, audioMedia: undefined }] }),
	).toHaveLength(1);
	expect(sourceAudioBlockers({ videoOverlays: [video], audioOverlays: [audio] })).toEqual([]);
	expect(
		sourceAudioBlockers({ videoOverlays: [stale] }, [{ url, metadata: { hasAudio: false } }]),
	).toEqual([]);
});

test("track mute and measured silence retain gain data; legacy rates keep old playback", () => {
	const muted = buildRenderStoryboardFromDoc({}, refs, toTimelineDoc([scene], [video]), {
		trackFlags: { [-1]: { muted: true }, 0: { muted: true } },
	}).storyboard;
	expect(muted.audioOverlays).toEqual([]);
	expect(muted.scenes[0]?.visualClips?.[0]?.volume).toBe(0);
	expect(muted.videoOverlays?.[0]?.volume).toBe(0);
	const silent = buildRenderStoryboard({}, refs, [scene], {
		videoOverlays: [video],
		mediaAssets: [{ url, metadata: { hasAudio: false } }],
	}).storyboard;
	expect(silent.audioOverlays).toEqual([]);
	expect(silent.videoOverlays?.[0]?.volume).toBe(0.75);
	const legacy = {
		...video,
		layout: { ...layout, preservePitch: undefined, audioMedia: undefined },
	};
	expect(
		buildRenderStoryboard({}, refs, [], { videoOverlays: [legacy] }).storyboard.videoOverlays?.[0]
			?.volume,
	).toBe(0.75);
	expect(sourceAudioBlockers({ videoOverlays: [legacy] })).toEqual([]);
});

test("narration growth holds scene plate without extending authored source audio interval", () => {
	const extended = { ...scene, dur: 10, vo: "Longer narration" };
	expect(sourceAudioBlockers({ scenes: [extended] })).toEqual([]);
	const rendered = buildRenderStoryboard({}, refs, [extended]).storyboard;
	expect(rendered.scenes[0]?.durationSec).toBe(10);
	expect(rendered.scenes[0]?.visualClips?.[0]?.sourceDurationSec).toBe(8);
	expect(rendered.audioOverlays?.[0]).toMatchObject({ url: output, startSec: 24, durationSec: 8 });
	const reversed = {
		...extended,
		visualClips: [
			{
				...visual,
				layout: {
					...layout,
					reverse: true,
					audioMedia: { ...media, reverse: true },
					reverseMedia: {
						url: output,
						sourceUrl: url,
						sourceRevision: "r1",
						startSec: 1,
						durationSec: 4,
					},
				},
			},
		],
	};
	expect(reverseMediaBlockers({ scenes: [reversed] })).toEqual([]);
	expect(sourceAudioBlockers({ scenes: [reversed] })).toEqual([]);
	const multi = {
		...scene,
		id: 2,
		visualClips: [visual, { ...visual, id: "v2", startSec: 8, primary: false }],
		dur: 16,
	};
	const projected = buildRenderStoryboard({}, refs, [reversed, multi]).storyboard;
	expect(projected.visualTimeline?.[0]).toMatchObject({
		url: output,
		durationSec: 10,
		sourceDurationSec: 8,
		layout: { reverse: false },
	});
	expect(
		buildRenderStoryboardFromDoc(
			{},
			refs,
			JSON.parse(JSON.stringify(toTimelineDoc([reversed, multi]))),
		).storyboard,
	).toEqual(projected);
});
