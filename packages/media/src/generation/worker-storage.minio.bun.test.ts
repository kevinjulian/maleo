import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const endpoint = process.env.MALEO_MEDIA_TEST_ENDPOINT;
const run = endpoint ? test : test.skip;

run("sandbox worker output remains readable after worker process replacement", async () => {
	const root = await mkdtemp(join(tmpdir(), "maleo-worker-minio-"));
	const prior = { ...process.env };
	let key: string | undefined;
	try {
		Object.assign(process.env, {
			GEN_WORKER_DB: join(root, "gen-worker.sqlite"),
			CACHE_DIR: join(root, "cache"),
			MALEO_SANDBOX: "1",
			MALEO_MEDIA_STORAGE_BACKEND: "s3",
			MALEO_MEDIA_S3_BUCKET: process.env.MALEO_MEDIA_TEST_BUCKET ?? "maleo-test",
			MALEO_MEDIA_S3_ENDPOINT: endpoint,
			MALEO_MEDIA_S3_PUBLIC_ENDPOINT: endpoint,
			MALEO_MEDIA_S3_REGION: "us-east-1",
			MALEO_MEDIA_S3_ACCESS_KEY_ID: process.env.MALEO_MEDIA_TEST_ACCESS_KEY ?? "maleoapp",
			MALEO_MEDIA_S3_SECRET_ACCESS_KEY: process.env.MALEO_MEDIA_TEST_SECRET_KEY ?? "maleoappsecret",
		});
		const { createJob, getJob } = await import("./store.ts");
		const { registerWorkerRuntime } = await import("./impl.ts");
		const { getGenerationRuntime } = await import("./runtime.ts");
		const { deleteMedia, getMedia } = await import("@maleo/storage");
		const job = createJob("image", "red square", undefined, { providerId: "sandbox" });
		registerWorkerRuntime();
		const runtime = getGenerationRuntime();
		const result = await runtime.generate({
			jobId: job.id,
			kind: "image",
			prompt: "red square",
			idempotencyKey: job.id,
			workspaceId: "worker-test",
			providerId: "sandbox",
		});
		await runtime.persist({ jobId: job.id, workspaceId: "worker-test", result });
		key = getJob(job.id)?.storage_key ?? undefined;
		// Keyed by the workspace name itself, then kind, then a per-write uuid.
		expect(key).toMatch(/^workspaces\/worker-test\/image\/[0-9a-f-]{36}-[A-Za-z0-9_.-]+\.png$/);
		const pngMagic = [137, 80, 78, 71, 13, 10, 26, 10];
		expect(
			Array.from(new Uint8Array(await (await getMedia(key!)).arrayBuffer()).slice(0, 8)),
		).toEqual(pngMagic);
		const child = Bun.spawn(
			[
				"bun",
				"-e",
				`import { getJob } from "./packages/media/src/generation/store.ts"; import { getMedia } from "./packages/storage/src/storage.ts"; const row = getJob(${JSON.stringify(job.id)}); if (!row?.storage_key) throw new Error("missing durable job"); console.log([...new Uint8Array(await (await getMedia(row.storage_key)).arrayBuffer()).slice(0, 8)].join(","));`,
			],
			{
				cwd: join(import.meta.dir, "../../../.."),
				env: process.env,
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const stdout = await new Response(child.stdout).text();
		const stderr = await new Response(child.stderr).text();
		expect(await child.exited, stderr).toBe(0);
		expect(stdout.trim()).toBe(pngMagic.join(","));
		await deleteMedia(key!);
		key = undefined;
	} finally {
		if (key) {
			const { deleteMedia } = await import("@maleo/storage");
			await deleteMedia(key);
		}
		for (const name of Object.keys(process.env))
			if (!(name in prior) && name !== "MALEO_DATA_DIR") delete process.env[name];
		Object.assign(process.env, prior);
		await rm(root, { recursive: true, force: true });
	}
});
