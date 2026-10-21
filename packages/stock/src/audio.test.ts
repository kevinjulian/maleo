import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	clearMusicLibraryCache,
	clearStockAudioCache,
	resolveStockAudio,
	resolveStockAudioCue,
	resolveStockAudioPool,
	searchStockAudio,
	setMusicFetchForTests,
	setStockAudioResolverForTests,
	setStockSearchForTests,
} from "@maleo/stock";

afterEach(() => {
	setStockAudioResolverForTests(null);
	setStockSearchForTests(null);
	setMusicFetchForTests(null);
	clearStockAudioCache();
	clearMusicLibraryCache();
});

describe("stock audio resolver", () => {
	it("routes music/ambient to the music library, sfx/accent_hit to the SFX library", async () => {
		const seen: string[] = [];
		setStockAudioResolverForTests(async (kind) => {
			seen.push(kind);
			return { url: `u/${kind}` };
		});
		await resolveStockAudio("music", "epic");
		await resolveStockAudio("ambient", "wind");
		await resolveStockAudio("sfx", "whoosh");
		await resolveStockAudio("accent_hit", "boom");
		expect(seen).toEqual(["music", "ambient", "sfx", "accent_hit"]);
	});

	it("returns the stubbed best match", async () => {
		setStockAudioResolverForTests(async () => ({
			url: "https://stock.test/clip.mp3",
			title: "clip",
		}));
		expect((await resolveStockAudio("sfx", "sword"))?.url).toBe("https://stock.test/clip.mp3");
	});

	it("returns null with an unpublished library and no key (graceful degrade)", async () => {
		const savedF = process.env.FREESOUND_API_KEY;
		delete process.env.FREESOUND_API_KEY;
		// This asserts what happens when NOTHING is published, so it must not reach
		// the real library — it started failing the moment the first bed went live,
		// which is exactly backwards for a test about the empty case.
		//
		// Both halves are needed. Stubbing the fetch is not enough: the library
		// deliberately retains the last good manifest on disk and falls back to it,
		// so an unpublished library still looks published until the retained copy
		// is out of reach too.
		const priorCache = process.env.STOCK_MUSIC_CACHE;
		process.env.STOCK_MUSIC_CACHE = join(
			mkdtempSync(join(tmpdir(), "audio-test-")),
			"manifest.json",
		);
		setMusicFetchForTests(async () => ({ status: 404, body: null }));
		clearMusicLibraryCache();
		try {
			expect(await searchStockAudio("music", "x")).toEqual([]);
			expect(await searchStockAudio("sfx", "x")).toEqual([]);
			expect(await resolveStockAudio("music", "x")).toBeNull();
		} finally {
			if (savedF === undefined) delete process.env.FREESOUND_API_KEY;
			else process.env.FREESOUND_API_KEY = savedF;
			if (priorCache === undefined) delete process.env.STOCK_MUSIC_CACHE;
			else process.env.STOCK_MUSIC_CACHE = priorCache;
		}
	});

	it("empty query resolves to null", async () => {
		expect(await resolveStockAudio("sfx", "   ")).toBeNull();
	});

	it("relaxes descriptive cues so generated SFX matches preview fallback", async () => {
		const seen: string[] = [];
		setStockAudioResolverForTests(async (_kind, query) => {
			seen.push(query);
			return query === "transition stinger" ? { url: "https://stock.test/stinger.mp3" } : null;
		});
		expect((await resolveStockAudioCue("accent_hit", "subtle transition stinger"))?.url).toBe(
			"https://stock.test/stinger.mp3",
		);
		expect(seen).toEqual(["subtle transition stinger", "transition stinger"]);
	});
});

describe("stock audio cache (quota conservation)", () => {
	it("reuses a resolved result for the same kind+query (case-insensitive)", async () => {
		let calls = 0;
		setStockSearchForTests(async () => {
			calls++;
			return [{ url: "https://stock.test/a.mp3" }];
		});
		const a = await resolveStockAudio("sfx", "Sword Clash");
		const b = await resolveStockAudio("sfx", "sword clash"); // same query, different case
		expect(a?.url).toBe("https://stock.test/a.mp3");
		expect(b?.url).toBe("https://stock.test/a.mp3");
		expect(calls).toBe(1); // second lookup served from cache
	});

	it("different kind or query queries again", async () => {
		let calls = 0;
		setStockSearchForTests(async () => {
			calls++;
			return [{ url: "u" }];
		});
		await resolveStockAudio("sfx", "boom");
		await resolveStockAudio("music", "boom"); // different kind
		await resolveStockAudio("sfx", "whoosh"); // different query
		expect(calls).toBe(3);
	});
});

describe("stock audio pool (varied accents)", () => {
	it("collects up to perQuery matches per cue, deduplicated by url", async () => {
		setStockSearchForTests(async (_kind, query) => [
			{ url: `https://stock.test/${query}-1.mp3` },
			{ url: `https://stock.test/${query}-2.mp3` },
			{ url: "https://stock.test/shared.mp3" },
		]);
		const pool = await resolveStockAudioPool("accent_hit", ["whoosh", "riser"], 3);
		expect(pool.map((p) => p.url)).toEqual([
			"https://stock.test/whoosh-1.mp3",
			"https://stock.test/whoosh-2.mp3",
			"https://stock.test/shared.mp3",
			"https://stock.test/riser-1.mp3",
			"https://stock.test/riser-2.mp3",
		]);
	});

	it("skips failed cues and returns [] when everything fails", async () => {
		setStockSearchForTests(async () => {
			throw new Error("down");
		});
		expect(await resolveStockAudioPool("accent_hit", ["whoosh", "riser"])).toEqual([]);
	});

	it("serves repeat pool lookups from cache", async () => {
		let calls = 0;
		setStockSearchForTests(async () => {
			calls++;
			return [{ url: "u1" }, { url: "u2" }];
		});
		await resolveStockAudioPool("accent_hit", ["whoosh"]);
		await resolveStockAudioPool("accent_hit", ["whoosh"]);
		expect(calls).toBe(1);
	});
});
