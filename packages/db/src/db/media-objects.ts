import { randomUUID } from "node:crypto";
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";

export interface MediaObject {
	id: string;
	workspace: string;
	kind: "image" | "audio" | "video" | "manifest" | "file";
	hash: string;
	storage_key: string;
	content_type: string;
	size: number;
	created_at: number;
}

/* The key is no longer derivable from the row — it carries a per-write uuid — so
 * what is checked is that it is well formed AND that its owner segments are the
 * ones being claimed. That is the invariant that matters: without it a caller
 * could register a key under another workspace's prefix and read its bytes
 * through a row it owns. */
const KEY =
	/^workspaces\/([A-Za-z0-9_-]+)\/(image|audio|video|manifest|file)\/([A-Za-z0-9_-]+\/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_.-]{1,100}$/;

/** `id` is a client-minted identity an import publishes under; otherwise the registry mints one. */
export async function registerMediaObject(
	input: Pick<
		MediaObject,
		"workspace" | "kind" | "hash" | "storage_key" | "content_type" | "size"
	> & {
		id?: string;
	},
	db: Db = openDb(),
): Promise<MediaObject> {
	const owner = KEY.exec(input.storage_key);
	if (
		!input.workspace ||
		!/^[a-f0-9]{64}$/.test(input.hash) ||
		!input.content_type ||
		input.size < 0 ||
		!Number.isSafeInteger(input.size) ||
		!owner ||
		owner[1] !== input.workspace ||
		owner[2] !== input.kind
	) {
		throw new Error("invalid media registry input");
	}
	/* Idempotent on the key, not on the bytes. Identical bytes written twice get
	 * two keys and two identities — that is the point of per-write keys. But one
	 * stored object registered twice is one identity: the API re-resolves a
	 * finished render job on every poll, handing over the key the video service
	 * already wrote, and the second call must return the first row rather than
	 * collide on UNIQUE (storage_key). */
	await db.run(
		`INSERT INTO media_objects (id, workspace, kind, hash, storage_key, content_type, size, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (storage_key) DO NOTHING`,
		[
			input.id ?? randomUUID(),
			input.workspace,
			input.kind,
			input.hash,
			input.storage_key,
			input.content_type,
			input.size,
			Date.now(),
		],
	);
	const row = await db.get<MediaObject>(`SELECT * FROM media_objects WHERE storage_key = ?`, [
		input.storage_key,
	]);
	/* A key that comes back owned by someone else, or naming a different size or
	 * digest, is a key being reused for other bytes — corruption, not a re-register.
	 * Content type is excluded deliberately: the same bytes get one type from a
	 * provider response and another from a file extension, and failing on that
	 * disagreement would abort an import over nothing. */
	if (
		!row ||
		(input.id !== undefined && row.id !== input.id) ||
		row.workspace !== input.workspace ||
		row.kind !== input.kind ||
		row.hash !== input.hash ||
		row.size !== input.size
	) {
		throw new Error("media registry collision");
	}
	return row;
}

export async function getMediaObject(id: string, db: Db = openDb()): Promise<MediaObject | null> {
	return (await db.get<MediaObject>(`SELECT * FROM media_objects WHERE id = ?`, [id])) ?? null;
}

export function mediaObjectUrl(id: string): string {
	return `/api/media/${id}`;
}

export async function getLegacyMediaLink(
	path: string,
	workspace: string,
	db: Db = openDb(),
): Promise<string | null> {
	return (
		(
			await db.get<{ media_id: string }>(
				`SELECT media_id FROM legacy_media_links WHERE legacy_path = ? AND workspace = ?`,
				[path, workspace],
			)
		)?.media_id ?? null
	);
}

export async function linkLegacyMedia(
	path: string,
	workspace: string,
	mediaId: string,
	db: Db = openDb(),
): Promise<void> {
	if (
		!/^\/(uploads|files|api\/image-gen\/files)\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(path) ||
		!workspace ||
		!(await getMediaObject(mediaId, db))
	)
		throw new Error("invalid legacy media link");
	await db.run(
		`INSERT INTO legacy_media_links (legacy_path, workspace, media_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (legacy_path, workspace) DO NOTHING`,
		[path, workspace, mediaId, Date.now()],
	);
	if ((await getLegacyMediaLink(path, workspace, db)) !== mediaId)
		throw new Error("legacy media link collision");
}

/** Distinguish an unmigrated path from a migrated path this caller cannot read. */
export async function findLegacyMediaForUser(
	path: string,
	userId: string,
	db: Db = openDb(),
): Promise<{ mapped: boolean; mediaId: string | null }> {
	const rows = await db.all<{ media_id: string; allowed: number }>(
		`SELECT l.media_id, CASE WHEN EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace = l.workspace AND m.user_id = ?) THEN 1 ELSE 0 END AS allowed
		 FROM legacy_media_links l WHERE l.legacy_path = ? ORDER BY allowed DESC LIMIT 1`,
		[userId, path],
	);
	return rows[0]
		? { mapped: true, mediaId: rows[0].allowed ? rows[0].media_id : null }
		: { mapped: false, mediaId: null };
}
