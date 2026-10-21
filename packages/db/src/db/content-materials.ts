/* Reusable materials — named generation context an operator selects into a project
 * and a Project Preset names per group.
 *
 * WORKSPACE-SCOPED. A material is operator writing — a brief, a look, a set of
 * constraints — which is exactly the content a tenant must not leak to another. So
 * `workspace` is a required argument on every read and write here rather than an
 * optional filter: an optional one is a filter somebody eventually forgets to pass,
 * and the failure mode of forgetting is showing one workspace another's briefs.
 *
 * A row is scoped to ONE material group. The column is `material_group` rather than
 * `group` because GROUP is a SQL keyword and a quoted identifier would have to stay
 * quoted at every call site forever.
 *
 * `asset_ids_json` holds `reference_entity` ids. There is deliberately no foreign key:
 * an entity can be evicted while a material that named it survives, and a cascade
 * would silently delete the material's text along with a stale image. Readers drop ids
 * that no longer resolve at resolution time, where the miss is visible.
 */
import { randomUUID } from "node:crypto";
import {
	FIXTURE_WORKSPACE,
	forkCopyName,
	generateUserSlug,
	materialRecordInputSchema,
	MATERIAL_GROUPS,
	visualMaterialReferenceSchema,
	type MaterialGroup,
	type MaterialRecord,
	type MaterialRecordInput,
	type VisualMaterialReference,
} from "@maleo/shared";
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";
import { oneOf } from "@maleo/shared";

interface ContentMaterialDbRow {
	id: string;
	workspace: string;
	name: string;
	description: string;
	material_group: string;
	body: string;
	asset_ids_json: string;
	reference_settings_json: string | null;
	slug: string | null;
	source: string | null;
	retired: number | null;
	created_at: number;
	updated_at: number;
}

/** A row whose group is no longer recognised reads as a story material rather than
 *  being dropped: losing the row hides an operator's writing, while mis-grouping it
 *  is visible and fixable in the library. */
function readGroup(raw: string): MaterialGroup {
	return oneOf(raw, MATERIAL_GROUPS) ?? "story";
}

function readAssetIds(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((id): id is string => typeof id === "string" && id.length > 0)
			: [];
	} catch {
		return [];
	}
}

function readReferenceSettings(raw: string | null): VisualMaterialReference[] {
	try {
		const parsed = JSON.parse(raw ?? "[]");
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((value) => visualMaterialReferenceSchema.safeParse(value))
			.filter(
				(result): result is { success: true; data: VisualMaterialReference } => result.success,
			)
			.map((result) => result.data);
	} catch {
		return [];
	}
}

function mapRow(row: ContentMaterialDbRow): MaterialRecord {
	return {
		id: row.id,
		workspace: row.workspace,
		name: row.name,
		description: row.description,
		group: readGroup(row.material_group),
		body: row.body,
		assetIds: readAssetIds(row.asset_ids_json),
		referenceSettings: readReferenceSettings(row.reference_settings_json),
		/* Coerced rather than parsed: reconcileColumns adds a late column without a
		 * DEFAULT, so rows that predate these three read back NULL. A NULL source is
		 * an operator's row — fixtures are only ever written by bootstrap, which sets
		 * it explicitly. */
		slug: row.slug ?? null,
		source: row.source === "fixture" ? "fixture" : "user",
		retired: row.retired === 1,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/** The slugs already taken in a workspace, so a new row can pick one that is free. */
async function takenSlugs(workspace: string, db: Db): Promise<string[]> {
	return (
		await db.all<{ slug: string }>(
			"SELECT slug FROM content_materials WHERE workspace = ? AND slug IS NOT NULL",
			[workspace],
		)
	).map((row) => row.slug);
}

/* Reads span the caller's workspace AND the reserved fixture scope; writes never do.
 *
 * Shipped materials are stored once, in the empty workspace, because a global preset
 * bundle can only name one material id and a per-workspace copy would give it N. That
 * makes them readable everywhere and writable nowhere: an operator's UPDATE or DELETE
 * carries their own workspace in its WHERE clause, which no fixture row can match. The
 * read-only rule is the scoping, not a check layered on top of it.
 *
 * Retired fixtures are excluded from listings and included in lookups by id — a preset
 * still naming one has to keep resolving. */
const WORKSPACE_OR_FIXTURE = "(workspace = ? OR workspace = ?)";

/** One workspace's materials plus the shipped fixtures, newest first. `group` narrows
 *  to one library tab. Callers order fixtures ahead of user rows for display. */
export async function listContentMaterials(
	workspace: string,
	group: MaterialGroup | null = null,
	db: Db = openDb(),
): Promise<MaterialRecord[]> {
	const rows = group
		? await db.all<ContentMaterialDbRow>(
				`SELECT * FROM content_materials WHERE ${WORKSPACE_OR_FIXTURE} AND material_group = ? AND retired IS DISTINCT FROM 1 ORDER BY updated_at DESC, name ASC`,
				[workspace, FIXTURE_WORKSPACE, group],
			)
		: await db.all<ContentMaterialDbRow>(
				`SELECT * FROM content_materials WHERE ${WORKSPACE_OR_FIXTURE} AND retired IS DISTINCT FROM 1 ORDER BY updated_at DESC, name ASC`,
				[workspace, FIXTURE_WORKSPACE],
			);
	return rows.map(mapRow);
}

/* Reads take the workspace as part of the LOOKUP, not as a check after the fact.
 * Fetching by id and comparing the workspace afterwards leaks existence: the caller
 * can tell "no such material" from "not yours" by which branch it lands in. */
export async function getContentMaterial(
	id: string,
	workspace: string,
	db: Db = openDb(),
): Promise<MaterialRecord | null> {
	const row = await db.get<ContentMaterialDbRow>(
		`SELECT * FROM content_materials WHERE id = ? AND ${WORKSPACE_OR_FIXTURE}`,
		[id, workspace, FIXTURE_WORKSPACE],
	);
	return row ? mapRow(row) : null;
}

/** Resolve several materials at once, keeping the requested order and skipping ids
 *  that no longer exist. Preset seeding names up to four ids and must not fail
 *  wholesale because one material was deleted. */
export async function getContentMaterials(
	ids: readonly string[],
	workspace: string,
	db: Db = openDb(),
): Promise<MaterialRecord[]> {
	if (ids.length === 0) return [];
	const placeholders = ids.map(() => "?").join(", ");
	const rows = await db.all<ContentMaterialDbRow>(
		`SELECT * FROM content_materials WHERE ${WORKSPACE_OR_FIXTURE} AND id IN (${placeholders})`,
		[workspace, FIXTURE_WORKSPACE, ...ids],
	);
	const byId = new Map(rows.map((row) => [row.id, mapRow(row)]));
	return ids
		.map((id) => byId.get(id))
		.filter((record): record is MaterialRecord => Boolean(record));
}

export async function createContentMaterial(
	input: MaterialRecordInput,
	workspace: string,
	db: Db = openDb(),
): Promise<MaterialRecord> {
	const validated = materialRecordInputSchema.parse(input);
	const now = Date.now();
	const id = randomUUID();
	// The slug is assigned here and never again: it is the row's logical identity, and
	// a caller cannot supply one, so it cannot collide with a fixture's authored slug
	// except by generating the same text — which the workspace scope keeps apart.
	const slug = generateUserSlug(validated.name, await takenSlugs(workspace, db), "material");
	await db.run(
		`INSERT INTO content_materials (id, workspace, name, description, material_group, body, asset_ids_json, reference_settings_json, slug, source, retired, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', 0, ?, ?)`,
		[
			id,
			workspace,
			validated.name,
			validated.description,
			validated.group,
			validated.body,
			JSON.stringify(validated.assetIds),
			JSON.stringify(validated.referenceSettings ?? []),
			slug,
			now,
			now,
		],
	);
	return (await getContentMaterial(id, workspace, db))!;
}

/* The workspace is in the WHERE clause of the write itself, not only in the
 * existence check above it. A check-then-write is two statements a concurrent
 * request can interleave, and the write is the one that matters.
 *
 * `slug` and `source` are absent from the SET list on purpose: that absence IS the
 * immutability rule. A slug that could be updated would break every fixture bootstrap
 * that finds its row by one. */
export async function updateContentMaterial(
	id: string,
	input: MaterialRecordInput,
	workspace: string,
	db: Db = openDb(),
): Promise<MaterialRecord | null> {
	const validated = materialRecordInputSchema.parse(input);
	const result = await db.run(
		"UPDATE content_materials SET name = ?, description = ?, material_group = ?, body = ?, asset_ids_json = ?, reference_settings_json = ?, updated_at = ? WHERE id = ? AND workspace = ?",
		[
			validated.name,
			validated.description,
			validated.group,
			validated.body,
			JSON.stringify(validated.assetIds),
			JSON.stringify(validated.referenceSettings ?? []),
			Date.now(),
			id,
			workspace,
		],
	);
	return result.changes > 0 ? getContentMaterial(id, workspace, db) : null;
}

/* Copy a material into the caller's workspace — the only way to edit a fixture one.
 *
 * The source may be a fixture (reserved scope) or one of the workspace's own rows; the
 * copy is always the operator's, in their workspace, with a generated slug. */
export async function forkContentMaterial(
	id: string,
	workspace: string,
	db: Db = openDb(),
): Promise<MaterialRecord | null> {
	const source = await getContentMaterial(id, workspace, db);
	if (!source) return null;
	const now = Date.now();
	const newId = randomUUID();
	const takenNames = (
		await db.all<{ name: string }>("SELECT name FROM content_materials WHERE workspace = ?", [
			workspace,
		])
	).map((row) => row.name);
	const name = forkCopyName(source.name, takenNames);
	await db.run(
		`INSERT INTO content_materials (id, workspace, name, description, material_group, body, asset_ids_json, reference_settings_json, slug, source, retired, fixture_rank, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', 0, 0, ?, ?)`,
		[
			newId,
			workspace,
			name,
			source.description,
			source.group,
			source.body,
			JSON.stringify(source.assetIds),
			JSON.stringify(source.referenceSettings ?? []),
			generateUserSlug(name, await takenSlugs(workspace, db), "material"),
			now,
			now,
		],
	);
	return getContentMaterial(newId, workspace, db);
}

export async function deleteContentMaterial(
	id: string,
	workspace: string,
	db: Db = openDb(),
): Promise<boolean> {
	return (
		(await db.run("DELETE FROM content_materials WHERE id = ? AND workspace = ?", [id, workspace]))
			.changes > 0
	);
}
