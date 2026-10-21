import { afterEach, describe, expect, it } from "vite-plus/test";
import { mediaWorkerCacheDir, mediaWorkerDbPath } from "./paths.ts";

const priorDb = process.env.GEN_WORKER_DB;
const priorCache = process.env.CACHE_DIR;

afterEach(() => {
	if (priorDb === undefined) delete process.env.GEN_WORKER_DB;
	else process.env.GEN_WORKER_DB = priorDb;
	if (priorCache === undefined) delete process.env.CACHE_DIR;
	else process.env.CACHE_DIR = priorCache;
});

describe("media worker paths", () => {
	it("defaults to the app worker data directory regardless of cwd", () => {
		delete process.env.GEN_WORKER_DB;
		delete process.env.CACHE_DIR;
		expect(mediaWorkerDbPath().endsWith("/apps/media-worker/data/gen-worker.sqlite")).toBe(true);
		expect(mediaWorkerCacheDir().endsWith("/apps/media-worker/data/cache")).toBe(true);
	});

	it("resolves relative env paths from the repo root, not process cwd", () => {
		process.env.GEN_WORKER_DB = "apps/media-worker/data/custom.sqlite";
		process.env.CACHE_DIR = "apps/media-worker/data/custom-cache";
		expect(mediaWorkerDbPath().endsWith("/apps/media-worker/data/custom.sqlite")).toBe(true);
		expect(mediaWorkerCacheDir().endsWith("/apps/media-worker/data/custom-cache")).toBe(true);
	});
});
