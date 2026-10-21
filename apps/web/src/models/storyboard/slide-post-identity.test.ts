/* Slides and posts keep their identity.
 *
 * Before stable keys, a slide was identified by its array position at every
 * boundary: read assigned `id: index + 1`, write emitted `key: slide_${i + 1}`.
 * Reorder two slides and both names now point at the other one's content — which
 * is fatal for per-entity fencing, because a settled result declaring "I changed
 * slide_2" would be applied to whichever slide currently sits second.
 *
 * These tests pin the property that replaced it: a key names a slide, not a
 * position, and it survives reorder, save, reload, and generation. */
import { describe, expect, test } from "vite-plus/test";
import {
	readStoryboardSlides,
	readStoryboardPosts,
	repairEntityKeys,
	SLIDE_KEY_PREFIX,
	POST_KEY_PREFIX,
} from "@maleo/shared";
import { storyboardJson } from "./document-wire.ts";
import type { Post, Slide } from "@models/content/content-types.ts";

function slide(key: string, cap: string, id = 1): Slide {
	return { key, id, cap, vis: "v", img: false };
}
function post(key: string, body: string, id = 1): Post {
	return { key, id, body, img: false };
}

/** Save then reload, the way the editor actually round-trips a document. */
function roundTripSlides(slides: Slide[]): Array<{ key: string; caption: string }> {
	const written = storyboardJson("image", { slides });
	return readStoryboardSlides(written).map((s) => ({ key: s.key, caption: s.caption }));
}

describe("slide identity survives save and reload", () => {
	test("keys round-trip unchanged", () => {
		const slides = [slide("slide_aaa", "one", 1), slide("slide_bbb", "two", 2)];
		expect(roundTripSlides(slides)).toEqual([
			{ key: "slide_aaa", caption: "one" },
			{ key: "slide_bbb", caption: "two" },
		]);
	});

	test("a key follows its content through a reorder, it does not follow position", () => {
		const slides = [slide("slide_aaa", "one", 1), slide("slide_bbb", "two", 2)];
		const reordered = [slides[1]!, slides[0]!];

		const after = roundTripSlides(reordered);

		// The key that named "two" still names "two" after it moved to position 1.
		expect(after).toEqual([
			{ key: "slide_bbb", caption: "two" },
			{ key: "slide_aaa", caption: "one" },
		]);
		// The old positional scheme would have produced slide_1 -> "two" here.
		expect(after[0]?.key).not.toBe("slide_1");
	});

	test("deleting a slide does not renumber the survivors", () => {
		const slides = [
			slide("slide_aaa", "one", 1),
			slide("slide_bbb", "two", 2),
			slide("slide_ccc", "three", 3),
		];
		const after = roundTripSlides([slides[0]!, slides[2]!]);
		expect(after.map((s) => s.key)).toEqual(["slide_aaa", "slide_ccc"]);
	});

	test("editing a caption leaves the key alone", () => {
		const after = roundTripSlides([{ ...slide("slide_aaa", "one"), cap: "edited" }]);
		expect(after).toEqual([{ key: "slide_aaa", caption: "edited" }]);
	});
});

describe("post identity survives save and reload", () => {
	test("keys round-trip and survive reorder", () => {
		const posts = [post("post_aaa", "first", 1), post("post_bbb", "second", 2)];
		const written = storyboardJson("text", { posts: [posts[1]!, posts[0]!] });
		expect(readStoryboardPosts(written).map((p) => ({ key: p.key, body: p.body }))).toEqual([
			{ key: "post_bbb", body: "second" },
			{ key: "post_aaa", body: "first" },
		]);
	});
});

describe("legacy documents are repaired at the load boundary", () => {
	test("a key-less legacy document gets stable keys", () => {
		const legacy = {
			slides: [
				{ caption: "one", visual: "" },
				{ caption: "two", visual: "" },
			],
		};
		const repaired = repairEntityKeys(readStoryboardSlides(legacy), SLIDE_KEY_PREFIX);
		expect(repaired.every((s) => s.key.length > 0)).toBe(true);
		expect(new Set(repaired.map((s) => s.key)).size).toBe(2);
	});

	test("a document written by the old positional scheme keeps its first holder and de-duplicates", () => {
		// Two independent writers both emitted `slide_1` — present in the stored corpus.
		const legacy = {
			slides: [
				{ key: "slide_1", caption: "one" },
				{ key: "slide_1", caption: "two" },
			],
		};
		const repaired = repairEntityKeys(readStoryboardSlides(legacy), SLIDE_KEY_PREFIX);
		expect(repaired[0]?.key).toBe("slide_1");
		expect(repaired[1]?.key).not.toBe("slide_1");
		expect(repaired.map((s) => s.caption)).toEqual(["one", "two"]);
	});

	test("repairing an already-keyed document changes nothing", () => {
		const doc = {
			slides: [
				{ key: "slide_aaa", caption: "one" },
				{ key: "slide_bbb", caption: "two" },
			],
		};
		const read = readStoryboardSlides(doc);
		expect(repairEntityKeys(read, SLIDE_KEY_PREFIX).map((s) => s.key)).toEqual([
			"slide_aaa",
			"slide_bbb",
		]);
	});

	test("posts repair the same way", () => {
		const legacy = {
			posts: [{ body: "one" }, { key: "post_1", body: "two" }, { key: "post_1", body: "three" }],
		};
		const repaired = repairEntityKeys(readStoryboardPosts(legacy), POST_KEY_PREFIX);
		expect(new Set(repaired.map((p) => p.key)).size).toBe(3);
		expect(repaired.map((p) => p.body)).toEqual(["one", "two", "three"]);
	});

	test("persisting a repaired legacy document makes immediate reload stable", () => {
		const legacy = {
			slides: [
				{ caption: "one", visual: "" },
				{ caption: "two", visual: "" },
			],
		};
		const repaired = repairEntityKeys(readStoryboardSlides(legacy), SLIDE_KEY_PREFIX);
		const projected: Slide[] = repaired.map((item, index) => ({
			key: item.key!,
			id: index + 1,
			cap: item.caption,
			vis: item.visual,
			img: false,
		}));
		const persisted = storyboardJson("image", { slides: projected });
		const reloaded = repairEntityKeys(readStoryboardSlides(persisted), SLIDE_KEY_PREFIX);
		expect(reloaded.map((item) => item.key)).toEqual(repaired.map((item) => item.key));
	});
});
