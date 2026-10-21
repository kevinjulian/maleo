/* The recorded provider responses still carry the fields these adapters read.
 *
 * This is task 2.4's proof and the regression test for a provider change: when
 * one of these fails, either the provider moved or the adapter did, and the
 * fixture says which. The fixtures are real responses recorded 2026-08-21 —
 * see `tests/fixtures/README.md` for what is deliberately not among them.
 *
 * Deliberately about SHAPE, not values. Asserting a particular photographer's
 * name would fail the day Pexels reorders its results, which is not a change
 * worth a red build. */
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fieldOf } from "@maleo/shared";
import { setConfigSource } from "@maleo/shared/provider-config";
import { setPexelsFetchForTests, searchPexelsImages, searchPexelsVideos } from "./pexels.ts";
import { clearStockCache, getStockDropInfo } from "./cache.ts";
import { PROVIDERS } from "./providers.ts";

beforeEach(() => {
	setConfigSource({ resolve: (key) => (key === "PEXELS_API_KEY" ? "test-key" : undefined) });
});

afterEach(() => {
	setConfigSource(null);
	setPexelsFetchForTests(null);
	clearStockCache();
});

const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(join(import.meta.dirname, "../tests/fixtures", `${name}.json`), "utf8"));

describe("recorded provider responses", () => {
	test("stock providers declare their fixed capabilities and canonical secrets", () => {
		expect(PROVIDERS.map(({ id, capabilities }) => ({ id, capabilities }))).toEqual([
			{ id: "pexels", capabilities: ["stock-visuals"] },
			{ id: "freesound", capabilities: ["sound-effects"] },
		]);
		expect(PROVIDERS.find((p) => p.id === "freesound")?.config.map((f) => f.key)).toEqual([
			"FREESOUND_API_KEY",
			"FREESOUND_COMMERCIAL_USE_APPROVED",
			"FREESOUND_LICENSE_FILTER",
		]);
		for (const provider of PROVIDERS)
			expect(provider.config.some((field) => field.help?.includes("https://"))).toBe(true);
	});

	test("pexels photos still carry the fields the adapter reads", async () => {
		clearStockCache();
		setPexelsFetchForTests(async () => fixture("pexels-photos"));
		try {
			const assets = await searchPexelsImages("coffee");
			expect(assets.length).toBeGreaterThan(0);
			const first = assets[0]!;
			expect(first.url).toMatch(/^https?:\/\//);
			expect(first.provider).toBe("Pexels");
			expect(first.kind).toBe("image");
			// `id` comes off the response; an empty one means the field moved.
			expect(first.id).not.toBe("");
		} finally {
			setPexelsFetchForTests(null);
		}
	});

	test("pexels videos still carry a usable rendition link", async () => {
		clearStockCache();
		setPexelsFetchForTests(async () => fixture("pexels-videos"));
		try {
			const assets = await searchPexelsVideos("coffee");
			expect(assets.length).toBeGreaterThan(0);
			expect(assets[0]!.url).toMatch(/^https?:\/\//);
			expect(assets[0]!.kind).toBe("video");
		} finally {
			setPexelsFetchForTests(null);
		}
	});

	test("a response whose items lost their url is counted, not silently empty", async () => {
		clearStockCache();
		// The shape a provider change looks like from here: the envelope is intact,
		// the items are there, and the field the adapter needs is gone.
		const body = fixture("pexels-photos");
		const photos = fieldOf(body, "photos");
		const stripped = {
			...(body as object),
			photos: (Array.isArray(photos) ? photos : []).map((p) => ({ ...(p as object), src: {} })),
		};
		setPexelsFetchForTests(async () => stripped);
		try {
			const assets = await searchPexelsImages("coffee");
			expect(assets).toHaveLength(0);
			// The point of the counter: an empty result set that came from dropped
			// items is distinguishable from one that came from no results.
			expect(getStockDropInfo().pexels?.dropped ?? 0).toBeGreaterThan(0);
		} finally {
			setPexelsFetchForTests(null);
		}
	});

	test("openverse and freesound fixtures still carry their read fields", () => {
		for (const name of ["openverse-images", "openverse-audio"]) {
			const results = fieldOf(fixture(name), "results");
			expect(Array.isArray(results)).toBe(true);
			const first = (results as unknown[])[0];
			for (const key of ["id", "url", "title", "creator"]) {
				expect(fieldOf(first, key)).toBeDefined();
			}
		}
		const sounds = fieldOf(fixture("freesound-search"), "results");
		const sound = (sounds as unknown[])[0];
		expect(fieldOf(fieldOf(sound, "previews"), "preview-hq-mp3")).toBeTypeOf("string");
		for (const key of ["name", "username", "duration"]) {
			expect(fieldOf(sound, key)).toBeDefined();
		}
	});
});
