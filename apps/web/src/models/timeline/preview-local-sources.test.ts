import { expect, test } from "vite-plus/test";
import { buildRenderStoryboardFromDoc, toTimelineDoc, type VideoOverlay } from "@maleo/shared";
import { withPreviewLocalSources } from "./preview-local-sources.ts";
import { storyboardImageUrls } from "./rust-compare.ts";
import { STUDIO_BLANK_PIXEL } from "./studio-base-storyboard.ts";

test("local substitution preserves authored/export sources, geometry and URL-like text", () => {
	const url = "https://example.invalid/video.mp4";
	const video: VideoOverlay = {
		id: 1,
		kind: "video",
		url,
		track: 0,
		start: 0,
		dur: 4,
		layout: { xPct: 30, yPct: 40, widthPct: 70, fit: "cover" },
	};
	const doc = toTimelineDoc([], [video]);
	const refs = { images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } };
	const built = buildRenderStoryboardFromDoc({ format: "16:9" }, refs, doc).storyboard;
	built.textOverlays = [{ content: url, startSec: 0, durationSec: 4 }];
	const original = JSON.stringify(built);
	const preview = withPreviewLocalSources(built, (source) =>
		source === url ? "blob:local" : undefined,
	);
	expect(preview.videoOverlays?.[0]).toEqual({
		...built.videoOverlays?.[0],
		url: "blob:local",
		thumb: undefined,
	});
	expect(preview.textOverlays?.[0]?.content).toBe(url);
	const imageStoryboard = {
		...built,
		videoOverlays: built.videoOverlays?.map((value) => ({ ...value, kind: "image" as const })),
	};
	expect(
		storyboardImageUrls(withPreviewLocalSources(imageStoryboard, () => "blob:local-image")),
	).toEqual(["blob:local-image"]);
	const waiting = withPreviewLocalSources(built, () => undefined);
	expect(waiting.videoOverlays?.[0]).toMatchObject({
		url: STUDIO_BLANK_PIXEL,
		kind: "image",
		startSec: 0,
		durationSec: 4,
	});
	expect(JSON.stringify(built)).toBe(original);
	expect(doc.clips[0]?.video?.url).toBe(url);
	expect(
		buildRenderStoryboardFromDoc({ format: "16:9" }, refs, doc).storyboard.videoOverlays?.[0]?.url,
	).toBe(url);
});
