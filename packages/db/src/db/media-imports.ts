import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
	ImportedMediaKindSchema,
	isMediaId,
	StoredImportMediaSchema,
	ReadyImportedMediaSchema,
	type StoredImportMedia,
	type ReadyImportedMedia,
} from "@maleo/shared";
import { openDb } from "./connection.ts";
import { serialize, type Db } from "./handle.ts";

const importRow = z.object({
	id: z.string(),
	workspace: z.string(),
	project_id: z.string(),
	request_key: z.string(),
	media_id: z.string().nullable(),
	original_filename: z.string(),
	claimed_kind: ImportedMediaKindSchema,
	source_revision: z.string(),
	status: z.enum(["uploading", "processing", "ready", "failed", "cancelled"]),
	original_json: z.string().nullable(),
	worker_job_id: z.string().nullable(),
	asset_json: z.string().nullable(),
	error: z.string().nullable(),
	lease_until: z.number(),
	created_at: z.number(),
	updated_at: z.number(),
});
export type ProjectMediaImport = z.infer<typeof importRow>;
export const MEDIA_ID_CONFLICT = "Media identity already in use";

export interface ImportReservation {
	row: ProjectMediaImport;
	claimed: boolean;
}

export async function getProjectMediaImport(
	id: string,
	db: Db = openDb(),
): Promise<ProjectMediaImport | null> {
	const row = await db.get("SELECT * FROM project_media_imports WHERE id = ?", [id]);
	return row ? importRow.parse(row) : null;
}

export async function getImportByRequestKey(
	workspace: string,
	projectId: string,
	requestKey: string,
	db: Db = openDb(),
): Promise<ProjectMediaImport | null> {
	const row = await db.get(
		"SELECT * FROM project_media_imports WHERE workspace = ? AND project_id = ? AND request_key = ?",
		[workspace, projectId, requestKey],
	);
	return row ? importRow.parse(row) : null;
}

/** Client-minted identities of the project's imports that have not finished. */
export async function unfinishedImportMediaIds(
	workspace: string,
	projectId: string,
	db: Db = openDb(),
): Promise<string[]> {
	const rows = await db.all<{ media_id: string }>(
		`SELECT media_id FROM project_media_imports WHERE workspace = ? AND project_id = ?
		AND media_id IS NOT NULL AND status IN ('uploading', 'processing')`,
		[workspace, projectId],
	);
	return rows.map((row) => row.media_id);
}

export async function getImportByMediaId(
	mediaId: string,
	db: Db = openDb(),
): Promise<ProjectMediaImport | null> {
	const row = await db.get("SELECT * FROM project_media_imports WHERE media_id = ?", [mediaId]);
	return row ? importRow.parse(row) : null;
}

/** Stable cursor and bounded pages; ready/removed imports never resurrect on reload. */
export async function listPendingProjectImports(
	workspace: string,
	projectId: string,
	after: string | null,
	db: Db = openDb(),
): Promise<ProjectMediaImport[]> {
	const rows = await db.all(
		`SELECT * FROM project_media_imports WHERE workspace = ? AND project_id = ?
		AND status IN ('uploading', 'processing', 'failed') AND id::text > ? ORDER BY id LIMIT 51`,
		[workspace, projectId, after ?? ""],
	);
	return rows.map((row) => importRow.parse(row));
}

export function importOriginal(row: ProjectMediaImport): StoredImportMedia | null {
	return row.original_json ? StoredImportMediaSchema.parse(JSON.parse(row.original_json)) : null;
}

export function importedAsset(row: ProjectMediaImport): ReadyImportedMedia | null {
	return row.asset_json ? ReadyImportedMediaSchema.parse(JSON.parse(row.asset_json)) : null;
}

/** Finished uploads remain project-owned before the editor's debounced library save. */
export async function readyProjectImportByUrl(
	workspace: string,
	projectId: string,
	url: string,
	db: Db = openDb(),
): Promise<ReadyImportedMedia | null> {
	const row = await db.get(
		"SELECT * FROM project_media_imports WHERE workspace = ? AND project_id = ? AND status = 'ready' AND asset_json::jsonb ->> 'url' = ? LIMIT 1",
		[workspace, projectId, url],
	);
	return row ? importedAsset(importRow.parse(row)) : null;
}

export async function reserveProjectMediaImport(
	input: {
		workspace: string;
		projectId: string;
		requestKey: string;
		filename: string;
		kind: ProjectMediaImport["claimed_kind"];
		uploadTimeoutMs: number;
	},
	db: Db = openDb(),
): Promise<ImportReservation> {
	// The request key is the client-minted media identity the import publishes under.
	if (!isMediaId(input.requestKey)) throw new Error("Import request key must be a media id");
	const mediaId = input.requestKey;
	return db.transaction(async (tx) => {
		await serialize(tx, `import:${input.workspace}:${input.projectId}:${input.requestKey}`);
		const project = await tx.get<{ workspace: string }>(
			"SELECT workspace FROM content_projects WHERE id = ?",
			[input.projectId],
		);
		if (project?.workspace !== input.workspace)
			throw new Error("Import project does not belong to workspace");
		const existing = await tx.get(
			"SELECT * FROM project_media_imports WHERE workspace = ? AND project_id = ? AND request_key = ?",
			[input.workspace, input.projectId, input.requestKey],
		);
		const now = Date.now();
		if (existing) {
			const row = importRow.parse(existing);
			const reclaimable =
				row.status === "failed" ||
				row.status === "cancelled" ||
				(row.status === "uploading" && row.lease_until <= now);
			// An unfinished attempt may be restarted with a file chosen again for the same
			// asset (another name, same kind); a live or finished one only by the same file.
			if (
				row.claimed_kind !== input.kind ||
				(!reclaimable && row.original_filename !== input.filename)
			)
				throw new Error("Upload retry does not match original file");
			if (!reclaimable) return { row, claimed: false };
			// New immutable revision makes every late completion of the old attempt stale.
			await tx.run(
				`UPDATE project_media_imports SET status = 'uploading', source_revision = ?, original_filename = ?,
				original_json = NULL, worker_job_id = NULL, asset_json = NULL, error = NULL, lease_until = ?, updated_at = ? WHERE id = ?`,
				[randomUUID(), input.filename, now + input.uploadTimeoutMs, now, row.id],
			);
			return { row: (await getProjectMediaImport(row.id, tx))!, claimed: true };
		}
		await serialize(tx, `media-id:${mediaId}`);
		const taken = await tx.get(
			`SELECT 1 FROM media_objects WHERE id = ?
			UNION ALL SELECT 1 FROM project_media_imports WHERE media_id = ? LIMIT 1`,
			[mediaId, mediaId],
		);
		// Generic on purpose: the refusal never names the workspace that holds the identity.
		if (taken) throw new Error(MEDIA_ID_CONFLICT);
		const id = randomUUID();
		await tx.run(
			`INSERT INTO project_media_imports
			(id, workspace, project_id, request_key, media_id, original_filename, claimed_kind, source_revision, status, lease_until, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?)`,
			[
				id,
				input.workspace,
				input.projectId,
				input.requestKey,
				mediaId,
				input.filename,
				input.kind,
				randomUUID(),
				now + input.uploadTimeoutMs,
				now,
				now,
			],
		);
		return { row: (await getProjectMediaImport(id, tx))!, claimed: true };
	});
}

export async function attachImportOriginal(
	row: ProjectMediaImport,
	original: StoredImportMedia,
	db: Db = openDb(),
): Promise<boolean> {
	const parsed = StoredImportMediaSchema.parse(original);
	if (!parsed.key.startsWith(`workspaces/${row.workspace}/file/${row.project_id}/`))
		throw new Error("Import source storage ownership mismatch");
	return (
		(
			await db.run(
				`UPDATE project_media_imports SET original_json = ?, status = 'processing', updated_at = ?
		WHERE id = ? AND source_revision = ? AND status = 'uploading'`,
				[JSON.stringify(parsed), Date.now(), row.id, row.source_revision],
			)
		).changes > 0
	);
}

export async function setImportWorkerJob(
	row: ProjectMediaImport,
	jobId: string,
	db: Db = openDb(),
): Promise<boolean> {
	return (
		(
			await db.run(
				`UPDATE project_media_imports SET worker_job_id = ?, updated_at = ?
		WHERE id = ? AND source_revision = ? AND status = 'processing'`,
				[jobId, Date.now(), row.id, row.source_revision],
			)
		).changes > 0
	);
}

export async function failProjectMediaImport(
	row: ProjectMediaImport,
	error: string,
	db: Db = openDb(),
): Promise<void> {
	await db.run(
		`UPDATE project_media_imports SET status = 'failed', error = ?, updated_at = ?
		WHERE id = ? AND source_revision = ? AND status IN ('uploading', 'processing', 'failed')`,
		[error.slice(0, 500), Date.now(), row.id, row.source_revision],
	);
}

export async function cancelProjectMediaImport(
	row: ProjectMediaImport,
	db: Db = openDb(),
): Promise<boolean> {
	// Releasing original_json leaves the quarantined bytes unreferenced for managed-store cleanup.
	return (
		(
			await db.run(
				`UPDATE project_media_imports SET status = 'cancelled', original_json = NULL, updated_at = ?
		WHERE id = ? AND source_revision = ? AND status <> 'ready'`,
				[Date.now(), row.id, row.source_revision],
			)
		).changes > 0
	);
}

export async function finishProjectMediaImport(
	row: ProjectMediaImport,
	asset: ReadyImportedMedia,
	db: Db = openDb(),
): Promise<boolean> {
	const parsed = ReadyImportedMediaSchema.parse(asset);
	if (
		parsed.id !== row.id ||
		parsed.importedSource.revision !== row.source_revision ||
		parsed.kind !== row.claimed_kind
	)
		throw new Error("Import result identity mismatch");
	return (
		(
			await db.run(
				`UPDATE project_media_imports SET asset_json = ?, status = 'ready', error = NULL, updated_at = ?
		WHERE id = ? AND source_revision = ? AND status IN ('processing', 'failed')`,
				[JSON.stringify(parsed), Date.now(), row.id, row.source_revision],
			)
		).changes > 0
	);
}
