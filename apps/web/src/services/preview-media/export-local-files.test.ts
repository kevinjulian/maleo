import { describe, expect, test } from "vite-plus/test";
import type { ManifestEntry } from "@models/render/export-preflight.ts";
import { localFileLookup } from "./export-local-files.ts";

const file = new File(["x"], "clip.mp4");
const entry = (url: string): ManifestEntry => ({ id: url, url, state: "ready", used: true });

function lookup(urls: string[], ready: Record<string, string>, available = new Set(["blob:a"])) {
	const released: string[] = [];
	const find = localFileLookup(
		{ sourceUrls: () => urls, resolve: (url) => ready[url] },
		(local) => {
			if (!available.has(local)) throw new Error("Complete local preview source is unavailable");
			return {
				source: { id: "s", revision: "r", file, video: null, audio: null },
				release: () => released.push(local) > 0,
			};
		},
	);
	return { find, released };
}

describe("localFileLookup", () => {
	test("finds a managed source by media id and releases the borrow at once", () => {
		const media = "/api/media/0190c0de-0000-7000-8000-000000000001";
		const { find, released } = lookup([media], { [media]: "blob:a" });
		expect(find({ ...entry(media), id: "0190c0de-0000-7000-8000-000000000001" })).toBe(file);
		expect(released).toEqual(["blob:a"]);
	});

	test("finds an external source by exact URL only", () => {
		const { find } = lookup(["https://stock/x.jpg"], { "https://stock/x.jpg": "blob:a" });
		expect(find(entry("https://stock/x.jpg"))).toBe(file);
		expect(find(entry("https://stock/y.jpg"))).toBeUndefined();
	});

	test("a source that is not loaded or whose bytes are gone has no file", () => {
		expect(lookup(["/api/media/abc"], {}).find(entry("/api/media/abc"))).toBeUndefined();
		expect(
			lookup(["/api/media/abc"], { "/api/media/abc": "blob:b" }).find(entry("/api/media/abc")),
		).toBeUndefined();
	});
});
