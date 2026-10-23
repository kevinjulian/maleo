import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerMediaObject } from "@maleo/db/media-objects";
import { addWorkspaceMember } from "@maleo/db/workspace-members";
import { openTestDb } from "@maleo/db/handle-testing";
import { deleteMedia, putMedia } from "@maleo/storage";
import { createContentProject } from "@maleo/db/project-detail";
import { failProjectMediaImport, reserveProjectMediaImport } from "@maleo/db/media-imports";
import { mintMediaId } from "@maleo/shared";
import { serveMedia } from "./media.ts";

const oldBackend = process.env.MALEO_MEDIA_STORAGE_BACKEND;
const oldDataDir = process.env.MALEO_DATA_DIR;
let root: string | undefined;

afterEach(async () => {
	if (oldBackend === undefined) delete process.env.MALEO_MEDIA_STORAGE_BACKEND;
	else process.env.MALEO_MEDIA_STORAGE_BACKEND = oldBackend;
	process.env.MALEO_DATA_DIR = oldDataDir ?? join(tmpdir(), "maleo-test-data-fallback");
	if (root) await rm(root, { recursive: true, force: true });
});

test("member reads private media with byte ranges; non-member learns nothing", async () => {
	root = await mkdtemp(join(tmpdir(), "maleo-media-route-"));
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	process.env.MALEO_DATA_DIR = root;
	const t = await openTestDb("postgres");
	const db = t.db;
	await addWorkspaceMember({ workspace: "one", user_id: "member" }, db);
	const stored = await putMedia({
		workspace: "one",
		kind: "audio",
		body: new Blob(["abcdef"]),
		contentType: "audio/mpeg",
	});
	const row = await registerMediaObject(
		{
			workspace: "one",
			kind: "audio",
			hash: stored.hash,
			storage_key: stored.key,
			content_type: stored.contentType,
			size: stored.size,
		},
		db,
	);
	const full = await serveMedia(row.id, "member", null, db);
	expect(full.status).toBe(200);
	expect(full.headers.get("accept-ranges")).toBe("bytes");
	expect(full.headers.get("cache-control")).toBe("private, no-store");
	expect(await full.text()).toBe("abcdef");
	const partial = await serveMedia(row.id, "member", "bytes=1-3", db);
	expect(partial.status).toBe(206);
	expect(partial.headers.get("content-range")).toBe("bytes 1-3/6");
	expect(await partial.text()).toBe("bcd");
	const head = await serveMedia(row.id, "member", null, db, "HEAD");
	expect(head.status).toBe(200);
	expect(head.headers.get("content-length")).toBe("6");
	expect(await head.text()).toBe("");
	expect((await serveMedia(row.id, "stranger", null, db)).status).toBe(404);
	expect((await serveMedia("missing", "member", null, db)).status).toBe(404);
	await deleteMedia(stored.key);
	for (const method of ["GET", "HEAD"] as const) {
		const missing = await serveMedia(row.id, "member", null, db, method);
		expect(missing.status).toBe(404);
		expect(missing.headers.get("cache-control")).toBe("private, no-store");
	}
	await t.close();
});

test("a minted identity whose import has not finished reads as pending to members only", async () => {
	const t = await openTestDb("postgres");
	const db = t.db;
	try {
		await addWorkspaceMember({ workspace: "one", user_id: "member" }, db);
		const project = (await createContentProject({ title: "Pending", workspace: "one" }, db))!;
		const mediaId = mintMediaId();
		const { row } = await reserveProjectMediaImport(
			{
				workspace: "one",
				projectId: project.project.id,
				requestKey: mediaId,
				filename: "clip.mp4",
				kind: "video",
				uploadTimeoutMs: 60_000,
			},
			db,
		);
		const read = (user: string, method: "GET" | "HEAD" = "GET") =>
			serveMedia(mediaId, user, null, db, method);
		const pending = await read("member");
		expect(pending.status).toBe(409);
		expect(pending.headers.get("location")).toBeNull();
		expect(await pending.json()).toEqual({ error: "media_pending" });
		expect((await read("member", "HEAD")).status).toBe(409);
		const refusal = async (response: Response) => [response.status, await response.text()];
		const unknown = await refusal(await serveMedia(mintMediaId(), "stranger", null, db));
		expect(await refusal(await read("stranger"))).toEqual(unknown);
		await failProjectMediaImport(row, "broken", db);
		expect(await refusal(await read("member"))).toEqual(unknown);
		expect(await refusal(await read("stranger"))).toEqual(unknown);
	} finally {
		await t.close();
	}
});
