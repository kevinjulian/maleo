/** Conservative reachability cleanup. Requires stopped writers, the runtime
 * database (which holds the media registry), and snapshots of the worker and
 * video databases; an incomplete scan never deletes bytes. */
import { textOf } from "../packages/shared/src/object-keys.ts";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Db } from "../packages/db/src/db/handle";
import { deleteMedia, listMedia } from "../packages/storage/src/storage.ts";

const ID = /\/api\/media\/([0-9a-f-]{36})/g;
const KEY =
	/workspaces\/[A-Za-z0-9_-]+\/(?:image|audio|video|manifest|file)\/(?:[A-Za-z0-9_-]+\/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_.-]{1,100}/g;
const DEFAULT_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

function scanText(value: string, ids: Set<string>, keys: Set<string>): void {
	for (const match of value.matchAll(ID)) ids.add(match[1]!);
	for (const match of value.matchAll(KEY)) keys.add(match[0]);
}

/* Every table in the runtime schema, each row read as its text form: the
 * patterns match only characters that row text never escapes. */
async function scanRuntime(db: Db, ids: Set<string>, keys: Set<string>): Promise<void> {
	const tables = await db.all<{ name: string }>(
		"SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'",
	);
	for (const { name } of tables) {
		if (name === "media_objects") continue; // registry identity is not a reference
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`unsafe table name: ${name}`);
		for (const row of await db.all<{ v: string }>(`SELECT t::text AS v FROM "${name}" t`))
			scanText(row.v, ids, keys);
	}
	for (const row of await db.all<{ id: string }>("SELECT media_id AS id FROM legacy_media_links"))
		ids.add(row.id);
}

function scanSnapshot(db: Database, ids: Set<string>, keys: Set<string>): void {
	const tables = db
		.query<{ name: string }, []>(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
		)
		.all();
	for (const { name } of tables) {
		if (name === "media_objects") continue; // registry identity is not a reference
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`unsafe table name: ${name}`);
		/* Every column of an arbitrary table, as SQLite stores it. */
		for (const row of db
			.query<Record<string, string | number | bigint | Uint8Array | null>, []>(
				`SELECT * FROM "${name}"`,
			)
			.iterate()) {
			for (const raw of Object.values(row)) {
				if (raw == null) continue;
				scanText(
					raw instanceof Uint8Array ? Buffer.from(raw).toString("utf8") : textOf(raw),
					ids,
					keys,
				);
			}
		}
	}
}

export async function cleanupMedia(input: {
	/** The runtime database; its media_objects table is the registry. */
	registry: Db;
	worker: Database;
	video: Database;
	apply: boolean;
	writesStopped: boolean;
	now?: number;
	graceMs?: number;
}): Promise<{
	scanned: number;
	retained: number;
	candidates: number;
	orphaned: number;
	deleted: number;
}> {
	if (input.apply && !input.writesStopped)
		throw new Error("media cleanup requires stopped writers");
	const ids = new Set<string>();
	const keys = new Set<string>();
	// Any failed table read aborts before physical deletion. Worker and video DBs
	// must be supplied, including active jobs and their source/output metadata.
	await scanRuntime(input.registry, ids, keys);
	scanSnapshot(input.worker, ids, keys);
	scanSnapshot(input.video, ids, keys);
	// Finish storage inventory before any deletion. A failed listing must leave
	// every byte intact, just like a failed database scan.
	const objects = await Array.fromAsync(listMedia());
	const cutoff = (input.now ?? Date.now()) - (input.graceMs ?? DEFAULT_GRACE_MS);
	let scanned = 0,
		retained = 0,
		candidates = 0,
		orphaned = 0,
		deleted = 0;
	const registeredKeys = new Set<string>();
	for (const row of await input.registry.all<{
		id: string;
		storage_key: string;
		created_at: number;
	}>("SELECT id, storage_key, created_at FROM media_objects")) {
		scanned++;
		registeredKeys.add(row.storage_key);
		if (ids.has(row.id) || keys.has(row.storage_key) || row.created_at > cutoff) {
			retained++;
			continue;
		}
		candidates++;
		if (!input.apply) continue;
		await deleteMedia(row.storage_key);
		await input.registry.run("DELETE FROM media_objects WHERE id = ? AND storage_key = ?", [
			row.id,
			row.storage_key,
		]);
		deleted++;
	}
	for (const object of objects) {
		if (registeredKeys.has(object.key)) continue;
		orphaned++;
		if (keys.has(object.key) || !Number.isFinite(object.modifiedAt) || object.modifiedAt > cutoff) {
			retained++;
			continue;
		}
		candidates++;
		if (!input.apply) continue;
		await deleteMedia(object.key);
		deleted++;
	}
	return { scanned, retained, candidates, orphaned, deleted };
}

if (import.meta.main) {
	const valueAfter = (flag: string): string | undefined => {
		const index = process.argv.indexOf(flag);
		return index >= 0 ? process.argv[index + 1] : undefined;
	};
	const workerPath = valueAfter("--worker-db");
	const videoPath = valueAfter("--video-db");
	if (!workerPath || !videoPath || !existsSync(workerPath) || !existsSync(videoPath))
		throw new Error(
			"provide existing --worker-db and --video-db snapshots; incomplete scan retains all bytes",
		);
	const apply = process.argv.includes("--apply");
	const writesStopped = process.argv.includes("--writes-stopped");
	if (apply && !writesStopped)
		throw new Error(
			"--apply requires --writes-stopped after stopping API, worker, and video writes",
		);
	const { closeMaleoDb, databaseReady, openDb } = await import("../packages/db/src/db/connection");
	await databaseReady();
	const worker = new Database(resolve(workerPath), { readonly: true });
	const video = new Database(resolve(videoPath), { readonly: true });
	try {
		console.log(
			JSON.stringify(
				await cleanupMedia({ registry: openDb(), worker, video, apply, writesStopped }),
			),
		);
	} finally {
		worker.close();
		video.close();
		await closeMaleoDb();
	}
}
