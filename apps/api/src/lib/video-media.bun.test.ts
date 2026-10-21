import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTestDb } from "@maleo/db/handle-testing";
import { getMediaObject } from "@maleo/db/media-objects";
import { putMedia, deleteMedia } from "@maleo/storage";
import type { RenderJob } from "./video-client.ts";
import { resolveRenderMedia } from "./video-media.ts";

const prior = {
	mode: process.env.MALEO_MEDIA_STORAGE_BACKEND,
	dir: process.env.MALEO_DATA_DIR,
	env: process.env.NODE_ENV,
};
let root: string | undefined;
afterEach(async () => {
	for (const [key, value] of [
		["MALEO_MEDIA_STORAGE_BACKEND", prior.mode],
		["MALEO_DATA_DIR", prior.dir],
		["NODE_ENV", prior.env],
	] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	if (root) await rm(root, { recursive: true, force: true });
});

test("render result becomes stable owned media only after bytes exist", async () => {
	root = await mkdtemp(join(tmpdir(), "maleo-render-storage-"));
	process.env.MALEO_DATA_DIR = root;
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	delete process.env.NODE_ENV;
	const t = await openTestDb("postgres");
	const db = t.db;
	const stored = await putMedia({
		workspace: "team",
		kind: "video",
		body: new Blob(["video"]),
		contentType: "video/mp4",
	});
	const job: RenderJob = {
		id: "j",
		product_json: "{}",
		preset: "storyboard-wide",
		status: "done",
		output_path: null,
		error: null,
		cost_usd: null,
		progress: 1,
		backend: "local",
		created_at: 1,
		started_at: 1,
		finished_at: 2,
		workspace: "team",
		output_storage: JSON.stringify(stored),
	};
	const poster = await putMedia({
		workspace: "team",
		kind: "image",
		body: new Blob(["poster"]),
		contentType: "image/jpeg",
	});
	job.thumbnail_storage = JSON.stringify(poster);
	const resolved = await resolveRenderMedia(job, db);
	expect(resolved.thumbnail_url).toMatch(/^\/api\/media\/[0-9a-f-]{36}$/);
	expect((await getMediaObject(resolved.thumbnail_url!.split("/").at(-1)!, db))?.kind).toBe(
		"image",
	);
	expect(resolved.output_url).toMatch(/^\/api\/media\/[0-9a-f-]{36}$/);
	expect((await getMediaObject(resolved.output_url!.split("/").at(-1)!, db))?.workspace).toBe(
		"team",
	);
	const foreignPoster = await putMedia({
		workspace: "foreign",
		kind: "image",
		body: new Blob(["foreign poster"]),
		contentType: "image/jpeg",
	});
	expect(
		(await resolveRenderMedia({ ...job, thumbnail_storage: JSON.stringify(foreignPoster) }, db))
			.thumbnail_url,
	).toBe(null);
	expect(
		(await resolveRenderMedia({ ...job, thumbnail_storage: undefined }, db)).thumbnail_url,
	).toBe(null);
	const again = await resolveRenderMedia(job, db);
	expect(again.output_url).toBe(resolved.output_url);
	await expect(resolveRenderMedia({ ...job, workspace: "other" }, db)).rejects.toThrow(
		"invalid media registry input",
	);
	await deleteMedia(stored.key);
	const missing = await resolveRenderMedia(job, db);
	expect(missing.output_url).toBe(null);
	expect(missing.thumbnail_url).toBe(resolved.thumbnail_url);
	await t.close();
});
