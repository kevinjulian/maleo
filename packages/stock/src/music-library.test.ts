import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	bestBed,
	clearMusicLibraryCache,
	isMusicLibraryPublished,
	musicLibrary,
	searchMusicLibrary,
	setMusicFetchForTests,
} from "./music-library.ts";
import {
	MUSIC_MANIFEST_VERSION,
	MUSIC_PUBLIC_BASE_URL,
	baseUrlMatchesBucket,
	musicBedUrl,
	musicManifestUrl,
	parseMusicManifest,
} from "./music-manifest.ts";
import type { MusicBed } from "./music-manifest.ts";

const priorCache = process.env.STOCK_MUSIC_CACHE;
const priorBase = process.env.STOCK_MUSIC_BASE_URL;

const bed = (over: Partial<MusicBed> & { id: string }): MusicBed => ({
	url: `https://files.test/music/${over.id}.mp3`,
	title: over.id,
	description: "",
	tags: [],
	durationSec: 120,
	source: "https://example.test/track",
	license: "Test License",
	...over,
});

const manifest = (tracks: MusicBed[]) => ({ schemaVersion: MUSIC_MANIFEST_VERSION, tracks });

/** Point the retained-copy path at a scratch dir so a real cache never leaks in. */
function isolateCache(): void {
	process.env.STOCK_MUSIC_CACHE = join(mkdtempSync(join(tmpdir(), "music-lib-")), "manifest.json");
}

afterEach(() => {
	setMusicFetchForTests(null);
	clearMusicLibraryCache();
	if (priorCache === undefined) delete process.env.STOCK_MUSIC_CACHE;
	else process.env.STOCK_MUSIC_CACHE = priorCache;
	if (priorBase === undefined) delete process.env.STOCK_MUSIC_BASE_URL;
	else process.env.STOCK_MUSIC_BASE_URL = priorBase;
});

describe("manifest contract", () => {
	it("refuses an unknown schema version rather than reading it partially", () => {
		expect(() => parseMusicManifest({ schemaVersion: 999, tracks: [] })).toThrow(/schemaVersion/);
	});

	it("refuses a bed with no source", () => {
		const track = { ...bed({ id: "a" }), source: "" };
		expect(() => parseMusicManifest(manifest([track as MusicBed]))).toThrow(/source/);
	});

	it("refuses a bed with no licence", () => {
		const track = { ...bed({ id: "a" }), license: "" };
		expect(() => parseMusicManifest(manifest([track as MusicBed]))).toThrow(/license/);
	});

	it("keeps provenance through a round trip", () => {
		const parsed = parseMusicManifest(
			manifest([bed({ id: "calm", source: "https://pixabay.test/1", license: "Pixabay" })]),
		);
		expect(parsed.tracks[0]!.source).toBe("https://pixabay.test/1");
		expect(parsed.tracks[0]!.license).toBe("Pixabay");
	});

	it("builds the manifest url from a fixed path under a configurable host", () => {
		process.env.STOCK_MUSIC_BASE_URL = "https://staging.test";
		expect(musicManifestUrl()).toBe("https://staging.test/music/manifest.json");
	});

	it("composes host, bucket and folder, so the bucket is named in one place", () => {
		// B2_BUCKET_NAME is what publishing uploads to. Reading it here means the
		// app cannot end up pointed at a bucket nothing was written to.
		delete process.env.STOCK_MUSIC_BASE_URL;
		process.env.STOCK_MUSIC_HOST = "https://cdn.example";
		process.env.B2_BUCKET_NAME = "other-bucket";
		process.env.STOCK_MUSIC_PREFIX = "beds";
		expect(musicManifestUrl()).toBe("https://cdn.example/file/other-bucket/beds/manifest.json");
		delete process.env.STOCK_MUSIC_HOST;
		delete process.env.B2_BUCKET_NAME;
		delete process.env.STOCK_MUSIC_PREFIX;
	});

	it("falls back to neutral placeholders when nothing is configured", () => {
		for (const name of [
			"STOCK_MUSIC_BASE_URL",
			"STOCK_MUSIC_HOST",
			"B2_BUCKET_NAME",
			"STOCK_MUSIC_PREFIX",
		]) {
			delete process.env[name];
		}
		expect(musicManifestUrl()).toBe(
			"https://media.example.com/file/example-bucket/music/manifest.json",
		);
	});

	it("tolerates stray slashes in configuration", () => {
		process.env.STOCK_MUSIC_HOST = "https://cdn.example/";
		process.env.STOCK_MUSIC_PREFIX = "/beds/";
		expect(musicBedUrl("a.mp3")).toBe("https://cdn.example/file/example-bucket/beds/a.mp3");
		delete process.env.STOCK_MUSIC_HOST;
		delete process.env.STOCK_MUSIC_PREFIX;
	});

	it("refuses a whole-base override that names a different bucket than the upload", () => {
		// Uploading to one bucket while recording urls for another is the single
		// misconfiguration that errors nowhere: the upload works, and the urls 404
		// exactly as an unpublished library does.
		process.env.STOCK_MUSIC_BASE_URL = "https://cdn.example/file/wrong-bucket";
		expect(baseUrlMatchesBucket("example-bucket")).toBe(false);
		expect(baseUrlMatchesBucket("wrong-bucket")).toBe(true);
		delete process.env.STOCK_MUSIC_BASE_URL;
	});

	it("has nothing to check when the base is composed rather than overridden", () => {
		delete process.env.STOCK_MUSIC_BASE_URL;
		expect(baseUrlMatchesBucket("anything")).toBe(true);
	});

	it("keeps the downloaded name in the url", () => {
		// The file in music-source, the object in the bucket and the url all read
		// the same, so a bed can be found by eye.
		for (const name of [
			"STOCK_MUSIC_BASE_URL",
			"STOCK_MUSIC_HOST",
			"B2_BUCKET_NAME",
			"STOCK_MUSIC_PREFIX",
		]) {
			delete process.env[name];
		}
		expect(musicBedUrl("example-track.mp3")).toBe(
			"https://media.example.com/file/example-bucket/music/example-track.mp3",
		);
	});

	it("escapes a name that would otherwise break the url", () => {
		// The name is whatever the download was called; a hand-edited sidecar can
		// carry a space or an accent.
		expect(musicBedUrl("soft pad café.mp3")).toContain("soft%20pad%20caf%C3%A9.mp3");
	});

	it("addresses the bucket the way B2 serves it", () => {
		// <host>/file/<bucket>/<path>. Without the /file/<bucket> segment the host
		// answers 404 from a handler that never looks the bucket up — which, from
		// the app's side, is indistinguishable from an unpublished library. That
		// is precisely why it went unnoticed, so the shape is pinned here.
		delete process.env.STOCK_MUSIC_BASE_URL;
		expect(MUSIC_PUBLIC_BASE_URL).toMatch(/^https:\/\/[^/]+\/file\/[^/]+$/);
		expect(musicManifestUrl()).toBe(
			"https://media.example.com/file/example-bucket/music/manifest.json",
		);
		expect(musicBedUrl("a-track-12345.mp3")).toBe(
			"https://media.example.com/file/example-bucket/music/a-track-12345.mp3",
		);
	});
});

describe("fetching and retaining", () => {
	it("fetches once within the cache lifetime", async () => {
		isolateCache();
		let calls = 0;
		setMusicFetchForTests(async () => {
			calls++;
			return { status: 200, body: manifest([bed({ id: "a" })]) };
		});
		await musicLibrary();
		await musicLibrary();
		expect(calls).toBe(1);
	});

	it("uses the retained copy when the manifest cannot be fetched", async () => {
		isolateCache();
		setMusicFetchForTests(async () => ({ status: 200, body: manifest([bed({ id: "kept" })]) }));
		await musicLibrary();

		// New process: in-memory state gone, disk copy remains, network down.
		clearMusicLibraryCache();
		setMusicFetchForTests(async () => {
			throw new Error("offline");
		});
		const beds = await musicLibrary();
		expect(beds.map((b) => b.id)).toEqual(["kept"]);
	});

	it("reports nothing when the fetch fails and nothing was ever retained", async () => {
		isolateCache();
		setMusicFetchForTests(async () => {
			throw new Error("offline");
		});
		expect(await musicLibrary()).toEqual([]);
		expect(await isMusicLibraryPublished()).toBe(false);
	});

	it("treats a 304 as confirmation of what it already holds", async () => {
		isolateCache();
		let calls = 0;
		setMusicFetchForTests(async () => {
			calls++;
			return calls === 1
				? { status: 200, body: manifest([bed({ id: "a" })]), etag: "v1" }
				: { status: 304 };
		});
		await musicLibrary();
		clearMusicLibraryCache();
		// Cleared in-memory, so the retained copy answers rather than a refetch.
		expect((await musicLibrary()).map((b) => b.id)).toEqual(["a"]);
	});

	it("ignores a malformed manifest in favour of the retained copy", async () => {
		isolateCache();
		setMusicFetchForTests(async () => ({ status: 200, body: manifest([bed({ id: "good" })]) }));
		await musicLibrary();
		clearMusicLibraryCache();
		setMusicFetchForTests(async () => ({ status: 200, body: { schemaVersion: 42, tracks: [] } }));
		expect((await musicLibrary()).map((b) => b.id)).toEqual(["good"]);
	});
});

describe("matching a cue", () => {
	const library = [
		bed({
			id: "calm",
			title: "Soft Ambient Pad",
			description: "gentle sustained pad",
			tags: ["calm", "ambient", "pad"],
			emotion: "calm",
			durationSec: 200,
		}),
		bed({
			id: "tense",
			title: "Dark Pulse",
			description: "driving low synth with a ticking rhythm",
			tags: ["dark", "tense", "driving", "pulse"],
			emotion: "tension",
			durationSec: 180,
		}),
		bed({
			id: "bright",
			title: "Bright Plucks",
			description: "playful pizzicato",
			tags: ["playful", "bright"],
			emotion: "curiosity",
			durationSec: 150,
		}),
	];

	it("prefers a tag match over a description match", () => {
		// "driving" is a tag on tense and appears in no other bed's tags.
		expect(bestBed(library, "driving")!.id).toBe("tense");
	});

	it("uses a structural emotion over text alone", () => {
		expect(bestBed(library, "something unrelated", "curiosity")!.id).toBe("bright");
	});

	it("still returns a bed when nothing matches", () => {
		// The whole point: a small library makes "no strong match" ordinary, and a
		// silently missing bed is the failure this library exists to remove.
		const chosen = bestBed(library, "zzzz qqqq");
		expect(chosen).toBeDefined();
	});

	it("returns the same bed for the same cue every time", () => {
		const first = bestBed(library, "zzzz qqqq")!.id;
		expect(bestBed(library, "zzzz qqqq")!.id).toBe(first);
		expect(bestBed([...library].reverse(), "zzzz qqqq")!.id).toBe(first);
	});

	it("breaks a tie toward the longer bed", () => {
		const tied = [bed({ id: "short", durationSec: 90 }), bed({ id: "long", durationSec: 240 })];
		expect(bestBed(tied, "no matches here")!.id).toBe("long");
	});

	it("returns nothing only when the library is empty", () => {
		expect(bestBed([], "anything")).toBeUndefined();
	});

	it("ranks the whole library for a search, best first", async () => {
		isolateCache();
		setMusicFetchForTests(async () => ({ status: 200, body: manifest(library) }));
		const results = await searchMusicLibrary("dark driving pulse");
		expect(results[0]!.url).toContain("tense");
		expect(results.length).toBe(library.length);
	});

	it("returns nothing from a search when no library is published", async () => {
		isolateCache();
		setMusicFetchForTests(async () => {
			throw new Error("offline");
		});
		expect(await searchMusicLibrary("anything")).toEqual([]);
	});
});
