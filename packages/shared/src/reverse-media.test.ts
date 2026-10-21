import { expect, test } from "vite-plus/test";
import {
	reverseMediaBlockers,
	reverseMediaSchema,
	reversePlaybackSource,
} from "./reverse-media.ts";
import { buildRenderStoryboard } from "./render-storyboard.ts";
import { retainClipWindow } from "./source-interval.ts";
import { toTimelineDoc, fromTimelineDoc } from "./timeline-doc.ts";
import type { ClipLayout, Scene, VideoOverlay } from "./timeline-model.ts";
import { readStoryboardDocument } from "./storyboard-document.ts";

const source = "/api/media/11111111-1111-4111-8111-111111111111";
const output = "/api/media/22222222-2222-4222-8222-222222222222";
const layout: ClipLayout = {
	xPct: 0,
	yPct: 0,
	widthPct: 100,
	fit: "contain",
	reverse: true,
	playbackRate: 2,
	reverseMedia: {
		url: output,
		sourceUrl: source,
		sourceRevision: "revision",
		startSec: 1,
		durationSec: 4,
	},
};
const video: VideoOverlay = {
	id: 1,
	kind: "video",
	url: source,
	start: 2,
	dur: 2,
	mediaStartSec: 1,
	layout,
	volume: 0.75,
};
const refs = { images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } };

test("reverse derivative maps trims and rates without changing original identity or source interval", () => {
	expect(reversePlaybackSource(source, 1, 2, layout)).toEqual({ url: output, mediaStartSec: 0 });
	expect(reversePlaybackSource(source, 2, 1, layout)).toEqual({ url: output, mediaStartSec: 1 });
	for (const [url, start, dur] of [
		[output, 1, 2],
		[source, 0, 2],
		[source, 1, 3],
	] as const)
		expect(reversePlaybackSource(url, start, dur, layout)).toBeUndefined();
	expect(
		reverseMediaSchema.safeParse({ ...layout.reverseMedia, url: "blob:temporary" }).success,
	).toBe(false);
	expect(
		reverseMediaSchema.safeParse({ ...layout.reverseMedia, durationSec: Infinity }).success,
	).toBe(false);
	const doc = toTimelineDoc([], [video]);
	const clip = doc.clips[0]!;
	const trimmed = retainClipWindow(clip, 0.5, 1.5);
	const retained = fromTimelineDoc({ ...doc, clips: [trimmed] }).videoOverlays[0]!;
	expect(retained.url).toBe(source);
	expect(retained.mediaStartSec).toBe(2);
	expect(
		reversePlaybackSource(retained.url, retained.mediaStartSec!, retained.dur, retained.layout),
	).toEqual({ url: output, mediaStartSec: 1 });
	expect(
		readStoryboardDocument(JSON.parse(JSON.stringify(doc))).doc.clips[0]?.video?.layout
			?.reverseMedia,
	).toEqual(layout.reverseMedia);
});

test("common preview/export projection uses derivative for overlays, single scenes and multi-visual scenes", () => {
	const visual = {
		id: "v1",
		kind: "video" as const,
		url: source,
		label: "Reverse",
		startSec: 0,
		durationSec: 2,
		mediaStartSec: 1,
		primary: true,
		layout,
	};
	const scene: Scene = {
		id: 1,
		name: "Scene",
		shot: "Wide",
		move: "Static",
		vis: "",
		vo: "",
		img: true,
		src: source,
		dur: 2,
		visualClips: [visual],
	};
	const single = buildRenderStoryboard({ format: "16:9" }, refs, [scene], {
		videoOverlays: [video],
	}).storyboard;
	expect(single.scenes[0]?.visualClips?.[0]).toMatchObject({
		url: output,
		mediaStartSec: 0,
		layout: { reverse: false, playbackRate: 2 },
	});
	expect(single.videoOverlays?.[0]).toMatchObject({
		url: output,
		mediaStartSec: 0,
		volume: 0.75,
		durationSec: 2,
		startSec: 2,
	});
	const multi = buildRenderStoryboard({ format: "16:9" }, refs, [
		{
			...scene,
			dur: 4,
			visualClips: [visual, { ...visual, id: "v2", startSec: 2, primary: false }],
		},
	]).storyboard;
	expect(multi.visualTimeline?.map((v) => v.url)).toEqual([output, output]);
	expect(reverseMediaBlockers(single)).toEqual([]);
	expect(
		reverseMediaBlockers({
			videoOverlays: [{ ...video, layout: { ...layout, reverseMedia: undefined } }],
		}),
	).toHaveLength(1);
	expect(
		reverseMediaBlockers({
			scenes: [
				{ dur: 2, layout, visualClips: [{ ...visual, layout: undefined, mediaStartSec: 0 }] },
			],
		}),
	).toHaveLength(1);
	expect(video.url).toBe(source);
	expect(video.layout?.reverse).toBe(true);
});
