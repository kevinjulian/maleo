import { afterEach, describe, expect, it } from "vite-plus/test";
import { setConfigSource, withConfigOverride } from "@maleo/shared/provider-config";
import {
	isPexelsConfigured,
	pexelsKey,
	probePexels,
	searchPexelsImages,
	searchPexelsVideos,
	setPexelsFetchForTests,
} from "./pexels.ts";
import {
	freesoundKey,
	isFreesoundConfigured,
	probeFreesound,
	searchFreesoundSfx,
	setFreesoundFetchForTests,
} from "./freesound.ts";
import { clearStockCache } from "./cache.ts";

afterEach(() => {
	setConfigSource(null);
	setPexelsFetchForTests(null);
	setFreesoundFetchForTests(null);
	clearStockCache();
});

describe("stock credential resolution", () => {
	it("uses one installed configuration source", () => {
		setConfigSource({
			resolve: (key) =>
				({
					PEXELS_API_KEY: "pexels-stored",
					FREESOUND_API_KEY: "freesound-stored",
					FREESOUND_COMMERCIAL_USE_APPROVED: "yes",
				})[key],
		});
		expect(pexelsKey()).toBe("pexels-stored");
		expect(freesoundKey()).toBe("freesound-stored");
		expect(isPexelsConfigured()).toBe(true);
		expect(isFreesoundConfigured()).toBe(true);
	});

	it("reports unconfigured when canonical keys are absent", () => {
		setConfigSource({ resolve: () => undefined });
		expect(isPexelsConfigured()).toBe(false);
		expect(isFreesoundConfigured()).toBe(false);
	});

	it("requires explicit commercial API permission for Freesound", () => {
		setConfigSource({ resolve: (key) => (key === "FREESOUND_API_KEY" ? "key" : undefined) });
		expect(isFreesoundConfigured()).toBe(false);
	});

	it("does not accept removed Pexels alias", () => {
		setConfigSource({ resolve: (key) => (key === "MALEO_PEXELS_API_KEY" ? "legacy" : undefined) });
		expect(pexelsKey()).toBeUndefined();
	});

	it("candidate values are scoped to one call", async () => {
		setConfigSource({ resolve: () => undefined });
		await withConfigOverride({ PEXELS_API_KEY: "candidate" }, async () => {
			expect(pexelsKey()).toBe("candidate");
		});
		expect(pexelsKey()).toBeUndefined();
	});
});

describe("pexels search", () => {
	it("returns nothing without a key rather than throwing", async () => {
		setConfigSource({ resolve: () => undefined });
		expect(await searchPexelsImages("mountains")).toEqual([]);
	});

	it("maps photo and video attribution", async () => {
		setConfigSource({
			resolve: (key) => (key === "FREESOUND_COMMERCIAL_USE_APPROVED" ? "yes" : "key"),
		});
		setPexelsFetchForTests(async (url) =>
			url.includes("videos")
				? {
						videos: [
							{
								id: 9,
								url: "https://www.pexels.com/video/9/",
								image: "https://cdn/t.jpg",
								duration: 20,
								user: { name: "Someone", url: "https://www.pexels.com/@someone" },
								video_files: [{ link: "https://cdn/hd.mp4", quality: "hd" }],
							},
						],
					}
				: {
						photos: [
							{
								id: 5,
								url: "https://www.pexels.com/photo/5/",
								photographer: "Someone",
								photographer_url: "https://www.pexels.com/@someone",
								alt: "A mountain",
								src: { medium: "https://cdn/m.jpg", large: "https://cdn/l.jpg" },
							},
						],
					},
		);
		const [photo] = await searchPexelsImages("mountains");
		const [video] = await searchPexelsVideos("city");
		expect(photo).toMatchObject({
			url: "https://cdn/l.jpg",
			author: "Someone",
			license: "Pexels License",
		});
		expect(video).toMatchObject({ url: "https://cdn/hd.mp4", durationSec: 20 });
	});

	it("caches searches", async () => {
		setConfigSource({ resolve: () => "key" });
		let calls = 0;
		setPexelsFetchForTests(async () => {
			calls++;
			return { photos: [] };
		});
		await searchPexelsImages("repeat");
		await searchPexelsImages("repeat");
		expect(calls).toBe(1);
	});

	it("degrades to empty when search fails", async () => {
		setConfigSource({ resolve: () => "key" });
		setPexelsFetchForTests(async () => {
			throw new Error("network down");
		});
		expect(await searchPexelsVideos("boom")).toEqual([]);
	});
});

describe("stock provider probes", () => {
	it("accepts authenticated empty responses", async () => {
		setConfigSource({
			resolve: (key) => (key === "FREESOUND_COMMERCIAL_USE_APPROVED" ? "yes" : "key"),
		});
		setPexelsFetchForTests(async () => Response.json({ photos: [] }));
		setFreesoundFetchForTests(async () => Response.json({ results: [] }));
		expect(await probePexels()).toEqual({ ok: true });
		expect(await probeFreesound()).toEqual({ ok: true });
	});

	it("reports rejected credentials", async () => {
		setConfigSource({
			resolve: (key) => (key === "FREESOUND_COMMERCIAL_USE_APPROVED" ? "yes" : "bad"),
		});
		setPexelsFetchForTests(async () => new Response("unauthorized", { status: 401 }));
		setFreesoundFetchForTests(async () => new Response("forbidden", { status: 403 }));
		expect(await probePexels()).toEqual({ ok: false, reason: "Pexels returned 401" });
		expect(await probeFreesound()).toEqual({ ok: false, reason: "Freesound returned 403" });
	});

	it("reports unreachable providers", async () => {
		setConfigSource({
			resolve: (key) => (key === "FREESOUND_COMMERCIAL_USE_APPROVED" ? "yes" : "key"),
		});
		setPexelsFetchForTests(async () => {
			throw new Error("network down");
		});
		setFreesoundFetchForTests(async () => {
			throw new Error("network down");
		});
		expect(await probePexels()).toEqual({ ok: false, reason: "network down" });
		expect(await probeFreesound()).toEqual({ ok: false, reason: "network down" });
	});

	it("searches Freesound through resolved configuration", async () => {
		setConfigSource({
			resolve: (key) =>
				key === "FREESOUND_API_KEY"
					? "stored"
					: key === "FREESOUND_COMMERCIAL_USE_APPROVED"
						? "yes"
						: undefined,
		});
		setFreesoundFetchForTests(async () =>
			Response.json({
				results: [
					{
						id: 42,
						name: "Whoosh",
						username: "Maker",
						duration: 1.5,
						license: "https://creativecommons.org/publicdomain/zero/1.0/",
						previews: { "preview-hq-mp3": "https://cdn/sound.mp3" },
					},
				],
			}),
		);
		expect(await searchFreesoundSfx("whoosh", 1)).toEqual([
			{
				url: "https://cdn/sound.mp3",
				title: "Whoosh",
				author: "Maker",
				durationSec: 1.5,
				authorUrl: "https://freesound.org/people/Maker/",
				pageUrl: "https://freesound.org/people/Maker/sounds/42/",
				license: "https://creativecommons.org/publicdomain/zero/1.0/",
				licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
			},
		]);
	});
});
