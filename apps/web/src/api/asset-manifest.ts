/* `GET /projects/:id/asset-manifest`: every media item the project's saved storyboard
 * and media library reference, with its state, size and SHA-256 (`asset-manifest`).
 * Browser export preflight reads it (OpenSpec p2-export E9). */
import { get } from "./client.ts";
import { BASE } from "./base.ts";
import { assetManifestSchema, type ManifestEntry } from "@models/render/export-preflight.ts";

export async function getAssetManifest(projectId: string): Promise<ManifestEntry[]> {
	const response = await get<unknown>(
		`${BASE}/projects/${encodeURIComponent(projectId)}/asset-manifest`,
	);
	return assetManifestSchema.parse(response).assets;
}
