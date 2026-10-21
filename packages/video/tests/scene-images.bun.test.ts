import { afterAll, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveSceneImage } from "../src/lib/scene-images";

// No MALEO_IMAGE_URL in test env, so tryService() short-circuits and every
// resolve falls back to a local placeholder. That's exactly the degraded path
// whose provenance must survive caching.
const tmp = path.join(os.tmpdir(), `scene-images-test-${process.pid}`);

afterAll(async () => {
	await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

describe("resolveSceneImage placeholder provenance", () => {
	it("marks fresh placeholder as 'placeholder'", async () => {
		const r = await resolveSceneImage("a quiet lake at dawn", "scene-1", { cacheDir: tmp });
		expect(r.source).toBe("placeholder");
		expect(r.path.endsWith(".jpg")).toBe(true);
	});

	it("keeps a cached placeholder degraded on the next render (not 'cache')", async () => {
		// Same visual → cache hit. The sidecar marker must keep it attributed as a
		// placeholder so a second render doesn't falsely report clean.
		const again = await resolveSceneImage("a quiet lake at dawn", "scene-1", { cacheDir: tmp });
		expect(again.source).toBe("placeholder");
	});

	it("writes a sidecar marker next to the placeholder jpg", async () => {
		const r = await resolveSceneImage("neon city street", "scene-2", { cacheDir: tmp });
		const marker = `${r.path}.placeholder`;
		expect(
			await fs
				.stat(marker)
				.then(() => true)
				.catch(() => false),
		).toBe(true);
	});

	it("retryPlaceholder keeps the placeholder when no image service is reachable", async () => {
		// No MALEO_IMAGE_URL configured, so the retry can't repair — must stay
		// attributed as placeholder (degraded), not silently flip to cache/service.
		const r = await resolveSceneImage("a quiet lake at dawn", "scene-1", {
			cacheDir: tmp,
			retryPlaceholder: true,
		});
		expect(r.source).toBe("placeholder");
	});
});
