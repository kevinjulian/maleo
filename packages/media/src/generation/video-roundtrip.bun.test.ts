import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const prior = { ...process.env };
let dir: string;
let server: ReturnType<typeof Bun.serve>;
let sendSpy: { mockRestore(): void } | undefined;
beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "video-roundtrip-"));
	process.env.CACHE_DIR = join(dir, "cache");
	process.env.GEN_WORKER_DB ??= join(dir, "jobs.sqlite");
	process.env.MALEO_DATA_DIR = dir;
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	process.env.MALEO_SERVICE_TOKEN = "video-test-token";
	delete process.env.MALEO_SANDBOX;
	delete process.env.FAL_KEY;
	server = Bun.serve({ port: 0, fetch: () => Response.json({ status: 200, ids: ["event"] }) });
	process.env.INNGEST_BASE_URL = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
	sendSpy?.mockRestore();
	void server.stop(true);
	for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
	Object.assign(process.env, prior);
	await rm(dir, { recursive: true, force: true });
});

test("authenticated video submit, retry, generate, publish, poll and failure run through real worker contract", async () => {
	const { buildMediaApp } = await import("../worker.ts");
	const { getGenerationRuntime } = await import("./runtime.ts");
	const { getJob } = await import("./store.ts");
	const { getMedia, deleteMedia } = await import("@maleo/storage");
	const { inngest } = await import("@maleo/inngest");
	sendSpy = spyOn(inngest, "send").mockResolvedValue({ ids: ["event"] });
	const app = buildMediaApp();
	const body = {
		image_url: "workspaces/video-test/image/source.png",
		prompt: "mock",
		duration_sec: 7,
		aspect: "9:16",
		workspace_id: "video-test",
		project_id: "project",
		provider_id: "sandbox",
		provider_source: "workspace",
		idempotency_key: "roundtrip",
	};
	const submit = (value: unknown, token = "video-test-token") =>
		app.request("/video", {
			method: "POST",
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			body: JSON.stringify(value),
		});
	expect((await submit(body, "wrong")).status).toBe(401);
	expect((await submit({ ...body, image_url: "workspaces/other/image/a.png" })).status).toBe(400);
	const submitted = await submit(body);
	expect(submitted.status).toBe(202);
	const { job_id: id } = await submitted.json();
	expect((await (await submit(body)).json()).job_id).toBe(id);
	expect((await submit({ ...body, duration_sec: 2 })).status).toBe(409);
	const runtime = getGenerationRuntime();
	const job = getJob(id)!;
	const result = await runtime.generate({
		jobId: id,
		kind: "video",
		prompt: job.prompt,
		styleJson: job.style_json!,
		idempotencyKey: id,
		workspaceId: "video-test",
		providerId: "sandbox",
		providerSource: "workspace",
	});
	await runtime.persist({ jobId: id, workspaceId: "video-test", result });
	const done = getJob(id)!;
	expect(done).toMatchObject({
		status: "done",
		duration_sec: 4,
		storage_content_type: "video/mp4",
		provider_id: "sandbox",
		cost: 0,
	});
	expect(done.storage_key).toStartWith("workspaces/video-test/video/");
	expect((await getMedia(done.storage_key!)).size).toBeGreaterThan(0);
	const bytes = Buffer.from(await (await getMedia(done.storage_key!)).arrayBuffer());
	const boxes: string[] = [];
	for (let offset = 0; offset + 8 <= bytes.length;) {
		const size = bytes.readUInt32BE(offset);
		boxes.push(bytes.toString("ascii", offset + 4, offset + 8));
		if (!size) break;
		offset += size;
	}
	expect(boxes.indexOf("moov")).toBeGreaterThanOrEqual(0);
	expect(boxes.indexOf("moov")).toBeLessThan(boxes.indexOf("mdat"));
	expect(done.poster_storage_key).toStartWith("workspaces/video-test/image/");
	expect(done.poster_storage_content_type).toBe("image/jpeg");
	expect((await getMedia(done.poster_storage_key!)).size).toBe(done.poster_storage_size!);
	expect((await app.request(`/jobs/${id}`)).status).toBe(401);
	const poll = await app.request(`/jobs/${id}`, {
		headers: { authorization: "Bearer video-test-token" },
	});
	expect(await poll.json()).toMatchObject({
		kind: "video",
		status: "done",
		duration_sec: 4,
		model: "sandbox-mp4",
		poster_storage_key: done.poster_storage_key,
		poster_storage_content_type: "image/jpeg",
	});
	expect((await (await submit(body)).json()).job_id).toBe(id);
	await expect(
		runtime.persist({
			jobId: id,
			workspaceId: "video-test",
			result: { path: join(dir, "absent.mp4"), durationSec: 4 },
		}),
	).rejects.toThrow("missing");
	await Bun.write(join(dir, "partial.mp4"), "invalid");
	await expect(
		runtime.persist({
			jobId: id,
			workspaceId: "video-test",
			result: { path: join(dir, "partial.mp4"), durationSec: 4 },
		}),
	).rejects.toThrow();
	await deleteMedia(done.storage_key!);
	await deleteMedia(done.poster_storage_key!);
}, 20_000);
