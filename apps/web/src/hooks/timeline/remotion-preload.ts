/* Warming the images the preview is about to need.
 *
 * Images only, and the two exclusions below are measured rather than assumed —
 * this hook used to preload every asset kind in a window around the playhead,
 * and most of what it fetched was wasted:
 *
 *  - a preload is a full-body GET, and a media element streams with Range
 *    requests, which the browser keys separately. So preloading audio or video
 *    downloaded the whole file and the element then fetched it again anyway. On
 *    a 60-clip project that was 23 of 89 requests on open, and dropping media
 *    from the preload took it to 66.
 *  - a clip live at the playhead is already being drawn, so the ELEMENT is the
 *    request. Preloading it races the element for the same bytes and both go to
 *    the network. Preloading is for what comes next.
 *
 * What is left is the case a preload is actually for: the image of a clip a few
 * seconds ahead, fetched exactly the way the `<img>` that will draw it fetches,
 * so the element is served from cache when it mounts.
 */
import { useEffect } from "react";
import type { TimelinePreloadAsset } from "@models/timeline/preload-assets.ts";
// Re-exported so this module stays the import site its consumers already use.
export type { TimelinePreloadAsset };

const active = new Map<string, HTMLImageElement>();

/** Start an image download, or do nothing if one is already in flight for it.
 *
 *  `Image()` rather than `fetch` or `<link rel=preload>`: it makes byte for byte
 *  the request the `<img>` will make, which is what puts the response in the
 *  cache entry the element reads. A `fetch` lands in a different one. */
function prefetchImageAsset(url: string | undefined): void {
	if (!url || url.startsWith("data:") || active.has(url)) return;
	const image = new Image();
	image.decoding = "async";
	image.src = url;
	active.set(url, image);
}

/** Drop a preload. The element that draws the image keeps the cache entry; this
 *  only releases the request handle held to stop it being collected early. */
function release(url: string): void {
	const image = active.get(url);
	if (!image) return;
	active.delete(url);
	image.src = "";
}

export function useTimelineAssetPreload(
	assets: TimelinePreloadAsset[],
	playheadSec: number,
	windowSec = 12,
): void {
	useEffect(
		() => () => {
			// Snapshot: `release` deletes from `active`, so this must not walk the
			// live key view.
			for (const url of Array.from(active.keys())) release(url);
		},
		[],
	);

	useEffect(() => {
		const to = playheadSec + windowSec;
		const wanted = new Set<string>();
		for (const asset of assets) {
			if (asset.kind !== "image" || !asset.url) continue;
			// Ahead of the playhead and inside the window: not yet drawn, soon needed.
			if (asset.startSec <= playheadSec || asset.startSec > to) continue;
			wanted.add(asset.url);
			prefetchImageAsset(asset.url);
		}
		for (const url of active.keys()) if (!wanted.has(url)) release(url);
	}, [assets, playheadSec, windowSec]);
}
