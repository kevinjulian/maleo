import { expect, test } from "vite-plus/test";
import { projectFeedPreview } from "./project-feed.ts";

test("project preview reads authored span, trailing audio and image without transition inflation", () => {
	const raw = {
		schemaVersion: 2,
		clips: [
			{
				id: "v",
				type: "image",
				startSec: 2,
				durationSec: 4,
				track: 0,
				video: { kind: "image", url: "/api/media/image" },
			},
			{ id: "a", type: "audio", startSec: 5, durationSec: 7, track: 1 },
			{ id: "t", type: "transition", startSec: 0, durationSec: 40, track: 0 },
		],
	};
	expect(projectFeedPreview(raw, "video")).toEqual({
		thumbnail_url: "/api/media/image",
		duration_sec: 12,
	});
	expect(projectFeedPreview({ ...raw, clips: [] }, "video").duration_sec).toBeNull();
	expect(
		projectFeedPreview({ ...raw, clips: [...raw.clips, {}] }, "video").duration_sec,
	).toBeNull();
	expect(projectFeedPreview(undefined, "video")).toEqual({
		thumbnail_url: null,
		duration_sec: null,
	});
	expect(projectFeedPreview({ slides: [{ image: "/api/media/slide" }] }, "image")).toEqual({
		thumbnail_url: "/api/media/slide",
		duration_sec: null,
	});
	expect(projectFeedPreview(raw, "text")).toEqual({ thumbnail_url: null, duration_sec: null });
});
