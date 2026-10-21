import {
	assertSourceInterval,
	mediaCompatibilityReason,
	type Clip,
	type ReadyImportedMedia,
} from "@maleo/shared";
import type { MediaAsset } from "./editor-media.ts";
import {
	batch,
	replaceClip,
	setMediaAssets,
	type EditorCommand,
	type EditScope,
} from "@maleo/shared/editor";

export function mediaSourceIdentity(asset: MediaAsset): string {
	return `${asset.url}\n${asset.importedSource?.revision ?? "legacy"}`;
}

/** Validate against live uses before producing one reversible command. */
export function replaceProjectMedia(
	scope: Pick<EditScope, "doc" | "mediaAssets">,
	id: string,
	expectedSource: string,
	ready: ReadyImportedMedia,
): EditorCommand {
	const asset = scope.mediaAssets.find((candidate) => candidate.id === id);
	if (!asset || mediaSourceIdentity(asset) !== expectedSource)
		throw new Error("Source changed while replacement was processing");
	if (ready.kind !== asset.kind) throw new Error("Replacement must have same media type");
	const failure =
		mediaCompatibilityReason(ready.compatibility, "preview") ??
		mediaCompatibilityReason(ready.compatibility, "render");
	if (failure) throw new Error(failure);
	if (asset.importedSource?.revision === ready.importedSource.revision)
		throw new Error("Replacement requires a new source revision");
	const changes: EditorCommand[] = [];
	for (const clip of scope.doc.clips) {
		const scene = clip.scene,
			visual = clip.vis?.vclip,
			video = clip.video,
			audio = clip.audio;
		const frame = scene?.mediaAssetId === id,
			end = scene?.endMediaAssetId === id;
		const visuals = scene?.visualClips?.some((item) => item.mediaAssetId === id);
		if (
			!frame &&
			!end &&
			!visuals &&
			visual?.mediaAssetId !== id &&
			video?.mediaAssetId !== id &&
			audio?.mediaAssetId !== id
		)
			continue;
		if (scope.doc.trackFlags?.[clip.track]?.locked)
			throw new Error("Used media is on a locked track");
		const check = (start: number, duration: number, rate = 1) => {
			if (ready.kind !== "image")
				assertSourceInterval(start, duration, rate, ready.metadata.duration ?? 0);
		};
		let next: Clip = { ...clip };
		if (scene) {
			if (frame) check(0, clip.durationSec, scene.layout?.playbackRate);
			if (end) check(0, Math.min(clip.durationSec, 1 / 30));
			const visualClips = scene.visualClips?.map((item) => {
				if (item.mediaAssetId !== id) return item;
				check(
					item.mediaStartSec ?? 0,
					scene.visualClips?.length === 1 && !item.startSec ? clip.durationSec : item.durationSec,
					(item.layout ?? scene.layout)?.playbackRate,
				);
				return { ...item, url: ready.url };
			});
			next.scene = {
				...scene,
				...(frame ? { src: ready.url } : {}),
				...(end ? { endSrc: ready.url } : {}),
				...(visuals ? { visualClips } : {}),
			};
		}
		if (visual?.mediaAssetId === id) {
			check(visual.mediaStartSec ?? 0, clip.durationSec, visual.layout?.playbackRate);
			next.vis = { ...clip.vis!, vclip: { ...visual, url: ready.url } };
		}
		if (video?.mediaAssetId === id) {
			check(video.mediaStartSec ?? 0, clip.durationSec, video.layout?.playbackRate);
			next.video = { ...video, url: ready.url, thumb: ready.thumb };
		}
		if (audio?.mediaAssetId === id) {
			check(audio.mediaStartSec ?? 0, clip.durationSec, audio.playbackRate);
			next.audio = { ...audio, url: ready.url, originalDur: ready.metadata.duration };
		}
		changes.push(replaceClip(clip.id, next));
	}
	const history = asset.importedSource?.history;
	const source = asset.importedSource
		? (({ history: _history, ...revision }) => revision)(asset.importedSource)
		: undefined;
	const replacement: MediaAsset = {
		...asset,
		url: ready.url,
		thumb: ready.thumb,
		poster: undefined,
		dur: ready.dur,
		metadata: ready.metadata,
		compatibility: ready.compatibility,
		importedSource: {
			...ready.importedSource,
			history: [
				...(history ?? []),
				{ url: asset.url, metadata: asset.metadata, ...(source ? { source } : {}) },
			],
		},
	};
	return batch(
		[
			...changes,
			setMediaAssets(scope.mediaAssets.map((item) => (item.id === id ? replacement : item))),
		],
		"media.replace-source",
	);
}
