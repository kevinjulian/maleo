/* TEST SUPPORT ONLY. A representative editing scope: one of every family the
 * vocabulary touches (clips with source timing, markers, bookmarks, captions,
 * track flags, slides, posts, an imported media asset with metadata), so a
 * round-trip or a fixture exercises real shapes rather than empty arrays. */
import { DEFAULT_CAPTIONS } from "../caption-config.ts";
import type { Clip, SceneMarker } from "../timeline-doc.ts";
import type { EditScope, MediaAsset } from "./scope.ts";

export const SAMPLE_ASSET: MediaAsset = {
	id: "asset-video",
	label: "Source clip",
	url: "/api/media/00000000-0000-4000-8000-000000000001",
	kind: "video",
	source: "upload",
	dur: 20,
	metadata: { kind: "video", originalFilename: "source.mp4", byteSize: 4096, duration: 20 },
};

export const SAMPLE_VIDEO_CLIP: Clip = {
	id: "video:1",
	type: "video",
	startSec: 2,
	durationSec: 4,
	track: 0,
	video: {
		id: 1,
		mediaAssetId: SAMPLE_ASSET.id,
		kind: "video",
		url: SAMPLE_ASSET.url,
		start: 2,
		dur: 4,
		mediaStartSec: 3,
		layout: { xPct: 0, yPct: 0, widthPct: 100, fit: "contain", playbackRate: 1 },
	},
};

export const SAMPLE_TEXT_CLIP: Clip = {
	id: "text:2",
	type: "text",
	startSec: 8,
	durationSec: 2,
	track: 1,
};

export const SAMPLE_MARKER: SceneMarker = {
	id: 1,
	title: "Hook",
	clipIds: ["video:1"],
	startSec: 0,
	endSec: 6,
};

export function sampleScope(): EditScope {
	return {
		mediaAssets: [SAMPLE_ASSET],
		doc: {
			schemaVersion: 2,
			clips: [SAMPLE_VIDEO_CLIP, SAMPLE_TEXT_CLIP],
			markers: [SAMPLE_MARKER],
			bookmarks: [{ id: "bm-1", label: "Beat", timeSec: 3 }],
			captions: DEFAULT_CAPTIONS,
			trackFlags: { 1: { hidden: true } },
		},
		slides: [{ key: "slide-a", id: 1, cap: "First", vis: "a product shot", img: false }],
		posts: [{ key: "post-a", id: 1, body: "Hello", img: false }],
	};
}
