/* Worker exposes job metadata, never scratch cache bytes. */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cacheDir: string;
let priorCacheDir: string | undefined;
let priorInngestBaseUrl: string | undefined;
let eventServer: ReturnType<typeof Bun.serve>;
const FILE_NAME = "deadbeefcafe0001.png";
const FILE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic

beforeAll(async () => {
	cacheDir = await mkdtemp(join(tmpdir(), "maleo-media-cache-"));
	await writeFile(join(cacheDir, FILE_NAME), FILE_BYTES);
	priorCacheDir = process.env.CACHE_DIR;
	process.env.CACHE_DIR = cacheDir; // absolute
	priorInngestBaseUrl = process.env.INNGEST_BASE_URL;
	eventServer = Bun.serve({
		port: 0,
		fetch: () => Response.json({ status: 200, ids: ["test-event"] }),
	});
	process.env.INNGEST_BASE_URL = `http://127.0.0.1:${eventServer.port}`;
	// store.ts opens a SQLite DB at import — point it inside the temp dir.
	process.env.GEN_WORKER_DB ??= join(cacheDir, "gen-worker.sqlite");
});

afterAll(async () => {
	if (priorCacheDir === undefined) delete process.env.CACHE_DIR;
	else process.env.CACHE_DIR = priorCacheDir;
	if (priorInngestBaseUrl === undefined) delete process.env.INNGEST_BASE_URL;
	else process.env.INNGEST_BASE_URL = priorInngestBaseUrl;
	void eventServer.stop(true);
	await rm(cacheDir, { recursive: true, force: true });
});

describe("worker /files retrieve", () => {
	it("does not serve cached bytes", async () => {
		// A cached file exists on disk, but no worker route exposes it.
		const { buildMediaApp } = await import("./worker.ts");
		const app = buildMediaApp();
		const res = await app.request(`/files/${FILE_NAME}`);
		expect(res.status).toBe(404);
	});

	it("404s a missing file (no path traversal escape)", async () => {
		const { buildMediaApp } = await import("./worker.ts");
		const app = buildMediaApp();
		const res = await app.request("/files/does-not-exist.png");
		expect(res.status).toBe(404);
	});

	it("exposes queryable provider performance comparison", async () => {
		const { createJob, markDone, markFailed, markProviderSelected } =
			await import("./generation/store.ts");
		const job = createJob("image", "sandbox benchmark");
		markProviderSelected(job.id, "sandbox", "workspace");
		markDone(job.id, "/tmp/sandbox.svg", false, {
			providerId: "sandbox",
			providerSource: "workspace",
			model: "sandbox-svg",
			cost: 0,
			latencyMs: 12,
		});
		const failed = createJob("image", "sandbox unavailable", undefined, {
			providerId: "sandbox",
			providerSource: "workspace",
		});
		markFailed(failed.id, "health check failed");
		const { buildMediaApp } = await import("./worker.ts");
		const res = await buildMediaApp().request("/metrics/providers");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { providers: Array<Record<string, unknown>> };
		expect(body.providers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					provider_id: "sandbox",
					attempts: 2,
					usable_rate_pct: 50,
					avg_latency_ms: 12,
					avg_cost: 0,
				}),
			]),
		);
	});

	it("accepts structured image intent on /generate", async () => {
		const { buildMediaApp } = await import("./worker.ts");
		const res = await buildMediaApp().request("/generate", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				intent: {
					output: { kind: "single-image", aspect: "9:16", fullFrame: true },
					subjectLocks: [],
					scene: { visualMoment: "sleepy stickman" },
					constraints: { mustInclude: [], mustAvoid: [] },
					negative: [],
					references: [],
				},
			}),
		});
		expect(res.status).toBe(202);
		const body = (await res.json()) as { job_id?: string };
		expect(body.job_id).toBeTruthy();
	});
});
