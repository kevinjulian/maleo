/* Maleo — per-scene visual-clip ops for the timeline editor. A beat can hold
 * multiple images/videos, each owning its own start/duration; these mutate the
 * scene's visualClips without warping the beat. Lifted out so the editor holds
 * state, not visualClips array math. */
import type { Dispatch, SetStateAction } from "react";
import type { Scene } from "@maleo/shared";
import { resequenceScenes } from "@maleo/shared";
import type { MediaAssetSeed } from "@models/timeline/media-admission.ts";
import { sceneVisualPlacement } from "@models/timeline/media-placement.ts";
import { seedForArtifact } from "@models/timeline/media-seeds.ts";

export interface VisualClipOps {
	setSceneVisual: (sceneId: number, url: string) => void;
	/** `mediaAssetId` is optional only because the drag path resolves it before
	 *  calling. Any other caller must pass one, or admit through `setSceneVisual`
	 *  — a visual whose asset was never admitted is the defect this closed. */
	addVisualClip: (
		sceneId: number,
		url: string,
		kind?: "image" | "video",
		mediaAssetId?: string,
	) => void;
	removeVisualClip: (sceneId: number, vclipId: string) => void;
	extendVisualClipDur: (sceneId: number, vclipId: string | null, add: number) => void;
}

export function useVisualClipOps(
	setScenes: Dispatch<SetStateAction<Scene[]>>,
	/** Admission. This op took no asset id at all, so every caller that swapped a
	 *  beat's frame introduced media the project never recorded. */
	ensureMediaAsset: (seed: MediaAssetSeed) => string,
): VisualClipOps {
	const setSceneVisual = (sceneId: number, url: string): void => {
		if (!url) return;
		// Admitted before the updater, not inside it: an updater is expected to be a
		// pure function of the previous value, and admission is a state write.
		const mediaAssetId = ensureMediaAsset(seedForArtifact({ url, mediaType: "image" }));
		setScenes((ss) =>
			resequenceScenes(
				ss.map((scene) =>
					scene.id !== sceneId
						? scene
						: {
								...scene,
								src: url,
								mediaAssetId,
								img: true,
								visualClips: [
									{
										id: `scene-${sceneId}-visual-primary`,
										kind: "image" as const,
										label: scene.name || "Media",
										url,
										mediaAssetId,
										startSec: 0,
										durationSec: scene.dur,
										primary: true,
									},
									...(scene.visualClips ?? []).filter((c) => !c.primary && c.url !== url),
								],
							},
				),
			),
		);
	};
	// Append another visual clip to a beat (multiple images/videos per beat). Each clip
	// keeps its OWN timing — the beat never resizes existing clips. A new clip is placed
	// in the remaining space after the last one (Remotion plays visualClips by their own
	// start/duration).
	const addVisualClip = (
		sceneId: number,
		url: string,
		kind: "image" | "video" = "image",
		mediaAssetId?: string,
	): void => {
		if (!url) return;
		setScenes((ss) =>
			resequenceScenes(
				ss.map((scene) => {
					if (scene.id !== sceneId) return scene;
					const existing = scene.visualClips?.length
						? scene.visualClips
						: scene.src
							? [
									{
										id: `scene-${sceneId}-visual-primary`,
										kind: "image" as const,
										label: scene.name || "Media",
										url: scene.src,
										startSec: 0,
										durationSec: scene.dur,
										primary: true,
									},
								]
							: [];
					const { startSec, durationSec } = sceneVisualPlacement(scene);
					const next = [
						...existing,
						{
							id: `vis-${sceneId}-${Date.now()}`,
							kind,
							label: scene.name || "Media",
							url,
							mediaAssetId,
							startSec,
							durationSec,
							primary: false,
						},
					];
					return { ...scene, img: true, src: next[0]!.url, visualClips: next };
				}),
			),
		);
	};
	// Remove a visual clip from a beat WITHOUT re-timing the others (clips own their timing).
	const removeVisualClip = (sceneId: number, vclipId: string): void => {
		setScenes((ss) =>
			resequenceScenes(
				ss.map((scene) => {
					if (scene.id !== sceneId || !scene.visualClips?.length) return scene;
					const kept = scene.visualClips.filter((v) => v.id !== vclipId);
					if (!kept.length) return { ...scene, visualClips: [] };
					const primary = kept.find((v) => v.primary) ?? kept[0]!;
					return {
						...scene,
						src: primary.url,
						visualClips: kept.map((v) => ({ ...v, primary: v.id === primary.id })),
					};
				}),
			),
		);
	};
	// Extend one visual clip's own durationSec (used to close intra-beat gaps in a
	// multi-image scene — scene.dur must NOT be touched there or the beat warps).
	// vclipId null targets the beat's primary visual.
	const extendVisualClipDur = (sceneId: number, vclipId: string | null, add: number): void => {
		setScenes((ss) =>
			resequenceScenes(
				ss.map((scene) => {
					if (scene.id !== sceneId || !scene.visualClips?.length) return scene;
					const target = vclipId
						? scene.visualClips.find((v) => v.id === vclipId)
						: (scene.visualClips.find((v) => v.primary) ?? scene.visualClips[0]);
					if (!target) return scene;
					return {
						...scene,
						visualClips: scene.visualClips.map((v) =>
							v.id === target.id
								? {
										...v,
										durationSec: Math.max(
											0.5,
											Math.round(((v.durationSec ?? scene.dur) + add) * 100) / 100,
										),
									}
								: v,
						),
					};
				}),
			),
		);
	};
	return { setSceneVisual, addVisualClip, removeVisualClip, extendVisualClipDur };
}
