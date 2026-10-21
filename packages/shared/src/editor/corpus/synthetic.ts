/* TEST SUPPORT ONLY. The compatibility features no real project in the exported
 * corpus uses yet (`scripts/export-editor-corpus.ts` reports which), in one
 * hand-built scope. It is typed rather than JSON so the compiler checks every
 * shape, and it lives apart from `scopes/` so an export never overwrites it and
 * nothing mistakes it for real data. Remove a feature here once real projects
 * cover it. */
import type { Clip } from "../../timeline-doc.ts";
import { SAMPLE_VIDEO_CLIP, sampleScope } from "../sample-scope.ts";
import type { EditScope } from "../scope.ts";

const video = SAMPLE_VIDEO_CLIP.video!;

/* Retimed (reverse at double speed), composited (blend, mask, colour) and
 * revealed. */
const RETIMED_COMPOSITED: Clip = {
	...SAMPLE_VIDEO_CLIP,
	id: "video:7",
	startSec: 12,
	durationSec: 3,
	video: {
		...video,
		id: 7,
		start: 12,
		dur: 3,
		mediaStartSec: 10,
		layout: {
			...video.layout!,
			playbackRate: 2,
			reverse: true,
			blendMode: "multiply",
			mask: { shape: "ellipse", xPct: 10, yPct: 10, widthPct: 80, heightPct: 80, rotationDeg: 15, featherPct: 5, inverted: false },
			color: { brightness: 1.1, contrast: 0.9, saturation: 1.4 },
		},
		reveal: { type: "wipe", direction: "left", durationSec: 0.5 },
	},
};

/* Keyframed footage: value tracks with every easing (one key carrying a retained
 * easingRange) and colour tracks with both hex endpoints, which mix to rgb(), and
 * a named colour, which falls back to color-mix(). A trim or resize cuts all of
 * them through `retainClipAnimation`. */
const KEYED_VIDEO: Clip = {
	...SAMPLE_VIDEO_CLIP,
	id: "video:8",
	startSec: 16,
	durationSec: 4,
	video: {
		...video,
		id: 8,
		start: 16,
		dur: 4,
		mediaStartSec: 1,
		layout: {
			...video.layout!,
			animation: {
				tracks: {
					opacity: [{ t: 0, v: 0 }, { t: 2, v: 1, easing: "in-out" }, { t: 4, v: 0.5, easing: "bezier", easingRange: [0.2, 0.9] }],
					scale: [{ t: 1, v: 1 }, { t: 3, v: 2, easing: "hold" }],
				},
				colorTracks: {
					fill: [{ t: 0, v: "#000000" }, { t: 4, v: "#fff", easing: "out" }],
					background: [{ t: 0, v: "red" }, { t: 4, v: "rgb(0, 0, 255)" }],
				},
			},
		},
	},
};

/* Keyed source gain on a music bed. */
const KEYED_AUDIO: Clip = {
	id: "audio:9",
	type: "audio",
	startSec: 0,
	durationSec: 6,
	track: 3,
	audio: {
		id: 9, kind: "music", content: "", url: SAMPLE_VIDEO_CLIP.video!.url, mediaAssetId: "asset-video", mediaStartSec: 1, start: 0, dur: 6,
		animation: { tracks: { volume: [{ t: 0, v: 0 }, { t: 3, v: 1, easing: "linear" }, { t: 6, v: 0.2 }] } },
	},
};

/* A scene-local visual promoted to its own clip, keyed. */
const VIS_CLIP: Clip = {
	id: "vis:10",
	type: "video",
	startSec: 20,
	durationSec: 3,
	track: 0,
	vis: {
		sceneId: 11,
		vclip: {
			id: "visual-10", kind: "video", label: "Cutaway", url: SAMPLE_VIDEO_CLIP.video!.url, mediaAssetId: "asset-video", startSec: 0, durationSec: 3, mediaStartSec: 2,
			layout: { xPct: 0, yPct: 0, widthPct: 100, fit: "cover", animation: { tracks: { xPct: [{ t: 0, v: 0 }, { t: 3, v: 20, easing: "in" }] } } },
		},
	},
};

/* A scene drawn from its own image: its keys live on the scene layout. */
const SCENE_IMAGE: Clip = {
	id: "scene:11",
	type: "image",
	startSec: 24,
	durationSec: 4,
	track: -1,
	scene: {
		id: 11, dur: 4, start: 24, name: "Close", shot: "wide", move: "static", vis: "a still", vo: "", img: true,
		layout: { xPct: 0, yPct: 0, widthPct: 100, fit: "cover", animation: { tracks: { scale: [{ t: 0, v: 1 }, { t: 4, v: 1.2, easing: "out" }] } } },
	},
};

export function syntheticCorpusScope(): EditScope {
	const base = sampleScope();
	return {
		...base,
		doc: {
			...base.doc,
			clips: [...base.doc.clips, RETIMED_COMPOSITED, KEYED_VIDEO, KEYED_AUDIO, VIS_CLIP, SCENE_IMAGE],
			chapters: [{ id: "chapter-1", title: "Opening" }, { id: "chapter-2", title: "Proof", brief: "" }],
			markers: [...base.doc.markers, { id: 2, title: "Proof", clipIds: ["video:7"], startSec: 6, endSec: 15 }],
		},
	};
}
