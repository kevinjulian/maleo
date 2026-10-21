import { afterEach, expect, test } from "vite-plus/test";
import { mediaFetchTarget } from "./media.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

test("long media reads keep stable URL for fresh signatures on each range", async () => {
	globalThis.fetch = (async () => {
		throw new Error("streaming should not resolve a one-use signature");
	}) as unknown as typeof fetch;
	const url = "/api/media/11111111-1111-4111-8111-111111111111";
	const target = await mediaFetchTarget(url, true);
	expect(target.url.endsWith(url), target.url).toBe(true);
	expect(target.credentials).toBe("include");
	expect(await mediaFetchTarget("https://stock.example.com/clip.mp4", true)).toEqual({
		url: "https://stock.example.com/clip.mp4",
		credentials: "omit",
	});
	expect(await mediaFetchTarget("https://external.example.com/clip.mp4")).toEqual({
		url: "https://external.example.com/clip.mp4",
		credentials: "omit",
	});
});

test("canvas image gets short-lived signed address without browser credentials", async () => {
	globalThis.fetch = (async () =>
		Response.json({
			url: "https://media.example.com/bucket/image?signature=test",
		})) as unknown as typeof fetch;
	const target = await mediaFetchTarget("/api/media/11111111-1111-4111-8111-111111111111");
	expect(target.url).toBe("https://media.example.com/bucket/image?signature=test");
	expect(target.credentials).toBe("omit");
});
