import { afterEach, expect, test } from "bun:test";
import { openTestDb } from "@maleo/db/handle-testing";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMedia, listMedia } from "@maleo/storage";
import { storeManagedMedia } from "./media-storage";

const keys = [
	"MALEO_DATA_DIR",
	"MALEO_MEDIA_STORAGE_BACKEND",
	"MALEO_MEDIA_S3_BUCKET",
	"MALEO_MEDIA_S3_ENDPOINT",
	"MALEO_MEDIA_S3_PUBLIC_ENDPOINT",
	"MALEO_MEDIA_S3_REGION",
	"MALEO_MEDIA_S3_ACCESS_KEY_ID",
	"MALEO_MEDIA_S3_SECRET_ACCESS_KEY",
	"NODE_ENV",
] as const;
const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
let dir: string | undefined;
afterEach(async () => {
	for (const key of keys) {
		const value = prior[key];
		if (key === "MALEO_DATA_DIR")
			process.env.MALEO_DATA_DIR = value ?? join(tmpdir(), "maleo-test-data-fallback");
		else if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	if (dir) await rm(dir, { recursive: true, force: true });
});

test("store failure creates no registry success and cannot fall back to disk", async () => {
	dir = await mkdtemp(join(tmpdir(), "maleo-media-fail-"));
	process.env.MALEO_DATA_DIR = dir;
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "s3";
	process.env.MALEO_MEDIA_S3_BUCKET = "test";
	process.env.MALEO_MEDIA_S3_ENDPOINT = "http://127.0.0.1:1";
	process.env.MALEO_MEDIA_S3_PUBLIC_ENDPOINT = "http://127.0.0.1:1";
	process.env.MALEO_MEDIA_S3_REGION = "us-east-1";
	process.env.MALEO_MEDIA_S3_ACCESS_KEY_ID = "test";
	process.env.MALEO_MEDIA_S3_SECRET_ACCESS_KEY = "test";
	const t = await openTestDb("postgres", { migrated: false });
	const db = t.db;
	await db.exec(
		"CREATE TABLE media_objects (id text PRIMARY KEY, workspace text, kind text, hash text, storage_key text, content_type text, size bigint, created_at bigint)",
	);
	await expect(
		storeManagedMedia({
			workspace: "team",
			kind: "image",
			body: new Uint8Array([1]),
			contentType: "image/png",
			db,
		}),
	).rejects.toThrow();
	expect((await db.get<{ n: number }>("SELECT count(*) n FROM media_objects"))!.n).toBe(0);
	expect(await Bun.file(join(dir, "media")).exists()).toBe(false);
	/* A well-formed key, so this exercises the unreachable store rather than the
	 * key validator — reading it must fail without falling back to disk. */
	await expect(getMedia(`workspaces/team/image/${randomUUID()}-image.png`)).rejects.toThrow();
	await t.close();
});

test("registry failure leaves discoverable orphan bytes without a returned URL", async () => {
	dir = await mkdtemp(join(tmpdir(), "maleo-media-fail-"));
	process.env.MALEO_DATA_DIR = dir;
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	delete process.env.NODE_ENV;
	const t = await openTestDb("postgres", { migrated: false }); // deliberately has no registry table
	const db = t.db;
	const bytes = new Uint8Array([2, 3]);
	await expect(
		storeManagedMedia({
			workspace: "team",
			kind: "image",
			body: bytes,
			contentType: "image/png",
			db,
		}),
	).rejects.toThrow();
	/* Keys are unique per write, so the orphan's key is not predictable from its
	 * bytes — it is found by listing the store, which is how cleanup discovers an
	 * object no registry row claims. The bytes are still there to be collected. */
	const orphans = await Array.fromAsync(listMedia());
	expect(orphans).toHaveLength(1);
	expect(orphans[0]!.key).toMatch(/^workspaces\/team\/image\/[0-9a-f-]{36}-image\.png$/);
	expect(new Uint8Array(await (await getMedia(orphans[0]!.key)).arrayBuffer())).toEqual(bytes);
	await t.close();
});
