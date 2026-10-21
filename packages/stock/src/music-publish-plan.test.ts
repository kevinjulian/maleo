import { describe, expect, it } from "vite-plus/test";
import { planPublish, type PlannablePrepared, type PublishedBed } from "./music-publish-plan.ts";

const prep = (
	source: string,
	sha256?: string,
	file = `music-${sha256 ?? "x"}.mp3`,
): PlannablePrepared => ({ id: source, file, source, sha256 });

const pub = (
	source: string,
	sha256?: string,
	url = `https://files.test/music/music-${sha256 ?? "x"}.mp3`,
): PublishedBed => ({ url, source, sha256 });

describe("planning a publish against what is already there", () => {
	it("treats an unpublished track as new", () => {
		const plan = planPublish([prep("https://pixabay.test/a", "h1")], []);
		expect(plan.added).toHaveLength(1);
		expect(plan.unchanged).toHaveLength(0);
	});

	it("skips a track whose bytes are unchanged, reusing its published url", () => {
		const plan = planPublish(
			[prep("https://pixabay.test/a", "h1")],
			[pub("https://pixabay.test/a", "h1")],
		);
		expect(plan.unchanged).toHaveLength(1);
		expect(plan.unchanged[0]!.url).toBe("https://files.test/music/music-h1.mp3");
		expect(plan.added).toHaveLength(0);
	});

	it("re-uploads when the same track was re-normalised", () => {
		// The whole reason source is the identity: a new hash means a new filename,
		// which a filename-based check would read as "never published".
		const plan = planPublish(
			[prep("https://pixabay.test/a", "h2")],
			[pub("https://pixabay.test/a", "h1")],
		);
		expect(plan.replaced).toHaveLength(1);
		expect(plan.added).toHaveLength(0);
		expect(plan.orphaned).toEqual(["https://files.test/music/music-h1.mp3"]);
	});

	it("ignores a trailing slash or case difference in the source", () => {
		const plan = planPublish(
			[prep("https://Pixabay.test/A/", "h1")],
			[pub("https://pixabay.test/a", "h1")],
		);
		expect(plan.unchanged).toHaveLength(1);
	});

	it("re-uploads when the published entry has no hash to compare", () => {
		// An older manifest cannot prove its bytes are current, so it is replaced
		// rather than trusted.
		const plan = planPublish(
			[prep("https://pixabay.test/a", "h1")],
			[pub("https://pixabay.test/a", undefined)],
		);
		expect(plan.replaced).toHaveLength(1);
	});

	it("reports a published bed that is no longer in the source folder", () => {
		const plan = planPublish([], [pub("https://pixabay.test/gone", "h1")]);
		expect(plan.orphaned).toEqual(["https://files.test/music/music-h1.mp3"]);
		expect(plan.added).toHaveLength(0);
	});

	it("handles a mixed set in one pass", () => {
		const plan = planPublish(
			[
				prep("https://pixabay.test/keep", "same"),
				prep("https://pixabay.test/changed", "new"),
				prep("https://pixabay.test/fresh", "fresh"),
			],
			[
				pub("https://pixabay.test/keep", "same"),
				pub("https://pixabay.test/changed", "old"),
				pub("https://pixabay.test/removed", "gone"),
			],
		);
		expect(plan.unchanged.map((u) => u.track.source)).toEqual(["https://pixabay.test/keep"]);
		expect(plan.replaced.map((r) => r.track.source)).toEqual(["https://pixabay.test/changed"]);
		expect(plan.added.map((a) => a.source)).toEqual(["https://pixabay.test/fresh"]);
		// Both the superseded file and the removed one.
		expect(plan.orphaned).toHaveLength(2);
	});

	it("publishes everything on a first run", () => {
		const plan = planPublish([prep("https://a", "1"), prep("https://b", "2")], []);
		expect(plan.added).toHaveLength(2);
		expect(plan.orphaned).toHaveLength(0);
	});
});
