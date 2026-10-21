import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerMediaObject } from "../packages/db/src/db/media-objects";
import { openTestDb } from "../packages/db/src/db/handle-testing";
import { getMedia, putMedia } from "../packages/storage/src/storage.ts";
import { cleanupMedia } from "./cleanup-media";

const prior = {
	dir: process.env.MALEO_DATA_DIR,
	mode: process.env.MALEO_MEDIA_STORAGE_BACKEND,
	env: process.env.NODE_ENV,
};
let root: string | undefined;
afterEach(async () => {
	for (const [key, value] of [
		["MALEO_DATA_DIR", prior.dir],
		["MALEO_MEDIA_STORAGE_BACKEND", prior.mode],
		["NODE_ENV", prior.env],
	] as const) {
		if (key === "MALEO_DATA_DIR")
			process.env.MALEO_DATA_DIR = value ?? join(tmpdir(), "maleo-test-data-fallback");
		else if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	if (root) await rm(root, { recursive: true, force: true });
});

test("cleanup finds an unregistered stored object and honors grace period", async () => {
	root = await mkdtemp(join(tmpdir(), "maleo-media-orphan-"));
	process.env.MALEO_DATA_DIR = root;
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	delete process.env.NODE_ENV;
	const runtime = await openTestDb("postgres");
	const registry = runtime.db;
	const worker = new Database(":memory:");
	worker.exec("CREATE TABLE jobs (id TEXT PRIMARY KEY, storage_key TEXT)");
	const video = new Database(":memory:");
	video.exec("CREATE TABLE render_jobs (id TEXT PRIMARY KEY, product_json TEXT)");
	const stored = await putMedia({
		workspace: "team",
		kind: "image",
		body: new Blob(["orphan"]),
		contentType: "image/png",
	});
	const input = { registry, worker, video, apply: true, writesStopped: true, graceMs: 1000 };
	expect((await cleanupMedia(input)).orphaned).toBe(1);
	expect(await (await getMedia(stored.key)).text()).toBe("orphan");
	worker.run("INSERT INTO jobs VALUES ('j', ?)", [stored.key]);
	expect((await cleanupMedia({ ...input, now: Date.now() + 2000 })).deleted).toBe(0);
	worker.run("DELETE FROM jobs");
	expect((await cleanupMedia({ ...input, now: Date.now() + 2000 })).deleted).toBe(1);
	await expect(getMedia(stored.key)).rejects.toThrow("missing");
	await runtime.close();
	worker.close();
	video.close();
});

test("cleanup preserves shared references and active jobs, then removes unreachable bytes", async () => {
	root = await mkdtemp(join(tmpdir(), "maleo-media-gc-"));
	process.env.MALEO_DATA_DIR = root;
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	delete process.env.NODE_ENV;
	// The registry is the runtime database: a reference that exists only there
	// must keep its bytes.
	const runtime = await openTestDb("postgres");
	const registry = runtime.db;
	const worker = new Database(":memory:");
	worker.exec("CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT, storage_key TEXT)");
	const video = new Database(":memory:");
	video.exec("CREATE TABLE render_jobs (id TEXT PRIMARY KEY, product_json TEXT)");
	const a = await putMedia({
		workspace: "team",
		kind: "image",
		body: new Blob(["shared"]),
		contentType: "image/png",
	});
	const b = await putMedia({
		workspace: "team",
		kind: "image",
		body: new Blob(["job"]),
		contentType: "image/png",
	});
	const rowA = await registerMediaObject(
		{
			workspace: "team",
			kind: "image",
			hash: a.hash,
			storage_key: a.key,
			content_type: a.contentType,
			size: a.size,
		},
		registry,
	);
	await registerMediaObject(
		{
			workspace: "team",
			kind: "image",
			hash: b.hash,
			storage_key: b.key,
			content_type: b.contentType,
			size: b.size,
		},
		registry,
	);
	await registry.run("UPDATE media_objects SET created_at = 1");
	for (const id of ["p1", "p2"]) {
		await registry.run(
			"INSERT INTO content_projects (id, title, type, status, created_at, updated_at, editor_state_json) VALUES (?, 't', 'video', 'draft', 1, 1, ?)",
			[id, JSON.stringify({ image: `/api/media/${rowA.id}` })],
		);
	}
	worker.run("INSERT INTO jobs VALUES ('j', 'processing', ?)", [b.key]);
	const input = {
		registry,
		worker,
		video,
		apply: true,
		writesStopped: true,
		now: 1000,
		graceMs: 10,
	};
	expect((await cleanupMedia(input)).deleted).toBe(0);
	await registry.run("DELETE FROM content_projects WHERE id = 'p1'");
	expect((await cleanupMedia(input)).deleted).toBe(0);
	worker.run("DELETE FROM jobs WHERE id = 'j'");
	expect((await cleanupMedia(input)).deleted).toBe(1);
	await expect(getMedia(b.key)).rejects.toThrow("missing");
	expect(await (await getMedia(a.key)).text()).toBe("shared");
	await registry.run("DELETE FROM content_projects WHERE id = 'p2'");
	expect((await cleanupMedia(input)).deleted).toBe(1);
	await expect(getMedia(a.key)).rejects.toThrow("missing");
	await runtime.close();
	worker.close();
	video.close();
});
