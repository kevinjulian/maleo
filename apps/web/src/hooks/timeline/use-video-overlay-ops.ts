/* Maleo — b-roll / video-overlay ops for the timeline editor: add an overlay
 * clip (image or video) at the playhead, patch/remove it, and resolve the
 * current selection. Adding one deselects the scene/text/audio surfaces so the
 * right-hand editor targets the new clip. */
import type { Dispatch, SetStateAction } from "react";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { VideoOverlay } from "@maleo/shared";
import { retainClipAnimation, trimMediaTiming } from "@maleo/shared";
import type { MediaAsset } from "@models/timeline/editor-media.ts";

export interface VideoOverlayOps {
	/** `mediaAssetId` on the seed is optional only because a drag has already
	 *  admitted and can hand the id straight over. Every other caller admits
	 *  first and passes the answer — an overlay carrying a URL the project never
	 *  admitted is media the panel cannot see and deletion loses. */
	addVideoOverlay: (seed: Partial<VideoOverlay> & { url: string; kind: "image" | "video" }) => void;
	updateVideoOverlay: (id: number, patch: Partial<VideoOverlay>) => void;
	removeVideoOverlay: (id: number) => void;
	selectedVideoOverlay: VideoOverlay | null;
}

export function useVideoOverlayOps(input: {
	mediaAssets: MediaAsset[];
	videoOverlays: VideoOverlay[];
	setVideoOverlays: Dispatch<SetStateAction<VideoOverlay[]>>;
	selectedVideoOvId: number | null;
	setSelectedVideoOvId: Dispatch<SetStateAction<number | null>>;
	playhead: PlayheadHandle;
	total: number;
	setEditorSceneId: Dispatch<SetStateAction<number | undefined>>;
	setSelectedOverlayId: Dispatch<SetStateAction<number | null>>;
	setSelectedAudioId: Dispatch<SetStateAction<number | null>>;
}): VideoOverlayOps {
	const {
		videoOverlays,
		setVideoOverlays,
		selectedVideoOvId,
		setSelectedVideoOvId,
		playhead,
		total,
		setEditorSceneId,
		setSelectedOverlayId,
		setSelectedAudioId,
	} = input;

	const addVideoOverlay = (
		seed: Partial<VideoOverlay> & { url: string; kind: "image" | "video" },
	): void => {
		const id = Date.now();
		const asset = input.mediaAssets.find((item) => item.id === seed.mediaAssetId);
		const sourceDuration =
			seed.sourceDurationSec ??
			asset?.metadata?.duration ??
			(asset?.kind === "video" ? asset.dur : undefined);
		setVideoOverlays((v) => [
			...v,
			{
				id,
				mediaAssetId: seed.mediaAssetId,
				url: seed.url,
				kind: seed.kind,
				thumb: seed.thumb ?? asset?.thumb,
				label: seed.label,
				sourceDurationSec: sourceDuration,
				start: seed.start ?? Math.max(0, Math.min(playhead.get(), Math.max(0, total - 3))),
				dur:
					seed.kind === "video"
						? Math.min(seed.dur ?? 5, sourceDuration ?? Infinity)
						: (seed.dur ?? 3),
				track: seed.track ?? 0,
				source: seed.source ?? "upload",
			},
		]);
		setSelectedVideoOvId(id);
		setEditorSceneId(undefined);
		setSelectedOverlayId(null);
		setSelectedAudioId(null);
	};
	const updateVideoOverlay = (id: number, patch: Partial<VideoOverlay>): void =>
		setVideoOverlays((items) =>
			items.map((item) => {
				if (item.id !== id) return item;
				if (
					item.kind === "video" &&
					patch.dur != null &&
					patch.mediaStartSec == null &&
					patch.url == null
				) {
					const timing = trimMediaTiming(
						item,
						patch,
						input.mediaAssets.find((asset) => asset.id === item.mediaAssetId)?.metadata?.duration ??
							item.sourceDurationSec,
					);
					return timing ? { ...item, ...patch, ...timing } : item;
				}
				if (patch.dur != null && item.layout?.animation) {
					const from = (patch.start ?? item.start) - item.start;
					return {
						...item,
						...patch,
						layout: {
							...item.layout,
							...patch.layout,
							animation: retainClipAnimation(item.layout.animation, from, from + patch.dur),
						},
					};
				}
				return { ...item, ...patch };
			}),
		);
	const removeVideoOverlay = (id: number): void => {
		setVideoOverlays((v) => v.filter((x) => x.id !== id));
		if (selectedVideoOvId === id) setSelectedVideoOvId(null);
	};
	const selectedVideoOverlay = videoOverlays.find((v) => v.id === selectedVideoOvId) ?? null;
	return { addVideoOverlay, updateVideoOverlay, removeVideoOverlay, selectedVideoOverlay };
}
