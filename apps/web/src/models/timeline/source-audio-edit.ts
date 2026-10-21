import {
	fromTimelineDoc,
	rebuildDocWith,
	retimeSourceDuration,
	retimeClipAnimation,
	sourceInterval,
	ProjectMediaProcessingResponseSchema,
	processedAudioSource,
	reversePlaybackSource,
	type ClipLayout,
	type ProcessedAudio,
	type ProjectMediaProcessingResponse,
	type SourceAudioSettings,
} from "@maleo/shared";
import type { EditorDoc } from "@models/storyboard/editor-doc.ts";
import type { MediaAsset } from "./editor-media.ts";
import { normalizeLayout } from "./clip-layout.ts";
import {
	reverseTargetSource,
	applyReverseResult,
	setReverseLayout,
	type ReverseTarget,
} from "./video-reverse.ts";
import { mediaAssetOf, applyCommand, diffScopeToCommand } from "@maleo/shared/editor";

export type SourceEditTarget = ReverseTarget | { source: "audio"; id: number };

export function sourceEditInfo(doc: EditorDoc, target: SourceEditTarget, assets: MediaAsset[]) {
	const views = fromTimelineDoc(doc);
	const audio =
		target.source === "audio" ? views.audioOverlays.find((a) => a.id === target.id) : undefined;
	const video = target.source !== "audio" ? reverseTargetSource(doc, target, assets) : undefined;
	const scene =
		target.source === "scene" ? views.scenes.find((s) => s.id === target.id) : undefined;
	const visual = scene?.visualClips?.find(
		(v) => target.source === "scene" && v.id === target.visualId,
	);
	if ((target.source === "audio" && !audio?.url) || (target.source !== "audio" && !video))
		return undefined;
	const url = audio?.url ?? video!.url,
		start = audio?.mediaStartSec ?? video?.start ?? 0,
		duration = audio?.dur ?? video!.duration;
	const settings: SourceAudioSettings & Pick<ClipLayout, "sourceAudioExtraction"> =
		audio ?? video!.layout;
	const asset = audio ? mediaAssetOf(assets, audio, "audio") : video!.asset;
	const sourceMediaId = /^\/api\/media\/([0-9a-f-]{36})$/.exec(url)?.[1],
		revision = asset?.importedSource?.revision ?? sourceMediaId;
	const volume =
		audio?.volume ??
		(target.source === "video"
			? (views.videoOverlays.find((v) => v.id === target.id)?.volume ?? 0)
			: (visual?.volume ?? (scene?.visualClips?.length === 1 ? 1 : 0)));
	return {
		url,
		start,
		duration,
		settings,
		asset,
		sourceMediaId,
		revision,
		volume,
		locked: audio ? Boolean(doc.trackFlags?.[audio.track ?? 0]?.locked) : video!.locked,
		fingerprint: JSON.stringify([
			url,
			start,
			duration,
			settings.playbackRate ?? 1,
			Boolean(settings.preservePitch),
			Boolean(settings.reverse),
			revision,
		]),
	};
}

/** Source helpers submit their recipe to the same Rust owner as timeline/API edits. */
function sourceConsequences(doc: EditorDoc, next: EditorDoc, assets: MediaAsset[]): EditorDoc {
	if (!doc.clips.some((clip) => clip.caption?.sources.length)) return next;
	const before = { doc, mediaAssets: assets, slides: [], posts: [] };
	const after = { ...before, doc: next };
	return applyCommand(before, diffScopeToCommand(before, after, "source.playback")).doc;
}

export function setSourceRate(...args: Parameters<typeof buildSourceRate>): EditorDoc {
	return sourceConsequences(args[0], buildSourceRate(...args), args[2]);
}

export function applySourceAudioResult(
	...args: Parameters<typeof buildSourceAudioResult>
): EditorDoc {
	return sourceConsequences(args[0], buildSourceAudioResult(...args), args[2]);
}

/** Source endpoints stay fixed; all unrelated absolute starts and gain stay live. */
function buildSourceRate(
	doc: EditorDoc,
	target: SourceEditTarget,
	assets: MediaAsset[],
	playbackRate: number,
	preservePitch: boolean,
	audioMedia?: ProcessedAudio,
): EditorDoc {
	const source = sourceEditInfo(doc, target, assets);
	if (!source || source.locked) return doc;
	let duration: number;
	try {
		duration = retimeSourceDuration(
			source.start,
			source.duration,
			source.settings.playbackRate ?? 1,
			playbackRate,
		);
		if (duration < 1 / 30) return doc;
		const selected = sourceInterval(source.start, duration, playbackRate);
		if (source.asset?.metadata?.duration && selected.end > source.asset.metadata.duration + 1e-6)
			return doc;
	} catch {
		return doc;
	}
	const patch: SourceAudioSettings = {
		playbackRate,
		preservePitch,
		...(audioMedia ? { audioMedia } : {}),
	};
	const ratio = (source.settings.playbackRate ?? 1) / playbackRate;
	const views = fromTimelineDoc(doc);
	if (target.source === "audio")
		return rebuildDocWith(doc, {
			audioOverlays: views.audioOverlays.map((a) =>
				a.id === target.id
					? {
							...a,
							...patch,
							dur: duration,
							...(a.animation
								? {
										animation: retimeClipAnimation(a.animation, ratio),
									}
								: {}),
						}
					: a,
			),
		});
	if (target.source === "video")
		return rebuildDocWith(doc, {
			videoOverlays: views.videoOverlays.map((v) =>
				v.id === target.id
					? {
							...v,
							layout: {
								...normalizeLayout(v.layout, "video"),
								...patch,
								...(v.layout?.animation
									? { animation: retimeClipAnimation(v.layout.animation, ratio) }
									: {}),
							},
							dur: duration,
						}
					: v,
			),
		});
	return rebuildDocWith(doc, {
		scenes: views.scenes.map((scene) => {
			if (scene.id !== target.id) return scene;
			const visual = scene.visualClips?.find((v) => v.id === target.visualId);
			if (!visual) return scene;
			const layout = normalizeLayout({ ...scene.layout, ...visual.layout }, "video");
			const single = scene.visualClips?.length === 1 && !visual.startSec;
			return {
				...scene,
				dur:
					single && scene.dur <= source.duration
						? duration
						: Math.max(scene.dur, visual.startSec + duration),
				visualClips: scene.visualClips?.map((v) =>
					v.id === target.visualId
						? {
								...v,
								durationSec: duration,
								layout: {
									...layout,
									...patch,
									...(layout.animation
										? { animation: retimeClipAnimation(layout.animation, ratio) }
										: {}),
								},
							}
						: v,
				),
			};
		}),
	});
}

function buildSourceAudioResult(
	doc: EditorDoc,
	target: SourceEditTarget,
	assets: MediaAsset[],
	fingerprint: string,
	raw: ProjectMediaProcessingResponse,
): EditorDoc {
	const source = sourceEditInfo(doc, target, assets),
		parsed = ProjectMediaProcessingResponseSchema.safeParse(raw);
	if (!source || source.locked || source.fingerprint !== fingerprint || !parsed.success)
		throw new Error("Selected source range changed or became locked; process source audio again");
	const result = parsed.data,
		operation = result.operation;
	const interval = sourceInterval(source.start, source.duration, source.settings.playbackRate ?? 1);
	if (
		operation.type !== "audio" ||
		result.status !== "ready" ||
		!result.url ||
		result.sourceMediaId !== source.sourceMediaId ||
		result.sourceRevision !== source.revision ||
		operation.startSec !== interval.start ||
		Math.abs(operation.durationSec - (interval.end - interval.start)) > 1e-6 ||
		operation.reverse !== Boolean(source.settings.reverse) ||
		!result.metadata?.duration ||
		Math.abs(result.metadata.duration - operation.durationSec / operation.playbackRate) > 0.1
	)
		throw new Error("Processed audio does not match selected source range");
	return buildSourceRate(doc, target, assets, operation.playbackRate, operation.preservePitch, {
		url: result.url,
		sourceUrl: source.url,
		sourceRevision: result.sourceRevision,
		startSec: operation.startSec,
		durationSec: operation.durationSec,
		playbackRate: operation.playbackRate,
		preservePitch: operation.preservePitch,
		reverse: operation.reverse,
	});
}

export function sourceAudioReady(source: NonNullable<ReturnType<typeof sourceEditInfo>>): boolean {
	return Boolean(processedAudioSource(source.url, source.start, source.duration, source.settings));
}

/** Finish source operations together, so no intermediate reverse/rate edit leaks. */
export function applySourcePlayback(
	doc: EditorDoc,
	target: SourceEditTarget,
	assets: MediaAsset[],
	fingerprint: string,
	playbackRate: number,
	preservePitch: boolean,
	reverse: boolean,
	results: ProjectMediaProcessingResponse[] = [],
): EditorDoc {
	const source = sourceEditInfo(doc, target, assets);
	if (!source || source.locked || source.fingerprint !== fingerprint)
		throw new Error("Selected source range changed or became locked; process again");
	const interval = sourceInterval(source.start, source.duration, source.settings.playbackRate ?? 1);
	let next = doc;
	if (target.source !== "audio") {
		const video = reverseTargetSource(doc, target, assets)!;
		const reverseResult = results.find((r) => r.operation.type === "reverse");
		if (reverseResult)
			next = applyReverseResult(next, target, assets, video.fingerprint, reverseResult);
		else if (
			reverse &&
			!reversePlaybackSource(source.url, source.start, source.duration, {
				...video.layout,
				reverse: true,
			})
		)
			throw new Error("Reverse source is unavailable; process again");
		next = setReverseLayout(next, target, { reverse });
	} else {
		const views = fromTimelineDoc(next);
		next = rebuildDocWith(next, {
			audioOverlays: views.audioOverlays.map((a) =>
				a.id === target.id
					? {
							...a,
							reverse,
						}
					: a,
			),
		});
	}
	const result = results.find((r) => r.operation.type === "audio");
	if (result) {
		if (
			result.operation.type !== "audio" ||
			result.operation.playbackRate !== playbackRate ||
			result.operation.preservePitch !== preservePitch ||
			result.operation.reverse !== reverse
		)
			throw new Error("Processed audio settings differ from request");
		next = buildSourceAudioResult(
			next,
			target,
			assets,
			sourceEditInfo(next, target, assets)!.fingerprint,
			result,
		);
	} else next = buildSourceRate(next, target, assets, playbackRate, preservePitch);
	const finished = sourceEditInfo(next, target, assets);
	if (
		!finished ||
		finished.settings.playbackRate !== playbackRate ||
		finished.settings.preservePitch !== preservePitch ||
		Math.abs(finished.duration * playbackRate - (interval.end - interval.start)) > 1e-6
	)
		throw new Error("Selected source interval cannot use requested playback settings");
	return sourceConsequences(doc, next, assets);
}
