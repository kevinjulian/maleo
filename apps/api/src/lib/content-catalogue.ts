// The catalogue's shapes are the wire contract, declared once in @maleo/shared.
import type { CatalogueImage } from "@maleo/shared";
import { listItems } from "./collection-files.ts";
import { listContentAssets, listSuppressedAssetRefs, upsertContentAsset } from "@maleo/db/assets";
import { listReferenceEntities, type ReferenceEntityRow } from "@maleo/db/references";

const COLLECTION_KIND: Record<string, string> = {
	characters: "character",
	environments: "location",
	products: "product",
};

function hashSeed(input: string): number {
	let h = 0;
	for (const ch of input) h = (h * 31 + ch.charCodeAt(0)) % 1000;
	return h;
}

function kindFromCollection(collection: string): string {
	return COLLECTION_KIND[collection] ?? collection.replace(/s$/, "") ?? "style";
}

function logicalCatalogueImageKey(
	asset: Awaited<ReturnType<typeof listContentAssets>>[number],
): string {
	return `src:${asset.kind}:${asset.label}:${asset.src}`;
}

function logicalCatalogueImageId(
	asset: Awaited<ReturnType<typeof listContentAssets>>[number],
): string {
	const metaId =
		typeof asset.meta_json?.id === "string" && asset.meta_json.id.trim()
			? asset.meta_json.id.trim()
			: null;
	return metaId ?? asset.id;
}

/* Suppressed refs come from their own table now. Previously they were fake asset
 * rows (source_type='reference_deleted'), so every catalogue read scanned up to
 * 2000 assets and tested three columns per row to reconstruct this set. */
async function deletedReferenceIds(workspace: string): Promise<Set<string>> {
	return await listSuppressedAssetRefs(workspace);
}

/* Import a workspace's collection files into the asset registry.
 *
 * A write on a read path, kept deliberately: collection items live on disk and
 * have no entity of their own, so nothing else ever creates their rows. It is
 * scoped to that job — entities are not mirrored from here, because their
 * visibility no longer depends on a mirror existing. */
async function importCollectionAssets(workspace: string, deletedIds: Set<string>): Promise<void> {
	for (const collection of ["characters", "environments"]) {
		for (const item of await listItems(workspace, collection)) {
			const filename = item.sheets[0];
			if (!item.active || !filename) continue;
			const kind = kindFromCollection(collection);
			const sourceRef = `${workspace}:${collection}:${item.id}`;
			if (deletedIds.has(sourceRef) || deletedIds.has(item.id)) continue;
			void (await upsertContentAsset({
				scope: "workspace",
				workspace,
				kind,
				label: item.label,
				tags: [kind],
				note:
					item.description ??
					item.prompt
						.split("\n")
						.map((line) => line.trim())
						.find(Boolean) ??
					"",
				seed: hashSeed(`${workspace}:${collection}:${item.id}`),
				default: false,
				src: `/api/workspaces/${workspace}/collections/${collection}/items/${item.id}/sheets/${encodeURIComponent(filename)}`,
				source_type: "workspace_collection",
				source_ref: sourceRef,
				collection,
				item_id: item.id,
				meta_json: {
					prompt: item.prompt,
					active: item.active,
				},
			}));
		}
	}
}

/* An entity's mirror row, when one exists.
 *
 * Keyed by the entity id wherever the mirror recorded it — its own id, its
 * `item_id`, or `meta.id`. A mirror is decoration here: it contributes tags,
 * seed, and default flag. Nothing about whether the entity is visible. */
function mirrorsByEntityId(
	assets: Awaited<ReturnType<typeof listContentAssets>>,
): Map<string, Awaited<ReturnType<typeof listContentAssets>>[number]> {
	const byId = new Map<string, Awaited<ReturnType<typeof listContentAssets>>[number]>();
	for (const asset of assets) {
		for (const key of [logicalCatalogueImageId(asset), asset.item_id, asset.id]) {
			if (key?.trim() && !byId.has(key)) byId.set(key, asset);
		}
	}
	return byId;
}

/* One entry per reference the operator would recognise as distinct.
 *
 * `reference_entity` holds several rows describing the same picture. They are
 * legacy: the persona-era import ran repeatedly and minted a fresh uuid each
 * time, so one workspace here carries 69 rows for 23 actual references — seven
 * copies of "Anjing", all with the same canonical url.
 *
 * The asset path this read replaced collapsed them by accident, keying its dedupe
 * on `(kind, label, src)`, so the library looked right while the duplication sat
 * underneath. Reading entities directly surfaced all of it, which is a worse
 * library than the one before.
 *
 * They are NOT deleted, and this is not a cleanup waiting to happen: every
 * duplicate row is attached to some project's roster, each project having
 * attached its own copy. Dropping rows would empty those rosters. So the
 * duplication is collapsed for display and every id stays resolvable.
 *
 * The survivor is the oldest row, which is stable across calls — a representative
 * that changed between reads would move cards around the library for no reason. */
function dedupeLogicalReferences(entities: readonly ReferenceEntityRow[]): ReferenceEntityRow[] {
	const byLogical = new Map<string, ReferenceEntityRow>();
	for (const entity of entities) {
		const url = entity.canonical_image_url?.trim();
		// No url is no basis for calling two rows the same picture; such a row is
		// dropped from the catalogue below anyway.
		const key = url
			? `${entity.role}:${entity.label.trim().toLowerCase()}:${url}`
			: `id:${entity.id}`;
		const seen = byLogical.get(key);
		if (!seen || entity.created_at < seen.created_at) byLogical.set(key, entity);
	}
	return [...byLogical.values()];
}

function entityCatalogueImage(
	entity: ReferenceEntityRow,
	mirror: Awaited<ReturnType<typeof listContentAssets>>[number] | undefined,
): CatalogueImage {
	return {
		// The entity's own id, which is what project documents and generation locks
		// already store. Sourcing the catalogue from entities must not renumber
		// them, or every existing selection stops resolving.
		id: entity.id,
		label: entity.label,
		tags: mirror?.tags ?? [entity.role],
		kind: entity.role,
		note: entity.description || mirror?.note || "",
		seed: mirror?.seed ?? hashSeed(entity.id),
		default: mirror?.default ?? false,
		src: entity.canonical_image_url ?? mirror?.src ?? "",
		workspace: entity.workspace,
		collection: mirror?.collection ?? entity.role,
		item_id: mirror?.item_id ?? entity.id,
	};
}

/* One workspace's reference images.
 *
 * This took no arguments and served every tenant: it iterated
 * `listWorkspaceNames()` importing each workspace's collection items, then read
 * `listContentAssets({ limit: 1000 })` with no workspace filter at all. Both
 * halves needed the tenant — filtering only the asset read would still import
 * another workspace's collection items into the registry on every call.
 *
 * The pool is now the canonical `reference_entity` library, with unmirrored
 * assets (collection imports, uploads) appended. It used to be the asset mirror
 * alone, so a workspace holding a full entity library and two stale mirror rows
 * showed a Reference Library with two entries in it. */
export async function listContentCatalogueImages(workspace: string): Promise<CatalogueImage[]> {
	// Compatibility import: workspace collection files remain readable, but DB
	// asset registry becomes source of truth for catalogue reads.
	const deletedIds = await deletedReferenceIds(workspace);
	await importCollectionAssets(workspace, deletedIds);

	const assets = (await listContentAssets({ workspace, limit: 1000 })).filter(
		(asset) => asset.kind !== "product",
	);
	const mirrors = mirrorsByEntityId(assets);
	const entities = dedupeLogicalReferences(await listReferenceEntities(workspace));

	const out: CatalogueImage[] = [];
	const claimedAssetIds = new Set<string>();
	// Entities first. A deleted entity stays deleted: `DELETE /assets/:refId`
	// records the catalogue id it was given, and that id is now the entity id, so
	// the suppression still lands even when the mirror row it deleted is gone.
	for (const entity of entities) {
		if (deletedIds.has(entity.id)) continue;
		const mirror = mirrors.get(entity.id);
		if (mirror) claimedAssetIds.add(mirror.id);
		const image = entityCatalogueImage(entity, mirror);
		if (!image.src.trim()) continue;
		out.push(image);
	}

	// Assets with no entity behind them — collection imports and direct uploads —
	// still belong in the library.
	const deduped = new Map<string, Awaited<ReturnType<typeof listContentAssets>>[number]>();
	for (const asset of assets) {
		if (!asset.src?.trim() || claimedAssetIds.has(asset.id)) continue;
		const logicalId = logicalCatalogueImageId(asset);
		if (
			deletedIds.has(logicalId) ||
			(asset.source_ref && deletedIds.has(asset.source_ref)) ||
			(asset.item_id && deletedIds.has(asset.item_id))
		)
			continue;
		const key = logicalCatalogueImageKey(asset);
		if (!deduped.has(key)) deduped.set(key, asset);
	}
	for (const asset of deduped.values()) {
		const logicalId = logicalCatalogueImageId(asset);
		if (out.some((image) => image.id === logicalId)) continue;
		out.push({
			id: logicalId,
			label: asset.label,
			tags: asset.tags,
			kind: asset.kind,
			note: asset.note ?? "",
			seed: asset.seed,
			default: asset.default,
			src: asset.src,
			workspace: asset.workspace ?? "workspace",
			collection: asset.collection ?? asset.kind,
			item_id: asset.item_id ?? logicalId,
		});
	}

	return out.sort(
		(a, b) => a.label.localeCompare(b.label) || a.workspace.localeCompare(b.workspace),
	);
}
