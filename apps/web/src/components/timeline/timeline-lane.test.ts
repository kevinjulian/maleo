// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";
import { mediaClipThumb } from "./timeline-lane.tsx";

const clip = { media: "video" as const, url: "/api/media/video", thumb: "/api/media/input-image" };
test("generated clip uses server poster", () => {
	expect(
		mediaClipThumb(clip, { source: "generated", thumb: clip.thumb, poster: "/api/media/poster" }),
	).toBe("/api/media/poster");
});
test("older generated video falls back to live first frame", () => {
	expect(mediaClipThumb({ ...clip, thumb: undefined }, { source: "generated" })).toBeUndefined();
});
test("agent clip never uses input scene image as thumbnail", () => {
	expect(mediaClipThumb(clip, { source: "generated", thumb: clip.thumb })).toBeUndefined();
});
test("uploaded video retains its admitted thumbnail", () => {
	expect(
		mediaClipThumb(
			{ ...clip, thumb: undefined },
			{ source: "upload", thumb: "/api/media/upload-thumb" },
		),
	).toBe("/api/media/upload-thumb");
});
