/* A project's asset manifest (`p1-asset-identity` D4): the shared derivation's
 * references, with each state resolved by one import query and one registry query, run together. */
import { collectAssetReferences } from "@maleo/shared";
import { openDb } from "@maleo/db/connection";
import type { Db } from "@maleo/db/handle";
import type { ProjectMediaImport } from "@maleo/db/media-imports";
import type { MediaObject } from "@maleo/db/media-objects";

export type AssetState = "ready" | "pending" | "failed" | "external";

export interface AssetManifestEntry {
	/** The managed media id; the URL itself for external media. */
	id: string;
	url: string;
	origin: "import" | "managed" | "external";
	kind?: string;
	contentType?: string;
	size?: number;
	sha256?: string;
	state: AssetState;
	label?: string;
	/** The document places it; a library entry alone is listed but used by nothing. */
	used: boolean;
}

const placeholders = (values: readonly unknown[]): string => values.map(() => "?").join(", ");

const unfinished = (row: ProjectMediaImport | undefined): boolean =>
	row?.status === "uploading" || row?.status === "processing";

/** Every media item `document` and `libraryAssets` reference, once per identity, with its state. */
export async function buildAssetManifest(
	document: unknown,
	libraryAssets: unknown,
	workspace: string,
	db: Db = openDb(),
): Promise<AssetManifestEntry[]> {
	const refs = collectAssetReferences(document, libraryAssets);
	const ids = [...new Set(refs.flatMap((ref) => (ref.type === "managed" ? [ref.id] : [])))];
	// A media id is unique across workspaces, so only this workspace's rows can answer for it.
	const [imports, registry] = ids.length
		? await Promise.all([
				db.all<ProjectMediaImport>(
					`SELECT * FROM project_media_imports WHERE workspace = ? AND media_id IN (${placeholders(ids)})`,
					[workspace, ...ids],
				),
				db.all<MediaObject>(
					`SELECT * FROM media_objects WHERE workspace = ? AND id IN (${placeholders(ids)})`,
					[workspace, ...ids],
				),
			])
		: [[], []];
	const byMediaId = new Map(imports.map((row) => [row.media_id, row]));
	const byId = new Map(registry.map((row) => [row.id, row]));
	return refs.map((ref): AssetManifestEntry => {
		const label = ref.label ? { label: ref.label } : {};
		if (ref.type === "external")
			return {
				id: ref.url,
				url: ref.url,
				origin: "external",
				state: "external",
				...label,
				used: ref.used,
			};
		const imported = byMediaId.get(ref.id);
		const origin = imported ? "import" : "managed";
		const row = byId.get(ref.id);
		if (row)
			return {
				id: ref.id,
				url: ref.url,
				origin,
				kind: row.kind,
				contentType: row.content_type,
				size: row.size,
				sha256: row.hash,
				state: "ready",
				...label,
				used: ref.used,
			};
		return {
			id: ref.id,
			url: ref.url,
			origin,
			...(imported ? { kind: imported.claimed_kind } : {}),
			state: unfinished(imported) ? "pending" : "failed",
			...(imported && !ref.label ? { label: imported.original_filename } : label),
			used: ref.used,
		};
	});
}
