import {
	fromTimelineDoc,
	rebuildDocWith,
	ProjectMediaProcessingResponseSchema,
	reversePlaybackSource,
	sourceInterval,
	sceneVisualSourceDuration,
	type ProjectMediaProcessingResponse,
	type ClipLayout,
} from "@maleo/shared";
import type { EditorDoc } from "@models/storyboard/editor-doc.ts";
import type { MediaAsset } from "./editor-media.ts";
import { normalizeLayout } from "./clip-layout.ts";
import { mediaAssetOf } from "@maleo/shared/editor";

export type ReverseTarget =
	| { source: "video"; id: number }
	| { source: "scene"; id: number; visualId: string };

export function reverseTargetSource(doc: EditorDoc, target: ReverseTarget, assets: MediaAsset[]) {
	const views = fromTimelineDoc(doc);
	const scene =
		target.source === "scene" ? views.scenes.find((s) => s.id === target.id) : undefined;
	const visual =
		target.source === "scene"
			? scene?.visualClips?.find((v) => v.id === target.visualId)
			: views.videoOverlays.find((v) => v.id === target.id);
	if (!visual || visual.kind !== "video") return undefined;
	const layout = normalizeLayout(
		scene?.layout || visual.layout ? { ...scene?.layout, ...visual.layout } : undefined,
		"video",
	);
	const duration = scene
		? scene.visualClips?.length === 1 && !("startSec" in visual && visual.startSec)
			? sceneVisualSourceDuration(
					"durationSec" in visual ? visual.durationSec : scene.dur,
					scene.dur,
					layout,
				)
			: "durationSec" in visual
				? visual.durationSec
				: 0
		: "dur" in visual
			? visual.dur
			: 0;
	const asset = mediaAssetOf(assets, visual, "video");
	const sourceMediaId = /^\/api\/media\/([0-9a-f-]{36})$/.exec(visual.url)?.[1];
	const revision = asset?.importedSource?.revision ?? sourceMediaId;
	return {
		url: visual.url,
		start: visual.mediaStartSec ?? 0,
		duration,
		layout,
		asset,
		sourceMediaId,
		revision,
		locked: Boolean(
			doc.trackFlags?.[scene ? -1 : "track" in visual ? (visual.track ?? 0) : 0]?.locked,
		),
		fingerprint: JSON.stringify([
			visual.url,
			visual.mediaStartSec ?? 0,
			duration,
			layout.playbackRate ?? 1,
			revision,
		]),
	};
}

/** Async completion is one live-document edit, after exact operation validation. */
export function applyReverseResult(
	doc: EditorDoc,
	target: ReverseTarget,
	assets: MediaAsset[],
	fingerprint: string,
	raw: ProjectMediaProcessingResponse,
): EditorDoc {
	const source = reverseTargetSource(doc, target, assets);
	const parsed = ProjectMediaProcessingResponseSchema.safeParse(raw);
	if (!source || source.locked || source.fingerprint !== fingerprint || !parsed.success)
		throw new Error("Selected source range changed or became locked; reverse again");
	const result = parsed.data,
		interval = sourceInterval(source.start, source.duration, source.layout.playbackRate);
	if (
		result.operation.type !== "reverse" ||
		result.status !== "ready" ||
		!result.url ||
		result.sourceMediaId !== source.sourceMediaId ||
		result.sourceRevision !== source.revision ||
		result.operation.startSec !== interval.start ||
		Math.abs(result.operation.durationSec - (interval.end - interval.start)) > 0.000001 ||
		!result.metadata?.duration ||
		Math.abs(result.metadata.duration - (interval.end - interval.start)) > 0.1
	)
		throw new Error("Reverse output does not match selected source range");
	return setReverseLayout(doc, target, {
		reverse: true,
		reverseMedia: {
			url: result.url,
			sourceUrl: source.url,
			sourceRevision: result.sourceRevision,
			startSec: interval.start,
			durationSec: interval.end - interval.start,
		},
	});
}

export function setReverseLayout(
	doc: EditorDoc,
	target: ReverseTarget,
	patch: Partial<ClipLayout>,
): EditorDoc {
	const views = fromTimelineDoc(doc);
	if (target.source === "video") {
		const video = views.videoOverlays.find((v) => v.id === target.id);
		if (!video || doc.trackFlags?.[video.track ?? 0]?.locked) return doc;
		return rebuildDocWith(doc, {
			videoOverlays: views.videoOverlays.map((v) =>
				v.id === target.id
					? { ...v, layout: { ...normalizeLayout(v.layout, "video"), ...patch } }
					: v,
			),
		});
	}
	if (doc.trackFlags?.[-1]?.locked) return doc;
	return rebuildDocWith(doc, {
		scenes: views.scenes.map((scene) =>
			scene.id === target.id
				? {
						...scene,
						visualClips: scene.visualClips?.map((v) =>
							v.id === target.visualId
								? {
										...v,
										layout: {
											...normalizeLayout(
												{
													...scene.layout,
													...v.layout,
												},
												"video",
											),
											...patch,
										},
									}
								: v,
						),
					}
				: scene,
		),
	});
}

export function canReuseReverse(
	source: NonNullable<ReturnType<typeof reverseTargetSource>>,
): boolean {
	return (
		source.layout.reverseMedia?.sourceRevision === source.revision &&
		Boolean(
			reversePlaybackSource(source.url, source.start, source.duration, {
				...source.layout,
				reverse: true,
			}),
		)
	);
}
