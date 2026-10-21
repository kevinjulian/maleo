/* Admitting an asset to the project.
 *
 * One rule, one place. Before this, three sites decided independently whether an
 * asset was already known — two keyed on `url`, one on `url ?? id` — and a
 * fourth minted the id. That is how the same file could end up admitted twice
 * under different identities depending on which surface the operator used.
 *
 * The key is the URL. The same asset reached through two searches is the same
 * URL; a provider's own id is not comparable across providers, and the id an
 * asset ends up with is an output of admission rather than an input to it. */
import type { MediaAsset } from "@models/timeline/editor-media.ts";
import { readyPendingImport } from "@models/core/pending-media-sources.ts";
import { admitAsset, admitMedia, type Admission, type EditorCommand } from "@maleo/shared/editor";

export type { Admission };

/** An asset as a browsing surface knows it: everything but the identity, which
 *  admission decides. A surface MAY propose an id; it is used only when the URL
 *  is new. */
export type MediaAssetSeed = Omit<MediaAsset, "id"> & { id?: string };

let minted = 0;

/** A stable-enough identity for an asset the surface did not name. Not derived
 *  from the URL: two entries may legitimately share one (a poster reused as a
 *  frame), and an id that collides is worse than one that is merely opaque. */
function mintId(): string {
	minted += 1;
	return `media-${Date.now().toString(36)}-${minted.toString(36)}`;
}

export function admitMediaAsset(assets: MediaAsset[], seed: MediaAssetSeed): Admission {
	// A pending asset whose import is ready is already this asset: surfaces show the
	// managed URL while the project records the pending reference.
	const ready = assets.find((asset) => readyPendingImport(asset.url)?.url === seed.url);
	if (ready) return { assets, id: ready.id, added: false };
	// The rule itself (the key is the URL) is `admitAsset`, shared with the
	// `media.admit` command so the editor and every other caller admit alike.
	return admitAsset(assets, { ...seed, id: seed.id ?? mintId() });
}

/** Admission inside command scope makes import-and-place one reversible edit. */
export function admitMediaCommand(seed: MediaAssetSeed): EditorCommand {
	return admitMedia({ ...seed, id: seed.id ?? mintId() });
}
