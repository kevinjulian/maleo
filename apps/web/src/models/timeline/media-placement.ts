import {
	clipId,
	occupiesFreeLane,
	withMirroredTiming,
	type Clip,
	type LaneGroup,
	type Scene,
	type TrackFlags,
} from "@maleo/shared";
import { normalizeAudioOrigin } from "@maleo/shared/audio-overlays";
import { type SnapCandidate } from "@models/timeline-view/engagement.ts";
import type { Engine } from "@maleo/shared/editor";
import { snapTicks } from "@models/editor-engine/policy-gesture.ts";
import type { EditorDoc } from "@models/storyboard/editor-doc.ts";
import type { MediaDropInfo } from "./timeline-drops.ts";
import type { MediaAsset } from "./editor-media.ts";
import { mediaUseReason } from "./pending-media-asset.ts";
import { CONTENT_TIMEBASE } from "./content-document-adapter.ts";
import {
	canonicalInsertRow,
	laneGroups,
	routeToLane,
	withLaneInserted,
} from "./lane-bookkeeping.ts";

export function mediaDropReason(
	media: MediaDropInfo,
	assets: readonly MediaAsset[],
): string | undefined {
	if (!media.url.trim()) return "Media is not ready";
	if (media.mediaAssetId) {
		const asset = assets.find((a) => a.id === media.mediaAssetId);
		if (!asset) return "Media is no longer available";
		if (asset.kind !== media.kind) return "Media type does not match source";
		if (asset.url !== media.url) return "Media changed. Start the drag again";
		return mediaUseReason(asset);
	}
	return undefined;
}

export interface MediaPlacementLane {
	row: number;
	group: LaneGroup;
	create: boolean;
	error?: string;
}

export function mediaPlacementLane(
	kind: MediaDropInfo["kind"],
	preferred: number,
	flags: TrackFlags,
	count: number,
): MediaPlacementLane {
	const group = kind === "audio" ? "audio" : "visual";
	if (flags[preferred]?.locked)
		return { row: preferred, group, create: false, error: "Track locked" };
	if (preferred < 0 && kind !== "audio") return { row: -1, group, create: false };
	const groups = laneGroups(flags, count);
	const row = routeToLane(groups, group, Math.max(0, preferred));
	if (row != null)
		return {
			row,
			group,
			create: false,
			...(flags[row]?.locked ? { error: "Destination track locked" } : {}),
		};
	return { row: canonicalInsertRow(groups, group), group, create: true };
}

export function mediaDropTime(
	engine: Engine,
	clientX: number,
	left: number,
	pxPerSec: number,
	candidates: readonly SnapCandidate[],
	bypass: boolean,
): number {
	if (pxPerSec <= 0) return 0;
	const ticksPerSec = CONTENT_TIMEBASE.ticksPerFrame * 30;
	const seconds = Math.max(0, (clientX - left) / pxPerSec);
	const ticks = Math.round(seconds * 30) * CONTENT_TIMEBASE.ticksPerFrame;
	return (
		snapTicks(engine, ticks, candidates, { thresholdPx: 8, scale: pxPerSec / ticksPerSec, bypass })
			.ticks / ticksPerSec
	);
}

export function mediaPlacementDuration(media: MediaDropInfo): number {
	return media.kind === "image"
		? 3
		: media.dur != null && Number.isFinite(media.dur) && media.dur > 0
			? media.dur
			: 5;
}

export function sceneVisualPlacement(scene: Scene) {
	const end = scene.visualClips?.length
		? scene.visualClips.reduce((at, c) => Math.max(at, c.startSec + c.durationSec), 0)
		: scene.src
			? scene.dur
			: 0;
	const startSec = Math.min(end, Math.max(0, scene.dur - 0.5));
	return { startSec, durationSec: Math.max(0.5, Math.round((scene.dur - startSec) * 100) / 100) };
}

/** Ready overlay placement patches canonical clips; the existing writer diffs
 * this single result into a reversible command, including a newly typed lane. */
export function placeMediaOverlay(
	doc: EditorDoc,
	media: MediaDropInfo,
	start: number,
	preferred: number,
	id: number,
): EditorDoc {
	if (!media.url.trim() || !Number.isFinite(start) || start < 0) return doc;
	const flags = doc.trackFlags ?? {};
	const count =
		Math.max(
			preferred,
			...Object.keys(flags).map(Number).filter(Number.isFinite),
			...doc.clips.filter(occupiesFreeLane).map((c) => c.track),
			0,
		) + 1;
	const target = mediaPlacementLane(media.kind, preferred, flags, count);
	if (target.error || target.row < 0) return doc;
	const dur = mediaPlacementDuration(media);
	const common = { id, mediaAssetId: media.mediaAssetId, start, dur, track: target.row };
	const clip: Clip =
		media.kind === "audio"
			? {
					id: clipId("audio", id),
					type: "audio",
					startSec: start,
					durationSec: dur,
					track: target.row,
					audio: {
						...common,
						kind: media.audioKind ?? "music",
						origin: media.origin ?? normalizeAudioOrigin(media.source),
						content: media.label ?? "Audio",
						url: media.url,
						originalDur: media.dur,
					},
				}
			: {
					id: clipId("video", id),
					type: "video",
					startSec: start,
					durationSec: dur,
					track: target.row,
					video: {
						...common,
						kind: media.kind,
						url: media.url,
						thumb: media.thumb ?? (media.kind === "image" ? media.url : undefined),
						label: media.label,
						source: media.source === "reference" ? "upload" : (media.source ?? "upload"),
					},
				};
	const clips = target.create
		? doc.clips.map((c) =>
				occupiesFreeLane(c) && c.track >= target.row
					? withMirroredTiming({ ...c, track: c.track + 1 })
					: c,
			)
		: doc.clips;
	return {
		...doc,
		...(target.create ? { trackFlags: withLaneInserted(flags, target.row, target.group) } : {}),
		clips: [...clips, clip],
	};
}
