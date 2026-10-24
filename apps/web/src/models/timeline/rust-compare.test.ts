import { describe, expect, test } from "vite-plus/test";
import { compareModeRequested, storyboardImageUrls } from "./rust-compare.ts";

describe("compare mode", () => {
	test("opens only for renderer=compare", () => {
		expect(compareModeRequested("?renderer=compare")).toBe(true);
		expect(compareModeRequested("?x=1&renderer=compare")).toBe(true);
		expect(compareModeRequested("")).toBe(false);
		expect(compareModeRequested("?renderer=rust")).toBe(false);
	});

	test("collects each drawn image once and skips video", () => {
		expect(
			storyboardImageUrls({
				scenes: [
					{ image: "/a.png", visualClips: [{ url: "/a.png" }, { url: "/v.mp4", kind: "video" }] },
					{ image: "" },
				],
				visualTimeline: [{ url: "/b.png", kind: "image" }],
				videoOverlays: [{ url: "/c.png" }, { url: "/v.mp4", kind: "video" }],
			}),
		).toEqual(["/a.png", "/b.png", "/c.png"]);
	});
});
