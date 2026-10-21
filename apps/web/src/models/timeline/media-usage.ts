/* Which admitted assets the document actually references.
 *
 * This is the project's media set. It is derived, not stored: an asset is in it
 * because a clip points at it, and leaves when the last clip stops. Every
 * surface that shows "the project's media" reads this rather than the saved
 * list, which is what makes the panel a manifest instead of a shelf.
 *
 * All five carriers have to be read, not just the overlay lane. A beat's frame,
 * a beat's end frame, an extra visual inside a beat, an overlay clip and an
 * audio clip are five different records, and reading only the last of them was
 * why the set could not see the majority of placed media. */
import type { AudioOverlay, Scene, VideoOverlay } from "@maleo/shared";

export interface MediaUsageInput {
	scenes: Scene[];
	videoOverlays: VideoOverlay[];
	audioOverlays: AudioOverlay[];
}

export interface MediaUsage {
	key: string;
	label: string;
	ref: { type: "scene" | "broll" | "audio"; id: number };
	/** Scene-local visual offset; overlay starts come from their canonical clip. */
	offset: number;
}

export function mediaUsages(
	assetId: string,
	{ scenes, videoOverlays, audioOverlays }: MediaUsageInput,
): MediaUsage[] {
	const result: MediaUsage[] = [];
	for (const scene of scenes) {
		const ref = { type: "scene" as const, id: scene.id };
		if (scene.mediaAssetId === assetId)
			result.push({
				key: `scene:${scene.id}:frame`,
				label: `${scene.name} · frame`,
				ref,
				offset: 0,
			});
		if (scene.endMediaAssetId === assetId)
			result.push({
				key: `scene:${scene.id}:end`,
				label: `${scene.name} · end frame`,
				ref,
				offset: Math.max(0, scene.dur - 1 / 30),
			});
		for (const visual of scene.visualClips ?? []) {
			if (
				visual.mediaAssetId !== assetId ||
				(visual.primary && visual.url === scene.src && scene.mediaAssetId === assetId)
			)
				continue;
			result.push({
				key: `scene:${scene.id}:${visual.id}`,
				label: `${scene.name} · ${visual.label}`,
				ref,
				offset: visual.startSec,
			});
		}
	}
	for (const video of videoOverlays)
		if (video.mediaAssetId === assetId)
			result.push({
				key: `video:${video.id}`,
				label: video.label ?? `Video ${video.id}`,
				ref: { type: "broll", id: video.id },
				offset: 0,
			});
	for (const audio of audioOverlays)
		if (audio.mediaAssetId === assetId)
			result.push({
				key: `audio:${audio.id}`,
				label: audio.content || `Audio ${audio.id}`,
				ref: { type: "audio", id: audio.id },
				offset: 0,
			});
	return result;
}

/** Where an asset is used, as a clip reference the editor can jump to.
 *
 *  This is what replaced Delete on the media panel. Membership follows from use,
 *  so an asset cannot be removed while a clip holds it — an operator who wants
 *  it gone needs to be shown the clip, not offered an action that cannot take
 *  effect. Scenes are checked first because a beat's frame is the placement an
 *  operator is most likely to be looking for. */
export function firstClipUsing(
	assetId: string,
	{ scenes, videoOverlays, audioOverlays }: MediaUsageInput,
): { type: "scene" | "broll" | "audio"; id: number } | null {
	const scene = scenes.find(
		(s) =>
			s.mediaAssetId === assetId ||
			s.endMediaAssetId === assetId ||
			(s.visualClips ?? []).some((v) => v.mediaAssetId === assetId),
	);
	if (scene) return { type: "scene", id: scene.id };
	const video = videoOverlays.find((v) => v.mediaAssetId === assetId);
	if (video) return { type: "broll", id: video.id };
	const audio = audioOverlays.find((a) => a.mediaAssetId === assetId);
	if (audio) return { type: "audio", id: audio.id };
	return null;
}

export function usedMediaAssetIds({
	scenes,
	videoOverlays,
	audioOverlays,
}: MediaUsageInput): Set<string> {
	const used = new Set<string>();
	const add = (id: string | undefined): void => {
		if (id) used.add(id);
	};
	for (const s of scenes) {
		add(s.mediaAssetId);
		add(s.endMediaAssetId);
		for (const v of s.visualClips ?? []) add(v.mediaAssetId);
	}
	for (const v of videoOverlays) add(v.mediaAssetId);
	for (const a of audioOverlays) add(a.mediaAssetId);
	return used;
}
