import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { stockRoutes, toItem } from "./stock.ts";

describe("stock result mapping", () => {
	test("preserves attribution and license fields", () => {
		expect(
			toItem({
				id: "asset-1",
				kind: "image",
				provider: "Example Stock",
				url: "https://cdn.example/asset.jpg",
				pageUrl: "https://stock.example/assets/1",
				author: "Example Creator",
				authorUrl: "https://stock.example/creators/example",
				license: "Example License",
				licenseUrl: "https://stock.example/license",
			}),
		).toMatchObject({
			provider: "Example Stock",
			pageUrl: "https://stock.example/assets/1",
			author: "Example Creator",
			authorUrl: "https://stock.example/creators/example",
			license: "Example License",
			licenseUrl: "https://stock.example/license",
		});
	});
});

describe("stock audio passthrough", () => {
	const base = "https://files.example.org/file/example-bucket";
	let saved: string | undefined;
	beforeEach(() => {
		saved = process.env.STOCK_MUSIC_BASE_URL;
		process.env.STOCK_MUSIC_BASE_URL = base;
	});
	afterEach(() => {
		if (saved === undefined) delete process.env.STOCK_MUSIC_BASE_URL;
		else process.env.STOCK_MUSIC_BASE_URL = saved;
		mock.restore();
	});

	test("serves this deployment's host table, music base included", async () => {
		const res = await stockRoutes().request("/audio-hosts");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ freesound: "https://cdn.freesound.org", music: base });
	});

	test("forwards a music path to the configured base, range intact", async () => {
		const calls: Array<{ url: string; range: string | null }> = [];
		spyOn(globalThis, "fetch").mockImplementation((async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			calls.push({ url: String(input), range: new Headers(init?.headers).get("range") });
			return new Response("bytes", { status: 206, headers: { "content-type": "audio/mpeg" } });
		}) as typeof fetch);
		const res = await stockRoutes().request("/audio/music/music/bed-1.mp3", {
			headers: { range: "bytes=0-9" },
		});
		expect(res.status).toBe(206);
		expect(calls).toEqual([{ url: `${base}/music/bed-1.mp3`, range: "bytes=0-9" }]);
	});

	test("an unknown host key is refused", async () => {
		expect((await stockRoutes().request("/audio/elsewhere/x.mp3")).status).toBe(404);
	});
});
