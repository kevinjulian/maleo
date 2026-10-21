import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	findLegacyMediaForUser,
	getMediaObject,
	linkLegacyMedia,
	registerMediaObject,
} from "../../src/db/media-objects.ts";
import { openTestDb } from "../../src/db/handle-testing.ts";
import { addWorkspaceMember } from "../../src/db/workspace-members.ts";

const hash = "a".repeat(64);
const key = (workspace: string, kind: string, name = "shot.png", project?: string) =>
	`workspaces/${workspace}/${kind}/${project ? `${project}/` : ""}${randomUUID()}-${name}`;

test("each write is its own identity, and a key cannot claim another owner", async () => {
	const t = await openTestDb("postgres");
	const db = t.db;
	const base = {
		workspace: "one",
		kind: "image" as const,
		hash,
		content_type: "image/png",
		size: 5,
	};

	/* Identical bytes, concurrent writes: sixteen distinct objects. Keys carry a
	 * per-write uuid, so there is nothing to converge on — the tradeoff the
	 * maintainer chose over content addressing, which shared one row here. */
	const rows = await Promise.all(
		Array.from({ length: 16 }, async () =>
			registerMediaObject({ ...base, storage_key: key("one", "image") }, db),
		),
	);
	expect(new Set(rows.map((row) => row.id)).size).toBe(16);
	expect((await db.get<{ n: number }>("SELECT count(*) AS n FROM media_objects"))?.n).toBe(16);
	expect(rows[0]!.id).not.toContain("one");
	expect((await getMediaObject(rows[0]!.id, db))?.workspace).toBe("one");

	// Content type is metadata; nothing about a second write consults the first.
	const other = await registerMediaObject(
		{ ...base, content_type: "application/octet-stream", storage_key: key("one", "image") },
		db,
	);
	expect(other.content_type).toBe("application/octet-stream");

	/* The key is no longer derivable from the row, so what is enforced is that
	 * its owner segments are the ones being claimed. Without this a caller could
	 * register a key under another workspace's prefix and read its bytes. */
	await expect(
		registerMediaObject({ ...base, storage_key: key("two", "image") }, db),
	).rejects.toThrow("invalid media registry input");
	await expect(
		registerMediaObject({ ...base, storage_key: key("one", "audio") }, db),
	).rejects.toThrow("invalid media registry input");
	for (const malformed of [
		`workspaces/one/image/${hash}`, // the retired content-addressed shape
		"workspaces/one/image/not-a-uuid-shot.png",
		`workspaces/one/image/${randomUUID()}-../escape.png`,
		`workspaces/one/image/${randomUUID()}-`,
		`workspaces/one/sidecar/${randomUUID()}-shot.png`,
	]) {
		await expect(registerMediaObject({ ...base, storage_key: malformed }, db)).rejects.toThrow(
			"invalid media registry input",
		);
	}

	// A project-scoped key is accepted and keeps the project in the path.
	const scoped = await registerMediaObject(
		{ ...base, storage_key: key("one", "image", "hero.png", "proj-1") },
		db,
	);
	expect(scoped.storage_key).toContain("/image/proj-1/");

	/* One stored object registered twice is one identity — the API re-resolves a
	 * finished render on every poll with the key the video service already wrote. */
	expect((await registerMediaObject({ ...base, storage_key: rows[0]!.storage_key }, db)).id).toBe(
		rows[0]!.id,
	);
	// 16 racing writes, one differing content type, one project-scoped: no more.
	expect((await db.get<{ n: number }>("SELECT count(*) AS n FROM media_objects"))?.n).toBe(18);
	// But that same key naming different bytes is corruption, not a re-register.
	await expect(
		registerMediaObject({ ...base, size: 6, storage_key: rows[0]!.storage_key }, db),
	).rejects.toThrow("collision");
	await expect(
		registerMediaObject({ ...base, hash: "b".repeat(64), storage_key: rows[0]!.storage_key }, db),
	).rejects.toThrow("collision");

	await linkLegacyMedia("/uploads/old.png", "one", rows[0]!.id, db);
	await addWorkspaceMember({ workspace: "one", user_id: "member" }, db);
	expect(await findLegacyMediaForUser("/uploads/old.png", "member", db)).toEqual({
		mapped: true,
		mediaId: rows[0]!.id,
	});
	expect(await findLegacyMediaForUser("/uploads/old.png", "stranger", db)).toEqual({
		mapped: true,
		mediaId: null,
	});
	expect(await findLegacyMediaForUser("/uploads/unknown.png", "member", db)).toEqual({
		mapped: false,
		mediaId: null,
	});
	await t.close();
});
