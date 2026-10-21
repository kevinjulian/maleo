import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { falProvider } from "./index.ts";
import { sandboxVideo } from "../sandbox/video.ts";
import { describeProviderConformance } from "../conformance.ts";

describeProviderConformance({ describe, test, expect }, falProvider);
const saved = {
	cache: process.env.CACHE_DIR,
	key: process.env.FAL_KEY,
	model: process.env.FAL_I2V_MODEL,
};
let dir: string, bytes: ArrayBuffer;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "fal-test-"));
	process.env.CACHE_DIR = dir;
	const video = await sandboxVideo.generate(
		{ imageUrl: "unused", prompt: "fixture", durationSec: 4 },
		{ workspaceId: "w" },
	);
	bytes = await Bun.file(video.path).arrayBuffer();
});
afterEach(() => {
	fetchSpy?.mockRestore();
	fetchSpy = undefined;
});
afterAll(async () => {
	for (const [key, value] of [
		["CACHE_DIR", saved.cache],
		["FAL_KEY", saved.key],
		["FAL_I2V_MODEL", saved.model],
	]) {
		if (value === undefined) delete process.env[key!];
		else process.env[key!] = value;
	}
	await rm(dir, { recursive: true, force: true });
});
const input = { imageUrl: "https://storage.example/source.png", prompt: "animate", durationSec: 7 };

test("uses configured model and measures downloaded video", async () => {
	process.env.FAL_KEY = "test-key";
	process.env.FAL_I2V_MODEL = "fal-ai/custom/image-to-video";
	const requests: string[] = [];
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (url: RequestInfo | URL, options?: RequestInit) => {
				requests.push(String(url));
				if (options?.method === "POST") {
					expect(JSON.parse(String(options.body))).toMatchObject({
						image_url: input.imageUrl,
						num_frames: 168,
					});
					return Response.json({ video: { url: "https://v3.fal.media/output.mp4" } });
				}
				return new Response(bytes);
			},
			{ preconnect: fetch.preconnect },
		),
	);
	const result = await falProvider.video!.generate(input, { workspaceId: "w" });
	expect(requests[0]).toBe("https://fal.run/fal-ai/custom/image-to-video");
	expect(result.durationSec).toBe(4);
});

test("missing credentials fails before network", async () => {
	delete process.env.FAL_KEY;
	fetchSpy = spyOn(globalThis, "fetch");
	await expect(falProvider.video!.generate(input, { workspaceId: "w" })).rejects.toThrow("FAL_KEY");
	expect(fetchSpy).not.toHaveBeenCalled();
});

test("vendor failure preserves status", async () => {
	process.env.FAL_KEY = "test-key";
	fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
		new Response("unavailable", { status: 429 }),
	);
	await expect(falProvider.video!.generate(input, { workspaceId: "w" })).rejects.toThrow("fal 429");
});

test("rejects non-vendor output URL before download", async () => {
	process.env.FAL_KEY = "test-key";
	fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({ video: { url: "https://localhost/private" } }),
	);
	await expect(falProvider.video!.generate(input, { workspaceId: "w" })).rejects.toThrow(
		"unsafe video URL",
	);
	expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("caller deadline reaches vendor fetch", async () => {
	process.env.FAL_KEY = "test-key";
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (_: RequestInfo | URL, options?: RequestInit) => {
				options?.signal?.throwIfAborted();
				throw new Error("unreachable");
			},
			{ preconnect: fetch.preconnect },
		),
	);
	await expect(
		falProvider.video!.generate(input, {
			workspaceId: "w",
			signal: AbortSignal.abort(new Error("deadline")),
		}),
	).rejects.toThrow("deadline");
});

test("invalid downloaded bytes fail without an adopted file", async () => {
	process.env.FAL_KEY = "test-key";
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (_: RequestInfo | URL, options?: RequestInit) =>
				options?.method === "POST"
					? Response.json({ video: { url: "https://v3.fal.media/output.mp4" } })
					: new Response("invalid mp4"),
			{ preconnect: fetch.preconnect },
		),
	);
	await expect(falProvider.video!.generate(input, { workspaceId: "w" })).rejects.toThrow();
});
