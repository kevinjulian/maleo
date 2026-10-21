/* Motion Studio's layers, spoken to `@maleo/vui` — with no schema change.
 *
 * A motion composition is a list of text layers, each carrying animation tracks
 * of keyframes at NORMALISED times (0..1 within the layer's own duration). The
 * library's model has exactly the shape for that: an item with nested tracks,
 * because a keyframe's position is meaningful only relative to the item that
 * carries it, and a consumer that flattened them into rows would have to
 * re-derive that relationship on every edit.
 *
 * So nothing here flattens. The normalisation is the only conversion, and it
 * happens at this boundary in both directions: the library counts absolute
 * ticks, the composition stores fractions, and neither has to know about the
 * other.
 */
import { framesToProject, projectTime } from "@models/timeline-view/tick.ts";
import { rational } from "@models/timeline-view/rational.ts";
import { timebase, type Timebase } from "@models/timeline-view/timebase.ts";
import {
	type Marker,
	type NestedTrack,
	type TimelineItem,
	type TimelineState,
} from "@models/timeline-view/types.ts";
import type { CompositionLayer } from "@maleo/shared";
import {
	motionAnimatedTracks,
	motionTrackLabel,
	MOTION_PREVIEW_FPS,
	type MotionStudioTrack,
} from "./motion-vui-adapter.ts";

/** The studio's preview rate. One rate, so a keyframe lands on a frame. */
export const MOTION_TIMEBASE: Timebase = timebase(rational(MOTION_PREVIEW_FPS, 1));

/** The row a layer occupies. Its tracks are nested inside it, not beside it. */
export function motionRowId(layerId: number): string {
	return `layer-${layerId}`;
}

/** A nested track's identity, stable across renders. */
function motionTrackId(track: MotionStudioTrack): string {
	return `${track.kind}-${track.prop}`;
}

/** One keyframe's identity within its track. Index-based, as the composition is. */
export function motionMarkerId(layerId: number, track: MotionStudioTrack, index: number): string {
	return `${layerId}:${motionTrackId(track)}-${index}`;
}

/** The layer, track, and index a marker identity names. */
export function parseMotionMarkerId(
	id: string,
): { layerId: number; trackId: string; index: number } | null {
	const colon = id.indexOf(":");
	const dash = id.lastIndexOf("-");
	if (colon < 0 || dash < colon) return null;
	const layerId = Number(id.slice(0, colon));
	const index = Number(id.slice(dash + 1));
	if (!Number.isFinite(layerId) || !Number.isFinite(index)) return null;
	return { layerId, trackId: id.slice(colon + 1, dash), index };
}

function secondsToTicks(seconds: number): number {
	return framesToProject(Math.round(seconds * MOTION_PREVIEW_FPS), MOTION_TIMEBASE).ticks;
}

export function motionTicksToSeconds(ticks: number): number {
	return ticks / (MOTION_TIMEBASE.ticksPerFrame * MOTION_PREVIEW_FPS);
}

/** One layer's nested tracks, with its keyframes as markers on the timeline. */
function motionTracksOf(layer: CompositionLayer): NestedTrack[] {
	return motionAnimatedTracks(layer).map((track) => {
		const keyframes =
			track.kind === "value"
				? layer.anim?.tracks[track.prop]
				: layer.anim?.colorTracks?.[track.prop];
		const markers: Marker[] = (keyframes ?? []).map((keyframe, index) => ({
			id: motionMarkerId(layer.id, track, index),
			/* Normalised in the composition, absolute here. A keyframe at `t: 0.5`
			 * on a layer starting at 2s and lasting 4s is at 4s on the timeline, and
			 * the library never has to know it was ever a fraction. */
			at: projectTime(secondsToTicks(layer.start + keyframe.t * layer.dur)),
			label: `${motionTrackLabel(track)} keyframe ${index + 1}`,
		}));
		return { id: motionTrackId(track), label: motionTrackLabel(track), markers };
	});
}

/** The composition as the library's model. */
export function motionStateOf(
	layers: readonly CompositionLayer[],
	durationSec: number,
): TimelineState {
	const items: TimelineItem[] = layers.map((layer) => ({
		id: motionRowId(layer.id),
		rowId: motionRowId(layer.id),
		kind: "layer",
		label: layer.content || `Layer ${layer.id}`,
		start: projectTime(secondsToTicks(layer.start)),
		duration: projectTime(secondsToTicks(layer.dur)),
		tracks: motionTracksOf(layer),
	}));
	return {
		timebase: MOTION_TIMEBASE,
		duration: projectTime(secondsToTicks(durationSec)),
		/* One row per layer, free and overlapping: motion layers stack, and two
		 * titles on screen together is the ordinary case rather than a collision. */
		rows: layers.map((layer) => ({
			id: motionRowId(layer.id),
			placement: "free" as const,
			overlap: "permit" as const,
		})),
		items: new Map(items.map((item) => [item.id, item])),
		order: items.map((item) => item.id),
		markers: [],
		selection: new Set(),
		viewport: {
			start: projectTime(0),
			scale: 0.001,
			widthPx: 900,
			end: projectTime(secondsToTicks(durationSec)),
		},
		gestures: new Map(),
	};
}

/**
 * Where a keyframe dragged to this timeline position sits within its layer.
 *
 * Back to the fraction the composition stores, clamped into the layer. A
 * keyframe cannot leave the layer that carries it: outside it there is no time
 * for it to be at, which is the same reason its track is nested rather than
 * beside it.
 */
export function normalizedTimeIn(layer: CompositionLayer, timelineSeconds: number): number {
	if (layer.dur <= 0) return 0;
	return Math.max(0, Math.min(1, (timelineSeconds - layer.start) / layer.dur));
}
