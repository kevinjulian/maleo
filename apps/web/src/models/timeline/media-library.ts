import type { EditorDoc } from "@models/storyboard/editor-doc.ts";
import type { MediaAsset } from "./editor-media.ts";
import { mediaDropReason, mediaPlacementDuration, placeMediaOverlay } from "./media-placement.ts";
import { usedMediaAssetIds, type MediaUsageInput } from "./media-usage.ts";
import type { ImportedMediaMetadata } from "@maleo/shared";

export const MEDIA_SORTS = ["added", "name", "type", "duration", "size"] as const;
export type MediaSort = (typeof MEDIA_SORTS)[number];

export function mediaFacts(item: {
	kind: string;
	dur?: number;
	metadata?: ImportedMediaMetadata;
}): string {
	const duration = item.metadata?.duration ?? item.dur;
	return [
		item.kind,
		duration == null ? "Duration unknown" : `${duration}s`,
		item.metadata?.byteSize == null
			? "Size unknown"
			: `${item.metadata.byteSize.toLocaleString()} bytes`,
	].join(" · ");
}

/** Unknown measurements sort last; stable identity breaks equal-value ties. */
export function sortProjectMedia<
	T extends {
		id: string;
		label: string;
		kind: string;
		dur?: number;
		metadata?: ImportedMediaMetadata;
		favorite?: boolean;
	},
>(items: readonly T[], sort: MediaSort): T[] {
	if (sort === "added")
		return [...items].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)));
	return [...items].sort((a, b) => {
		const text = (left: string, right: string) =>
			left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
		let order: number;
		if (sort === "name" || sort === "type")
			order = text(sort === "name" ? a.label : a.kind, sort === "name" ? b.label : b.kind);
		else {
			const left = sort === "duration" ? (a.metadata?.duration ?? a.dur) : a.metadata?.byteSize;
			const right = sort === "duration" ? (b.metadata?.duration ?? b.dur) : b.metadata?.byteSize;
			order = left == null ? (right == null ? 0 : 1) : right == null ? -1 : left - right;
		}
		return order || text(a.label, b.label) || a.id.localeCompare(b.id);
	});
}

export function pruneMediaSelection(
	selected: ReadonlySet<string>,
	visible: readonly string[],
): Set<string> {
	const allowed = new Set(visible);
	return new Set([...selected].filter((id) => allowed.has(id)));
}

/** One immutable result, so a failed destination never leaves partial placement. */
export function placeProjectMedia(
	doc: EditorDoc,
	assets: readonly MediaAsset[],
	ids: readonly string[],
	at: number,
	firstId: number,
): EditorDoc {
	let next = doc,
		start = at,
		id = firstId;
	for (const assetId of ids) {
		const asset = assets.find((candidate) => candidate.id === assetId);
		if (!asset) throw new Error("Media is no longer available");
		const media = { ...asset, mediaAssetId: asset.id };
		const error = mediaDropReason(media, assets);
		if (error) throw new Error(error);
		while (
			next.clips.some((clip) => clip.id === `${asset.kind === "audio" ? "audio" : "video"}:${id}`)
		)
			id++;
		const flags = next.trackFlags ?? {};
		const row = Number(
			Object.keys(flags).find(
				(key) =>
					Number(key) >= 0 &&
					flags[Number(key)]?.group === (asset.kind === "audio" ? "audio" : "visual") &&
					!flags[Number(key)]?.locked,
			) ?? 0,
		);
		const placed = placeMediaOverlay(next, media, start, row, id++);
		if (placed === next) throw new Error("Destination track locked");
		next = placed;
		start += mediaPlacementDuration(media);
	}
	return next;
}

/** Project admission only: shared stored bytes remain owned by storage policy. */
export function removeUnusedProjectMedia(
	assets: MediaAsset[],
	ids: readonly string[],
	input: MediaUsageInput,
): MediaAsset[] {
	const selected = new Set(ids),
		used = usedMediaAssetIds(input);
	return assets.filter((asset) => !selected.has(asset.id) || used.has(asset.id));
}
