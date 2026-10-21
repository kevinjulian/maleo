/* Content assets and their suppression list — the media a project produced or had
 * mirrored into it, and the refs an operator has hidden. */
import { randomUUID } from "node:crypto";
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";
import { parseJsonStringArray, parseJsonValue, readBack, isJsonObjectOrNull } from "./row-json.ts";

/* An asset's id as recorded inside meta_json. Postgres reads JSON only from a
 * json/jsonb value, SQLite from text; the column stays text on both. */
const metaId = (db: Db): string =>
	db.dialect === "postgres" ? "(a.meta_json::jsonb ->> 'id')" : "json_extract(a.meta_json, '$.id')";

export type ContentAssetScope = "workspace" | "campaign" | "project";

export interface ContentAssetRow {
	id: string;
	scope: ContentAssetScope;
	campaign_id: string | null;
	project_id: string | null;
	workspace: string | null;
	kind: string;
	label: string;
	tags: string[];
	note: string | null;
	seed: number;
	default: boolean;
	src: string;
	source_type: string;
	/** linked | generated — deliberately separate from source_type. */
	origin: string;
	source_ref: string | null;
	collection: string | null;
	item_id: string | null;
	meta_json: Record<string, unknown> | null;
	created_at: number;
	updated_at: number;
}

/** The row as SQLite returns it: tags and meta are still text and `default` is
 *  still an integer, which `mapContentAssetRow` resolves. Named because three
 *  call sites spelled the same `Omit<…> & {…}` out longhand. */
export type StoredContentAssetRow = Omit<ContentAssetRow, "tags" | "default" | "meta_json"> & {
	tags_json: string | null;
	is_default: number;
	meta_json: string | null;
};

function mapContentAssetRow(row: StoredContentAssetRow): ContentAssetRow {
	return {
		...row,
		tags: parseJsonStringArray(row.tags_json),
		default: row.is_default === 1,
		meta_json: parseJsonValue(row.meta_json, null, isJsonObjectOrNull),
	};
}

export async function listContentAssets(
	input?: {
		scope?: ContentAssetScope;
		kind?: string;
		campaign_id?: string | null;
		project_id?: string | null;
		workspace?: string | null;
		limit?: number;
	},
	db: Db = openDb(),
): Promise<ContentAssetRow[]> {
	const clauses: string[] = [];
	const params: Array<string | number> = [];
	if (input?.scope) {
		clauses.push("scope = ?");
		params.push(input.scope);
	}
	if (input?.kind) {
		clauses.push("kind = ?");
		params.push(input.kind);
	}
	if (input?.campaign_id) {
		clauses.push("campaign_id = ?");
		params.push(input.campaign_id);
	}
	if (input?.project_id) {
		clauses.push("project_id = ?");
		params.push(input.project_id);
	}
	if (input?.workspace) {
		clauses.push("workspace = ?");
		params.push(input.workspace);
	}
	const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
	const limit = Math.max(1, Math.min(input?.limit ?? 500, 2000));
	const rows = await db.all<StoredContentAssetRow>(
		`SELECT * FROM content_assets ${where} ORDER BY updated_at DESC, created_at DESC LIMIT ?`,
		[...params, limit],
	);
	return rows.map(mapContentAssetRow);
}

export async function upsertContentAsset(
	input: {
		scope?: ContentAssetScope;
		campaign_id?: string | null;
		project_id?: string | null;
		workspace?: string | null;
		kind: string;
		label: string;
		tags?: string[];
		note?: string | null;
		seed?: number;
		default?: boolean;
		src: string;
		source_type?: string;
		/** linked | generated. Kept OFF source_type on purpose: it used to be encoded
		 *  there ("generated_reference" vs "reference"), and since source_type is half of
		 *  the row's unique key, flipping origin changed the key, inserted a second row,
		 *  and orphaned the first. */
		origin?: string;
		source_ref?: string | null;
		collection?: string | null;
		item_id?: string | null;
		meta_json?: Record<string, unknown> | null;
	},
	db: Db = openDb(),
): Promise<ContentAssetRow> {
	const now = Date.now();
	const sourceType = input.source_type ?? "manual";
	const sourceRef = input.source_ref ?? null;
	const existing = sourceRef
		? await db.get<{ id: string }>(
				`SELECT id FROM content_assets WHERE source_type = ? AND source_ref = ?`,
				[sourceType, sourceRef],
			)
		: null;
	const id = existing?.id ?? randomUUID();
	if (existing) {
		await db.run(
			`UPDATE content_assets
			 SET scope = ?, campaign_id = ?, project_id = ?, workspace = ?, kind = ?, label = ?, tags_json = ?, note = ?, seed = ?,
			     is_default = ?, src = ?, origin = ?, collection = ?, item_id = ?, meta_json = ?, updated_at = ?
			 WHERE id = ?`,
			[
				input.scope ?? "workspace",
				input.campaign_id ?? null,
				input.project_id ?? null,
				input.workspace ?? null,
				input.kind,
				input.label,
				JSON.stringify(input.tags ?? []),
				input.note ?? null,
				input.seed ?? 0,
				input.default ? 1 : 0,
				input.src,
				input.origin ?? "linked",
				input.collection ?? null,
				input.item_id ?? null,
				input.meta_json ? JSON.stringify(input.meta_json) : null,
				now,
				id,
			],
		);
	} else {
		await db.run(
			`INSERT INTO content_assets
			 (id, scope, campaign_id, project_id, workspace, kind, label, tags_json, note, seed, is_default, src,
			  origin, source_type, source_ref, collection, item_id, meta_json, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				input.scope ?? "workspace",
				input.campaign_id ?? null,
				input.project_id ?? null,
				input.workspace ?? null,
				input.kind,
				input.label,
				JSON.stringify(input.tags ?? []),
				input.note ?? null,
				input.seed ?? 0,
				input.default ? 1 : 0,
				input.src,
				input.origin ?? "linked",
				sourceType,
				sourceRef,
				input.collection ?? null,
				input.item_id ?? null,
				input.meta_json ? JSON.stringify(input.meta_json) : null,
				now,
				now,
			],
		);
	}
	const saved = await db.get<StoredContentAssetRow>(`SELECT * FROM content_assets WHERE id = ?`, [
		id,
	]);
	return mapContentAssetRow(readBack(saved, "content_assets"));
}

/* Suppress a ref from ONE workspace's reference library. Needed only for assets
 * the catalogue RE-DERIVES from disk on every read (workspace collections):
 * deleting such a row is undone on the next call. Mirror-derived assets are
 * deleted outright instead.
 *
 * The workspace is required. Suppression used to be keyed on the ref alone, so
 * one tenant deleting a reference hid it for every tenant — and two tenants
 * deleting items that share an id collapsed onto one row, silently dropping the
 * second suppression. */
export async function suppressAssetRef(
	suppressedRef: string,
	workspace: string,
	reason?: string,
	db: Db = openDb(),
): Promise<void> {
	await db.run(
		`INSERT INTO asset_suppression (suppressed_ref, workspace, reason, created_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT(suppressed_ref, workspace) DO NOTHING`,
		[suppressedRef, workspace, reason ?? null, Date.now()],
	);
}

/** What is hidden from this workspace's library.
 *
 *  Includes legacy rows (`workspace = ''`), which predate scoping and apply
 *  everywhere: the tenant they were suppressed under was never recorded, and
 *  dropping them would resurrect references an operator deleted. */
export async function listSuppressedAssetRefs(
	workspace: string,
	db: Db = openDb(),
): Promise<Set<string>> {
	const rows = await db.all<{ suppressed_ref: string }>(
		`SELECT suppressed_ref FROM asset_suppression WHERE workspace = ? OR workspace = ''`,
		[workspace],
	);
	return new Set(rows.map((r) => r.suppressed_ref));
}

export async function unsuppressAssetRef(
	suppressedRef: string,
	workspace: string,
	db: Db = openDb(),
): Promise<boolean> {
	return (
		(
			await db.run(`DELETE FROM asset_suppression WHERE suppressed_ref = ? AND workspace = ?`, [
				suppressedRef,
				workspace,
			])
		).changes > 0
	);
}

/* Delete a reference from ONE workspace.
 *
 * The workspace is required, and it is the whole point of this signature. The
 * id expansion below matches on id, source_ref, item_id and meta.id — values
 * that are NOT unique across tenants, because a workspace collection item is
 * identified by a short id that another workspace can reuse. Unscoped, deleting
 * one workspace's reference deleted the identically-identified row in every
 * other workspace, with nothing in the response saying so. */
/* Which rows this workspace may delete.
 *
 * An asset's tenant is not always its own column. Three cases, and collapsing
 * them to `workspace = ?` would make two of them undeletable:
 *
 *  - workspace-scoped: the column is the answer.
 *  - project-scoped: `workspace` is NULL and the PROJECT owns the tenancy, so
 *    the answer is `content_projects.workspace` — the same rule the rest of the
 *    content path follows.
 *  - orphaned (no workspace, no surviving project): owned by nobody, so any
 *    workspace may clear it. It cannot leak across tenants because it belongs
 *    to none, and refusing to delete it would strand rows permanently. */
const ASSET_OWNED_BY_WORKSPACE = `(
	a.workspace = ?
	OR (a.workspace IS NULL AND (p.workspace = ? OR p.id IS NULL))
)`;

export async function deleteContentAssetReference(
	referenceId: string,
	workspace: string,
	db: Db = openDb(),
): Promise<string[]> {
	const rows = await db.all<{
		id: string;
		source_ref: string | null;
		item_id: string | null;
		meta_json: string | null;
	}>(
		`SELECT a.id, a.source_ref, a.item_id, a.meta_json
		 FROM content_assets a
		 LEFT JOIN content_projects p ON p.id = a.project_id
		 WHERE ${ASSET_OWNED_BY_WORKSPACE}
		   AND (a.id = ? OR a.source_ref = ? OR a.item_id = ? OR ${metaId(db)} = ?)`,
		[workspace, workspace, referenceId, referenceId, referenceId, referenceId],
	);
	const ids = new Set<string>([referenceId]);
	for (const row of rows) {
		for (const value of [row.id, row.source_ref, row.item_id]) {
			if (value?.trim()) ids.add(value.trim());
		}
		try {
			const meta = row.meta_json ? (JSON.parse(row.meta_json) as { id?: unknown }) : null;
			if (typeof meta?.id === "string" && meta.id.trim()) ids.add(meta.id.trim());
		} catch {
			/* ignore corrupt meta */
		}
	}
	if (ids.size > 0) {
		const placeholders = [...ids].map(() => "?").join(", ");
		// Deleted by id from a scoped SELECT rather than by re-matching in the
		// DELETE: the expanded id set is deliberately broad, and re-applying it
		// without the ownership join is exactly how this reached other tenants.
		await db.run(
			`DELETE FROM content_assets WHERE id IN (
				SELECT a.id FROM content_assets a
				LEFT JOIN content_projects p ON p.id = a.project_id
				WHERE ${ASSET_OWNED_BY_WORKSPACE}
				  AND (a.id IN (${placeholders})
				   OR a.source_ref IN (${placeholders})
				   OR a.item_id IN (${placeholders})
				   OR ${metaId(db)} IN (${placeholders}))
			)`,
			[workspace, workspace, ...ids, ...ids, ...ids, ...ids],
		);
	}
	return [...ids];
}
