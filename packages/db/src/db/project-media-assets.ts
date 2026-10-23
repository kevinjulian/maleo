/* A project's media library (`p1-media-library`): one row per asset, owned by the
 * server and changed only by commands in the project command log. The library is
 * the rows in `position` order, newest first; `position` counts up from the
 * oldest asset, so admitting one (a prepend) moves no other row.
 *
 * Every writer holds the `storyboard-version:<project>` lock, the one the command
 * log issues sequences under, so a library change and its log entry are one
 * serialized step. A project saved before the rows existed has its stored list
 * imported the first time its library is read (D5). */
import { admitAsset, admitMedia, setMediaAssets } from "@maleo/shared/editor/commands";
import { storedMediaLibrary, type MediaAsset } from "@maleo/shared/editor/storyboard-scope";
import { openDb } from "./connection.ts";
import { serialize, type Db } from "./handle.ts";
import { recordCommandEntry } from "./project-commands.ts";
import { parseJsonValue } from "./row-json.ts";

const lockOf = (projectId: string): string => `storyboard-version:${projectId}`;

async function libraryRows(db: Db, projectId: string): Promise<MediaAsset[]> {
	const rows = await db.all<{ asset_json: string }>(
		`SELECT asset_json FROM project_media_assets WHERE project_id = ? ORDER BY position DESC`,
		[projectId],
	);
	return rows
		.map((row) => parseJsonValue<MediaAsset | null>(row.asset_json, null))
		.filter((asset): asset is MediaAsset => asset !== null);
}

/** Write the rows that differ between `before` (the stored library) and `after`.
 *  The caller holds the project lock. Throws on two assets sharing a URL. */
export async function applyMediaLibraryChange(
	tx: Db,
	projectId: string,
	before: readonly MediaAsset[],
	after: readonly MediaAsset[],
	now: number = Date.now(),
): Promise<void> {
	if (tx.dialect !== "postgres") return;
	const stored = new Map(
		before.map((asset, index) => [
			asset.id,
			{ json: JSON.stringify(asset), position: before.length - 1 - index },
		]),
	);
	const kept = new Set(after.map((asset) => asset.id));
	const removed = before.filter((asset) => !kept.has(asset.id)).map((asset) => asset.id);
	if (removed.length)
		await tx.run(
			`DELETE FROM project_media_assets WHERE project_id = ? AND id IN (${removed.map(() => "?").join(",")})`,
			[projectId, ...removed],
		);
	for (const [index, asset] of after.entries()) {
		const json = JSON.stringify(asset);
		const position = after.length - 1 - index;
		const prior = stored.get(asset.id);
		if (!prior)
			await tx.run(
				`INSERT INTO project_media_assets (project_id, id, url, asset_json, position, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[projectId, asset.id, asset.url, json, position, now, now],
			);
		else if (prior.json !== json || prior.position !== position)
			await tx.run(
				`UPDATE project_media_assets SET url = ?, asset_json = ?, position = ?, updated_at = ?
				 WHERE project_id = ? AND id = ?`,
				[asset.url, json, position, now, projectId, asset.id],
			);
	}
}

/** Import the project's stored list into rows once (D5). The caller holds the lock;
 *  the flag is re-read under it, so concurrent first reads import once. */
async function importStoredLibrary(tx: Db, projectId: string): Promise<void> {
	const project = await tx.get<{ at: number | null; editor_state_json: string | null }>(
		`SELECT media_library_imported_at AS at, editor_state_json FROM content_projects WHERE id = ?`,
		[projectId],
	);
	if (!project || project.at !== null) return;
	const head = await tx.get<{ storyboard_json: string }>(
		`SELECT storyboard_json FROM content_storyboards WHERE project_id = ? ORDER BY version DESC LIMIT 1`,
		[projectId],
	);
	const list = storedMediaLibrary(
		parseJsonValue<unknown>(project.editor_state_json, null),
		parseJsonValue<unknown>(head?.storyboard_json ?? null, null),
	);
	const now = Date.now();
	await applyMediaLibraryChange(tx, projectId, [], list, now);
	await tx.run(`UPDATE content_projects SET media_library_imported_at = ? WHERE id = ?`, [
		now,
		projectId,
	]);
}

/** The library, for a caller already holding the project lock (a command
 *  submission, a version write). Imports the stored list first when it has not been. */
export async function lockedMediaLibrary(tx: Db, projectId: string): Promise<MediaAsset[]> {
	if (tx.dialect !== "postgres") return [];
	await importStoredLibrary(tx, projectId);
	return libraryRows(tx, projectId);
}

/** The project's library. Takes the lock only to import a stored list. */
export async function projectMediaLibrary(
	projectId: string,
	db: Db = openDb(),
): Promise<MediaAsset[]> {
	if (db.dialect !== "postgres") return [];
	const project = await db.get<{ at: number | null }>(
		`SELECT media_library_imported_at AS at FROM content_projects WHERE id = ?`,
		[projectId],
	);
	if (!project) return [];
	if (project.at === null)
		await db.transaction(async (tx) => {
			await serialize(tx, lockOf(projectId));
			await importStoredLibrary(tx, projectId);
		});
	return libraryRows(db, projectId);
}

/** What admitting one asset decided: the identity the library holds it under. */
export interface LibraryAdmission {
	readonly id: string;
	readonly added: boolean;
}

/** Admit one asset for a server-side writer (an import finishing, a generator)
 *  and record a versionless `media.admit` entry (D3). An asset whose id or URL is
 *  already held adds nothing — except that a finished import completes a held
 *  asset of its id that has no `importedSource`, with a `media.update` entry.
 *  Null when the project does not exist. */
export async function admitProjectMediaAsset(
	projectId: string,
	asset: MediaAsset,
	db: Db = openDb(),
	actor = "system",
): Promise<LibraryAdmission | null> {
	if (db.dialect !== "postgres") return null;
	return db.transaction(async (tx) => {
		await serialize(tx, lockOf(projectId));
		const exists = await tx.get(`SELECT 1 AS ok FROM content_projects WHERE id = ?`, [projectId]);
		if (!exists) return null;
		const before = await lockedMediaLibrary(tx, projectId);
		const held = before.find((item) => item.id === asset.id);
		if (held) {
			/* A client admitted the upload while it was still importing; the finished
			 * import completes that asset in place, keeping what the client set. */
			if (held.importedSource || !asset.importedSource) return { id: asset.id, added: false };
			const after = before.map((item) => (item === held ? { ...held, ...asset } : item));
			const now = Date.now();
			await applyMediaLibraryChange(tx, projectId, before, after, now);
			await recordCommandEntry(tx, {
				project_id: projectId,
				version: null,
				commands: [{ command: setMediaAssets(after) }],
				actor_type: actor,
				created_at: now,
			});
			return { id: asset.id, added: false };
		}
		const admission = admitAsset(before, asset);
		if (!admission.added) return { id: admission.id, added: false };
		const now = Date.now();
		await applyMediaLibraryChange(tx, projectId, before, admission.assets, now);
		await recordCommandEntry(tx, {
			project_id: projectId,
			version: null,
			commands: [{ command: admitMedia(asset) }],
			actor_type: actor,
			created_at: now,
		});
		return { id: asset.id, added: true };
	});
}
