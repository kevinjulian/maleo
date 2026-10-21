import {
	audioAnimationSchema,
	fromTimelineDoc,
	rebuildDocWith,
	sourceInterval,
	type AudioOverlay,
	type ProjectMediaProcessingResponse,
} from "@maleo/shared";
import type { EditorDoc } from "@models/storyboard/editor-doc.ts";
import { admitMediaAsset } from "./media-admission.ts";
import { diffScopeToCommand, deepEqual } from "@maleo/shared/editor";
import { applySourceAudioResult, sourceEditInfo } from "./source-audio-edit.ts";
import { setReverseLayout, type ReverseTarget } from "./video-reverse.ts";
import type { EditorCommand, EditScope } from "@maleo/shared/editor";

function sourceVisual(doc: EditorDoc, target: ReverseTarget) {
	const views = fromTimelineDoc(doc);
	const scene =
		target.source === "scene" ? views.scenes.find((s) => s.id === target.id) : undefined;
	const visual = scene?.visualClips?.find(
		(v) => target.source === "scene" && v.id === target.visualId,
	);
	const video =
		target.source === "video" ? views.videoOverlays.find((v) => v.id === target.id) : undefined;
	return {
		scene,
		visual,
		video,
		layout: video?.layout ?? { ...scene?.layout, ...visual?.layout },
		start: scene ? (scene.start ?? 0) + (visual?.startSec ?? 0) : (video?.start ?? 0),
		volume: visual?.volume ?? video?.volume,
	};
}

function sourceVolume(
	doc: EditorDoc,
	target: ReverseTarget,
	volume: number | undefined,
): EditorDoc {
	const views = fromTimelineDoc(doc);
	return target.source === "video"
		? rebuildDocWith(doc, {
				videoOverlays: views.videoOverlays.map((v) => (v.id === target.id ? { ...v, volume } : v)),
			})
		: rebuildDocWith(doc, {
				scenes: views.scenes.map((s) =>
					s.id === target.id
						? {
								...s,
								visualClips: s.visualClips?.map((v) =>
									v.id === target.visualId ? { ...v, volume } : v,
								),
							}
						: s,
				),
			});
}

/** Only ready matched audio can admit, place, link and mute in one command. */
export function extractSourceAudio(
	scope: EditScope,
	target: ReverseTarget,
	fingerprint: string,
	result: ProjectMediaProcessingResponse,
): EditorCommand {
	const info = sourceEditInfo(scope.doc, target, scope.mediaAssets);
	if (
		!info ||
		info.locked ||
		info.settings.sourceAudioExtraction ||
		info.asset?.metadata?.hasAudio === false
	)
		throw new Error("Source is locked, already extracted or has no audio");
	if (
		result.operation.type !== "audio" ||
		result.operation.playbackRate !== (info.settings.playbackRate ?? 1) ||
		result.operation.preservePitch !== Boolean(info.settings.preservePitch)
	)
		throw new Error("Extraction settings differ from selected source");
	applySourceAudioResult(scope.doc, target, scope.mediaAssets, fingerprint, result);
	if (!result.url || !result.metadata) throw new Error("Extracted audio is unavailable");
	const views = fromTimelineDoc(scope.doc),
		visual = sourceVisual(scope.doc, target);
	const track = Math.max(0, ...scope.doc.clips.map((c) => c.track)) + 1;
	if (scope.doc.trackFlags?.[track]?.locked) throw new Error("Audio destination is locked");
	const admission = admitMediaAsset(scope.mediaAssets, {
		id: `extracted-${result.id}`,
		kind: "audio",
		audioKind: "sfx",
		source: "generated",
		label: `${info.asset?.label ?? "Video"} audio`,
		url: result.url,
		dur: info.duration,
		metadata: result.metadata,
	});
	const id = Math.max(0, ...views.audioOverlays.map((a) => a.id)) + 1;
	const gainKeys = visual.layout?.animation?.tracks.volume;
	const audio: AudioOverlay = {
		id,
		kind: "sfx",
		content: "",
		url: result.url,
		mediaAssetId: admission.id,
		start: visual.start,
		dur: info.duration,
		track,
		mediaStartSec: 0,
		originalDur: result.metadata.duration,
		volume: info.volume,
		duckUnderVoice: 1,
		...(gainKeys?.length
			? { animation: audioAnimationSchema.parse({ tracks: { volume: gainKeys } }) }
			: {}),
	};
	const interval = sourceInterval(info.start, info.duration, info.settings.playbackRate ?? 1);
	let doc = sourceVolume(scope.doc, target, 0);
	doc = setReverseLayout(doc, target, {
		sourceAudioExtraction: {
			audioClipId: `audio:${id}`,
			priorVolume: visual.volume,
			priorGainKeys: gainKeys?.map((k) => ({ ...k })) ?? [],
			priorAudio: {
				preservePitch: info.settings.preservePitch,
				audioMedia: info.settings.audioMedia,
			},
			source: {
				url: info.url,
				startSec: interval.start,
				durationSec: interval.end - interval.start,
				playbackRate: info.settings.playbackRate ?? 1,
				preservePitch: Boolean(info.settings.preservePitch),
				reverse: Boolean(info.settings.reverse),
			},
			audioSnapshot: audio,
		},
	});
	doc = rebuildDocWith(doc, { audioOverlays: [...views.audioOverlays, audio] });
	return diffScopeToCommand(scope, { ...scope, doc, mediaAssets: admission.assets });
}

export function sourceAudioRecovery(
	scope: Pick<EditScope, "doc" | "mediaAssets">,
	target: ReverseTarget,
) {
	const info = sourceEditInfo(scope.doc, target, scope.mediaAssets);
	const link = info?.settings.sourceAudioExtraction;
	if (!info || !link) return undefined;
	const clip = scope.doc.clips.find((c) => c.id === link.audioClipId);
	return {
		link,
		clip,
		edited: Boolean(clip && !deepEqual(clip.audio, link.audioSnapshot)),
		locked: info.locked || Boolean(clip && scope.doc.trackFlags?.[clip.track]?.locked),
	};
}

/** Independent edits require a declared choice; stored asset remains available. */
export function recoverSourceAudio(
	scope: EditScope,
	target: ReverseTarget,
	choice?: "keep" | "discard",
): EditorCommand {
	const recovery = sourceAudioRecovery(scope, target);
	if (
		recovery &&
		(!/^audio:\d+$/.test(recovery.link.audioClipId) || (recovery.clip && !recovery.clip.audio))
	)
		throw new Error("Extraction link does not identify an audio clip");
	if (!recovery || recovery.locked)
		throw new Error("Source or extracted audio is locked or unavailable");
	if (recovery.edited && !choice)
		throw new Error("Extracted audio changed; choose keep or discard");
	let doc = sourceVolume(scope.doc, target, recovery.link.priorVolume);
	const layout = sourceVisual(doc, target).layout;
	const tracks = { ...layout?.animation?.tracks };
	if (recovery.link.priorGainKeys !== undefined) {
		if (recovery.link.priorGainKeys.length) tracks.volume = recovery.link.priorGainKeys;
		else delete tracks.volume;
	}
	doc = setReverseLayout(doc, target, {
		sourceAudioExtraction: undefined,
		preservePitch: recovery.link.priorAudio?.preservePitch,
		audioMedia: recovery.link.priorAudio?.audioMedia,
		...(recovery.link.priorGainKeys === undefined
			? {}
			: { animation: Object.keys(tracks).length ? { tracks } : undefined }),
	});
	if (choice !== "keep")
		doc = { ...doc, clips: doc.clips.filter((c) => c.id !== recovery.link.audioClipId) };
	return diffScopeToCommand(scope, { ...scope, doc });
}
