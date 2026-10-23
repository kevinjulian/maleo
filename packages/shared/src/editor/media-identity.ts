/* Which media asset a clip refers to (`migrate-editor-to-shared-rust-core` 4.8).
 *
 * The asset id is the identity; a URL is where the bytes are at the moment. A
 * clip's `mediaAssetId` decides, even when the clip's URL is not the asset's:
 * after a relink the asset moved. Matching by URL is the legacy resolution, for a reference that names no id
 * or an id this library does not hold. */
import type { MediaAsset } from "./scope.ts";

export interface MediaReference {
	mediaAssetId?: string;
	url?: string;
}

export function mediaAssetOf(
	assets: readonly MediaAsset[],
	reference: MediaReference,
	kind?: MediaAsset["kind"],
): MediaAsset | undefined {
	const fits = (asset: MediaAsset): boolean => kind === undefined || asset.kind === kind;
	const named =
		reference.mediaAssetId === undefined
			? undefined
			: assets.find((asset) => asset.id === reference.mediaAssetId);
	if (named) return fits(named) ? named : undefined;
	return reference.url === undefined
		? undefined
		: assets.find((asset) => asset.url === reference.url && fits(asset));
}
