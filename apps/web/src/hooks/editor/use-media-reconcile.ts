/* Running the media reconciler over the live document.
 *
 * One effect covers both cases the spec names. A document change fires it, and
 * a project load IS a document change, so there is no separate load path to
 * keep in step with this one.
 *
 * The shape here is a write triggered by a write, which is what turned an
 * unmemoized autosave dependency into a storyboard version per second
 * elsewhere in this editor. Three things keep it bounded:
 *
 *   - the planner answers `null` when clean, and null returns before anything
 *     is admitted or written — the common case does nothing at all;
 *   - admission dedups on URL, so applying a plan leaves every carrier
 *     attributed and the next pass plans null (proven in media-reconcile.test);
 *   - the derived arrays are memoised on document identity, so an unchanged
 *     document does not re-fire the effect at all.
 *
 * It writes through `reviseArrays`, not `setScenes`. Recording which asset a
 * clip already plays is bookkeeping, not an edit: on the undo ledger it would
 * make undo un-admit media the operator never admitted. */
import { useEffect } from "react";
import {
	applyAudioOverlayReconcile,
	applySceneReconcile,
	applyVideoOverlayReconcile,
	planMediaReconcile,
} from "@models/timeline/media-reconcile.ts";
import type { MediaAssetSeed } from "@models/timeline/media-admission.ts";
import type { MediaAsset } from "@models/timeline/editor-media.ts";
import type { AudioOverlay, Scene, VideoOverlay } from "@maleo/shared";
import type { DerivedArrays } from "@stores/timeline-document-store.ts";

export function useMediaReconcile(input: {
	scenes: Scene[];
	videoOverlays: VideoOverlay[];
	audioOverlays: AudioOverlay[];
	mediaAssets: MediaAsset[];
	ensureMediaAsset: (seed: MediaAssetSeed) => string;
	/** The non-command document writer (see `document-writers.ts`). */
	reviseArrays: (edit: (views: DerivedArrays) => DerivedArrays) => void;
}): void {
	const { scenes, videoOverlays, audioOverlays, mediaAssets, ensureMediaAsset, reviseArrays } =
		input;
	useEffect(() => {
		const plan = planMediaReconcile({ scenes, videoOverlays, audioOverlays, assets: mediaAssets });
		if (!plan) return; // clean: no admission, no document write, no state change
		const ids = new Map<string, string>();
		for (const seed of plan.seeds) ids.set(seed.url, ensureMediaAsset(seed));
		// A carrier may point at a URL admitted before this pass — no seed, but the
		// identity still has to be written onto it.
		for (const a of mediaAssets) if (!ids.has(a.url)) ids.set(a.url, a.id);
		reviseArrays((views) => ({
			...views,
			scenes: applySceneReconcile(views.scenes, plan, ids),
			videoOverlays: applyVideoOverlayReconcile(views.videoOverlays, plan, ids),
			audioOverlays: applyAudioOverlayReconcile(views.audioOverlays, plan, ids),
		}));
	}, [scenes, videoOverlays, audioOverlays, mediaAssets, ensureMediaAsset, reviseArrays]);
}
