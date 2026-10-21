import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMedia } from "../packages/storage/src/storage.ts";
import { migrateWorkerJobs } from "./migrate-worker-jobs.ts";

const prior = {
	dir: process.env.MALEO_DATA_DIR,
	mode: process.env.MALEO_MEDIA_STORAGE_BACKEND,
	env: process.env.NODE_ENV,
};
let root: string;
afterEach(async () => {
	for (const [name, value] of [
		["MALEO_DATA_DIR", prior.dir],
		["MALEO_MEDIA_STORAGE_BACKEND", prior.mode],
		["NODE_ENV", prior.env],
	] as const) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	if (root) await rm(root, { recursive: true, force: true });
});

test("worker cutover migrates owned bytes and retires unowned or missing results", async () => {
	root = await mkdtemp(join(tmpdir(), "maleo-worker-cutover-"));
	process.env.MALEO_DATA_DIR = join(root, "data");
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	delete process.env.NODE_ENV;
	const cacheDir = join(root, "cache");
	await mkdir(cacheDir);
	await writeFile(join(cacheDir, "owned.jpg"), new Uint8Array([1, 2, 3]));
	await writeFile(join(cacheDir, "orphan.png"), new Uint8Array([4, 5]));
	const main = new Database(":memory:");
	const worker = new Database(":memory:");
	main.exec(
		"CREATE TABLE image_ledger (job_id TEXT, workspace TEXT); CREATE TABLE image_jobs (job_id TEXT, workspace TEXT)",
	);
	worker.exec(
		"CREATE TABLE jobs (id TEXT PRIMARY KEY, kind TEXT, status TEXT, output_path TEXT, storage_key TEXT, storage_hash TEXT, storage_size INTEGER, storage_content_type TEXT, error TEXT)",
	);
	main.run("INSERT INTO image_ledger VALUES ('owned', 'team'), ('missing', 'team')");
	for (const [id, name] of [
		["owned", "owned.jpg"],
		["orphan", "orphan.png"],
		["missing", "missing.jpg"],
	]) {
		worker.run("INSERT INTO jobs (id,kind,status,output_path) VALUES (?, 'image', 'done', ?)", [
			id,
			join(cacheDir, name),
		]);
	}
	const input = { main, worker, cacheDir };
	expect(await migrateWorkerJobs({ ...input, apply: false })).toMatchObject({
		migrateable: 1,
		retiredUnowned: 1,
		retiredMissing: 1,
		migrated: 0,
		retired: 0,
	});
	expect(await migrateWorkerJobs({ ...input, apply: true })).toMatchObject({
		migrated: 1,
		retired: 2,
	});
	const owned = worker
		.query<{ storage_key: string; output_path: string | null; status: string }, []>(
			"SELECT storage_key,output_path,status FROM jobs WHERE id='owned'",
		)
		.get()!;
	expect(owned.status).toBe("done");
	expect(owned.output_path).toBeNull();
	expect(new Uint8Array(await (await getMedia(owned.storage_key)).arrayBuffer())).toEqual(
		new Uint8Array([1, 2, 3]),
	);
	expect(
		worker
			.query<{ status: string; error: string }, []>(
				"SELECT status,error FROM jobs WHERE id='orphan'",
			)
			.get(),
	).toMatchObject({ status: "failed", error: expect.stringContaining("no trusted workspace") });
	expect(
		worker
			.query<{ status: string; error: string }, []>(
				"SELECT status,error FROM jobs WHERE id='missing'",
			)
			.get(),
	).toMatchObject({ status: "failed", error: expect.stringContaining("missing") });
	expect(await migrateWorkerJobs({ ...input, apply: true })).toMatchObject({
		migrated: 0,
		retired: 0,
	});
	main.close();
	worker.close();
});
