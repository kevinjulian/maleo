import { describe, expect, test } from "vite-plus/test";
import { compareModeRequested, storyboardImageUrls, storyboardMediaUrls } from "./rust-compare.ts";

describe("compare mode", () => {
	test("borrows overlay and legacy sound once without treating audio as images", () => {
		const story = {
			scenes: [{ image: "/image.png", sfxUrl: "/effect.wav", audioClips: [{ url: "/music.wav" }] }],
			voiceover: { audioUrl: "/voice.wav" },
			musicUrl: "/music.wav",
			audioOverlays: [{ url: "/overlay.wav" }],
		};
		expect(storyboardImageUrls(story)).toEqual(["/image.png"]);
		expect(storyboardMediaUrls(story)).toEqual([
			"/image.png",
			"/voice.wav",
			"/music.wav",
			"/overlay.wav",
			"/effect.wav",
		]);
	});
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
