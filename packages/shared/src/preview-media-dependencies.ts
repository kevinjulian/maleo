import { mediaAssetOf } from "./editor/media-identity.ts";
import type { MediaAsset } from "./editor/scope.ts";
import { mediaUrl, mediaUrlId } from "./media-id.ts";
import {
	mediaHasAudio,
	processedAudioSource,
	type SourceAudioSettings,
} from "./processed-audio.ts";
import { sceneRenderImage } from "./render-storyboard.ts";
import { reversePlaybackSource } from "./reverse-media.ts";
import { sceneVisualSourceDuration } from "./source-interval.ts";
import type { TimelineDoc } from "./timeline-doc.ts";
import type { ClipLayout, RefsState } from "./timeline-model.ts";

export interface PreviewMediaSource {
	id: string;
	revision: string;
	url: string;
	kinds: MediaAsset["kind"][];
	clipIds: string[];
}
export interface PreviewMediaDependencies {
	sources: PreviewMediaSource[];
	clips: Array<{ id: string; sourceIds: string[]; blockers: string[] }>;
}
export interface PreviewMediaDependencyInput {
	workspaceId: string;
	projectId: string;
	/** Changes only when legacy source bytes change, never for layout/track edits. */
	legacyGeneration: string;
	/** Session File replacement revision for an authored URL, when it names a pending file. */
	pendingRevision?: (url: string) => string | undefined;
	doc: TimelineDoc;
	mediaAssets: readonly MediaAsset[];
	refs: RefsState;
}

/** Inventory precedes visibility, mute and solo filtering. No IO or persisted readiness. */
export function previewMediaDependencies(
	input: PreviewMediaDependencyInput,
): PreviewMediaDependencies {
	const sources = new Map<string, PreviewMediaSource>();
	const clips: PreviewMediaDependencies["clips"] = [];
	const scenes = new Map(
		input.doc.clips.flatMap((item) => (item.scene ? [[item.scene.id, item.scene] as const] : [])),
	);
	for (const clip of input.doc.clips) {
		const sourceIds = new Set<string>();
		const blockers: string[] = [];
		function add(url: string | undefined, kind: MediaAsset["kind"], asset?: MediaAsset): void {
			if (!url) return;
			const identity = mediaUrlId(url) ?? url;
			const id = JSON.stringify([input.workspaceId, input.projectId, identity]);
			const revision =
				input.pendingRevision?.(url) ??
				asset?.importedSource?.revision ??
				(mediaUrlId(url) ? identity : input.legacyGeneration);
			const existing = sources.get(id);
			if (existing) {
				if (!existing.clipIds.includes(clip.id)) existing.clipIds.push(clip.id);
				if (!existing.kinds.includes(kind)) existing.kinds = [...existing.kinds, kind].sort();
			} else sources.set(id, { id, revision, url, kinds: [kind], clipIds: [clip.id] });
			sourceIds.add(id);
		}
		function original(
			url: string,
			kind: MediaAsset["kind"],
			mediaAssetId?: string,
		): MediaAsset | undefined {
			const asset = mediaAssetOf(input.mediaAssets, { url, mediaAssetId });
			add(url, kind, asset);
			if (asset?.importedSource) add(mediaUrl(asset.importedSource.originalMediaId), kind, asset);
			return asset;
		}
		function audio(
			url: string,
			start: number,
			duration: number,
			settings: SourceAudioSettings,
			asset?: MediaAsset,
		): void {
			if ((settings.playbackRate ?? 1) === 1 && !settings.reverse) return;
			const source = processedAudioSource(url, start, duration, settings);
			if (
				!source ||
				(asset?.importedSource &&
					settings.audioMedia?.sourceRevision !== asset.importedSource.revision)
			) {
				blockers.push(
					"Processed audio is unavailable or changed. Process this source range again.",
				);
				return;
			}
			add(source.url, "audio");
		}
		function visual(
			url: string,
			kind: "video" | "image",
			start: number,
			duration: number,
			layout?: Partial<ClipLayout>,
			mediaAssetId?: string,
		): void {
			const asset = original(url, kind, mediaAssetId);
			if (kind === "image") return;
			if (layout?.reverse) {
				const source = reversePlaybackSource(url, start, duration, layout);
				if (
					!source ||
					(asset?.importedSource &&
						layout.reverseMedia?.sourceRevision !== asset.importedSource.revision)
				) {
					blockers.push(
						"Reverse source is unavailable or changed. Process this source range again.",
					);
				} else add(source.url, "video");
			}
			if (
				layout?.preservePitch !== undefined &&
				(layout.playbackRate ?? 1) !== 1 &&
				!layout.sourceAudioExtraction &&
				mediaHasAudio(input.mediaAssets, url, mediaAssetId) !== false
			) {
				audio(url, start, duration, layout, asset);
			}
		}
		if (clip.video) {
			const value = clip.video;
			visual(
				value.url,
				value.kind,
				value.mediaStartSec ?? 0,
				clip.durationSec,
				value.layout,
				value.mediaAssetId,
			);
		}
		if (clip.audio?.url) {
			const value = clip.audio;
			const asset = original(value.url!, "audio", value.mediaAssetId);
			audio(value.url!, value.mediaStartSec ?? 0, clip.durationSec, value, asset);
		}
		if (clip.vis) {
			const value = clip.vis.vclip;
			const parent = scenes.get(clip.vis.sceneId);
			visual(
				value.url,
				value.kind,
				value.mediaStartSec ?? 0,
				clip.durationSec,
				{ ...parent?.layout, ...value.layout },
				value.mediaAssetId,
			);
		}
		if (clip.scene) {
			const scene = clip.scene;
			const visuals = scene.visualClips ?? [];
			if (!visuals.length)
				original(sceneRenderImage(scene, input.refs), "image", scene.mediaAssetId);
			for (const value of visuals) {
				const layout = { ...scene.layout, ...value.layout };
				const duration =
					visuals.length === 1 && value.startSec <= 0
						? sceneVisualSourceDuration(value.durationSec, clip.durationSec, layout)
						: value.durationSec;
				visual(
					value.url,
					value.kind,
					value.mediaStartSec ?? 0,
					duration,
					layout,
					value.mediaAssetId,
				);
			}
			if (scene.endSrc) original(scene.endSrc, "image", scene.endMediaAssetId);
		}
		// Media-free clips stay out so text/shape edits keep the generation and playback.
		if (sourceIds.size || blockers.length)
			clips.push({
				id: clip.id,
				sourceIds: [...sourceIds].sort(),
				blockers: [...new Set(blockers)],
			});
	}
	return { sources: [...sources.values()].sort((a, b) => a.id.localeCompare(b.id)), clips };
}
