import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageGenRoutes } from "./image-gen.ts";
import { testApp } from "../middleware/auth-testing.ts";

const priorCacheDir = process.env.CACHE_DIR;

let cacheDir = "";

beforeEach(async () => {
	cacheDir = await mkdtemp(join(tmpdir(), "maleo-dashboard-image-cache-"));
	process.env.CACHE_DIR = cacheDir;
	await writeFile(join(cacheDir, "cached.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
});

afterEach(async () => {
	if (priorCacheDir === undefined) delete process.env.CACHE_DIR;
	else process.env.CACHE_DIR = priorCacheDir;
	await rm(cacheDir, { recursive: true, force: true });
});

describe("historical image file route", () => {
	it("refuses an unmapped cache file", async () => {
		const app = testApp(imageGenRoutes());
		const res = await app.request("/files/cached.png");
		expect(res.status).toBe(404);
	});
});
