import { expect, test } from "vite-plus/test";
import type { VideoOverlay } from "@maleo/shared";
import { readStoryboardDocument } from "@maleo/shared";
import { createPlayheadHandle } from "@models/timeline/playhead-handle.ts";
import { useVideoOverlayOps } from "./use-video-overlay-ops.ts";

function fixture() {
	let clips: VideoOverlay[] = [];
	const ops = () =>
		useVideoOverlayOps({
			mediaAssets: [
				{
					id: "generated",
					label: "Video",
					url: "/api/media/video",
					kind: "video",
					source: "generated",
					dur: 4,
					thumb: "/api/media/poster",
				},
			],
			videoOverlays: clips,
			setVideoOverlays: (next) => {
				clips = typeof next === "function" ? next(clips) : next;
			},
			selectedVideoOvId: null,
			setSelectedVideoOvId() {},
			playhead: createPlayheadHandle(0),
			total: 7,
			setEditorSceneId() {},
			setSelectedOverlayId() {},
			setSelectedAudioId() {},
		});
	return { ops, clips: () => clips };
}

test("generated clip inherits poster and measured duration; numeric edits cannot extend it", () => {
	const f = fixture();
	f.ops().addVideoOverlay({
		url: "/api/media/video",
		kind: "video",
		mediaAssetId: "generated",
		dur: 7,
	});
	expect(f.clips()[0]).toMatchObject({ thumb: "/api/media/poster", sourceDurationSec: 4, dur: 4 });
	const id = f.clips()[0]!.id;
	f.ops().updateVideoOverlay(id, { dur: 2 });
	expect(f.clips()[0]?.dur).toBe(2);
	f.ops().updateVideoOverlay(id, { dur: 7 });
	expect(f.clips()[0]?.dur).toBe(4);
});

test("saved oversized generated clip reloads within source bounds with poster intact", () => {
	const read = readStoryboardDocument({
		schemaVersion: 2,
		markers: [],
		clips: [
			{
				id: "video:1",
				type: "video",
				track: 0,
				startSec: 2,
				durationSec: 7,
				video: {
					id: 1,
					kind: "video",
					url: "/api/media/video",
					thumb: "/api/media/poster",
					start: 2,
					dur: 7,
					sourceDurationSec: 4,
				},
			},
		],
	});
	expect(read.doc.clips[0]).toMatchObject({
		startSec: 2,
		durationSec: 4,
		video: { dur: 4, thumb: "/api/media/poster", sourceDurationSec: 4 },
	});
});
