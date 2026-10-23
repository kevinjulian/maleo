/* clip-first clip-first timeline adapter. The editor keeps its per-type storage
 * arrays (scenes / videoOverlays / overlays / audioOverlays), but the timeline
 * surface operates on a single generic TimelineClip[] so rows are layers (tracks),
 * not types, and any non-scene clip can move to any row. */
import type { AudioOverlay, EffectClip, TextOverlay, VideoOverlay } from "@maleo/shared";
import { isPendingMedia } from "@models/core/pending-media-sources.ts";
import { audioKindLabel } from "@maleo/shared/audio-overlays";
import type { AudioOrigin, AudioOverlayKind } from "@maleo/shared/audio-overlays";
import {
	clipId,
	parseClipId,
	BOUNDARY_TOLERANCE_SEC,
	laneGroupOfType,
	LANE_GROUP_ORDER,
	type ClipSource,
	type LaneGroup,
	type TrackFlags,
} from "@maleo/shared";
import type { PrimaryClipSource } from "./selection-model.ts";

export { LANE_GROUP_ORDER, type LaneGroup };

// A clip's id vocabulary belongs to the document, not to this adapter — the two
// used to be declared here and in `@maleo/shared` with the same body and a
// divergence over `trans:` ids. Re-exported so the editor's callers keep one
// import site.
export { clipId, parseClipId, type ClipSource, type PrimaryClipSource };

export type ClipMedia = "image" | "video" | "text" | "audio" | "effect";

export interface OverlayTimelineClip {
	id: string; // "video:3"
	/* Never `"scene"`. `buildFreeClips` is the only producer and builds exactly
	 * the five non-scene families — which is what the header above means by "any
	 * non-scene clip can move to any row". Typing this as the full `ClipSource`
	 * made every caller that hands a clip to a free-clip-only API assert the
	 * narrowing back; there were fourteen of those. */
	source: PrimaryClipSource;
	media: ClipMedia;
	refId: number;
	start: number;
	dur: number;
	track: number;
	label: string;
	thumb?: string;
	url?: string;
	hasImg?: boolean;
	audioKind?: AudioOverlayKind;
	audioOrigin?: AudioOrigin;
}

export type TimelineClip =
	| OverlayTimelineClip
	| (Omit<OverlayTimelineClip, "source" | "refId" | "media"> & {
			source: "caption";
			refId: string;
			media: "caption";
	  });

export type AudioLaneGroup = "voiceover" | "sfx" | "music";

export function audioLaneGroup(kind: AudioOverlayKind | undefined): AudioLaneGroup | undefined {
	if (kind === "voiceover") return "voiceover";
	if (kind === "sfx" || kind === "accent_hit") return "sfx";
	if (kind === "music" || kind === "ambient") return "music";
	return undefined;
}

export interface TrackSpan {
	start: number;
	dur: number;
	track: number;
}

export function overlapsTime(
	a: Pick<TrackSpan, "start" | "dur">,
	b: Pick<TrackSpan, "start" | "dur">,
): boolean {
	return b.start < a.start + a.dur && b.start + b.dur > a.start;
}

export function resolveFreeTrack(
	occupied: ReadonlyArray<TrackSpan>,
	span: Pick<TrackSpan, "start" | "dur">,
	preferredTrack = 0,
): number {
	let track = Math.max(0, Math.round(preferredTrack));
	while (occupied.some((clip) => clip.track === track && overlapsTime(span, clip))) track++;
	return track;
}

// Non-scene clips share one generic track space (rows are layers). The scene reel
// is rendered separately (it is sequential + drives the base render).
export function buildFreeClips(
	videoOverlays: VideoOverlay[],
	overlays: TextOverlay[],
	audioOverlays: AudioOverlay[],
	effects: EffectClip[] = [],
	captionClips: readonly import("@maleo/shared").Clip[] = [],
): TimelineClip[] {
	const v: TimelineClip[] = videoOverlays.map((o) => ({
		id: clipId("video", o.id),
		source: "video",
		media: o.kind === "video" ? "video" : "image",
		refId: o.id,
		start: o.start,
		dur: o.dur,
		track: o.track ?? 0,
		label: o.label || (o.kind === "video" ? "Video" : "Image"),
		thumb: o.thumb || o.url,
		url: o.url,
		hasImg: true,
	}));
	const t: TimelineClip[] = overlays.map((o) => ({
		id: clipId("text", o.id),
		source: "text",
		media: "text",
		refId: o.id,
		start: o.start,
		dur: o.dur,
		track: o.track ?? 0,
		label: o.content || "Text",
	}));
	const a: TimelineClip[] = audioOverlays.map((o) => ({
		id: clipId("audio", o.id),
		source: "audio",
		media: "audio",
		refId: o.id,
		start: o.start,
		dur: o.dur,
		track: o.track ?? 0,
		label: o.content || audioKindLabel(o.kind, o.origin),
		url: o.url,
		audioKind: o.kind,
		audioOrigin: o.origin,
	}));
	const fx: TimelineClip[] = effects.map((e) => ({
		id: clipId("effect", e.id),
		source: "effect",
		media: "effect",
		refId: e.id,
		start: e.start,
		dur: e.dur,
		track: e.track ?? 0,
		label: e.effect.replace(/_/g, " "),
	}));
	const captions: TimelineClip[] = captionClips
		.filter((clip) => clip.type === "caption")
		.map((clip) => ({
			id: clip.id,
			source: "caption",
			refId: clip.id,
			media: "caption",
			start: clip.startSec,
			dur: clip.durationSec,
			track: clip.track,
			label: clip.caption?.text ?? "Caption",
		}));
	return [...v, ...t, ...a, ...fx, ...captions];
}

/* A clip's lane group: what kind of lane accepts it. Five, not the eight this
 * used to return, and the two merges are structural rather than tidy.
 *
 * Image + video stay one `visual` group because `adjacentVisualPairs` requires
 * two visual clips on the SAME track for a transition — separate groups would
 * put them on separate lanes and make an image→video cross-fade unexpressible.
 *
 * Text + intro-motion stay one `text` group because an intro-motion clip is a
 * text overlay identified by its `refId` range: splitting them would teleport a
 * clip to another lane the moment its preset changed.
 *
 * All audio kinds collapse to one `audio` group because every audio behaviour in
 * the renderer keys off the clip's own `kind` and never off its track, so two
 * kinds on one lane render exactly as they would on two. A group names what a
 * lane accepts, not how many lanes of that group exist. */
export function laneGroupOfClip(clip: TimelineClip): LaneGroup {
	// Delegated so the adapter and the persisted document cannot disagree: the
	// migration classifies `Clip.type`, this classifies the same clip's `media`,
	// and one of them drifting is a lane that changes group when it is saved.
	return laneGroupOfType(clip.media) ?? "visual";
}

/** Non-destructive range organizer. Same clips, timing, and ids return; only
 * track changes. Lane groups get adjacent lanes in canonical order, and
 * time-overlapping clips inside one group get separate lanes — which is what
 * hands back a voiceover lane and a music lane without anyone asking for them.
 *
 * It also reports the group of every lane it laid out, because it is no longer
 * inferring a layout: it is producing a DECLARED one, and the caller has to
 * persist those declarations alongside the tracks. */
/** The result of re-laning a time range: the full clip list with the moves
 *  applied, how many moved, and the lanes the pass produced. `moved` is reported
 *  separately because an organise that moves nothing is still a valid answer. */
export interface OrganizedClips {
	clips: TimelineClip[];
	moved: number;
	laneGroups: LaneGroup[];
}

export function organizeClipsInRange(
	clips: readonly TimelineClip[],
	startSec: number,
	endSec: number,
): OrganizedClips {
	const start = Math.min(startSec, endSec);
	const end = Math.max(startSec, endSec);
	const target = clips.filter((clip) => clip.start < end && clip.start + clip.dur > start);
	const nextTrack = new Map<string, number>();
	const laneGroups: LaneGroup[] = [];
	let cursor = 0;
	for (const group of LANE_GROUP_ORDER) {
		const members = target
			.filter((clip) => laneGroupOfClip(clip) === group)
			.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
		if (!members.length) continue;
		const lanes: TimelineClip[][] = [];
		for (const clip of members) {
			let lane = lanes.findIndex((items) => items.every((item) => !overlapsTime(item, clip)));
			if (lane < 0) {
				lane = lanes.length;
				lanes.push([]);
			}
			lanes[lane]!.push(clip);
			nextTrack.set(clip.id, cursor + lane);
		}
		for (let i = 0; i < lanes.length; i++) laneGroups.push(group);
		cursor += lanes.length;
	}
	let moved = 0;
	const organized = clips.map((clip) => {
		const track = nextTrack.get(clip.id);
		if (track == null || track === clip.track) return { ...clip };
		moved++;
		return { ...clip, track };
	});
	return { clips: organized, moved, laneGroups };
}

const LANE_GROUP_LABEL = {
	visual: { group: "Visual", label: "Media" },
	audio: { group: "Audio", label: "Audio" },
	text: { group: "Visual", label: "Text / Motion" },
	caption: { group: "Captions", label: "Captions" },
	effect: { group: "Visual", label: "Effects" },
} satisfies Record<LaneGroup, { group: string; label: string }>;

/** How a lane names itself. Reads the lane's DECLARED group, never its contents:
 * the positional guesses this used to make for an empty row — row 0 is
 * "Voiceover", row 1 is "SFX" — were a guess presented as a fact, and the
 * "Mixed 3" it returned for a row holding two kinds was a report of a layout
 * accident. A lane with no declared group is an untyped row that migration has
 * not reached; it falls back to its index rather than inventing a meaning. */
export function laneLabel(
	group: LaneGroup | undefined,
	row: number,
): { group?: string; label: string } {
	return group ? LANE_GROUP_LABEL[group] : { label: `Layer ${row + 1}` };
}

/** The declared group of a free lane, or undefined for an untyped one. */
export function laneGroupOf(trackFlags: TrackFlags, row: number): LaneGroup | undefined {
	return row < 0 ? undefined : trackFlags[row]?.group;
}

/* Which clip hue a lane wears. The names are the `--clip-*` custom properties
 * `tracks.css` already defines per clip type, so a lane's icon is tinted with
 * the same colour its clips are and the two agree without a second palette. */
const LANE_GROUP_HUE = {
	visual: "--clip-video",
	audio: "--clip-audio",
	text: "--clip-text",
	caption: "--clip-caption",
	effect: "--clip-effect",
} satisfies Record<LaneGroup, string>;

export function laneGroupHue(group: LaneGroup | undefined): string | undefined {
	return group ? `var(${LANE_GROUP_HUE[group]})` : undefined;
}

// A clip renders a visual frame (image or video) — only these can carry a
// transition between them: transitions bridge touching image/video clips.
//
// This used to begin `c.source === "scene" ||`, which was dead twice over: the
// only producer of a `TimelineClip` is `buildFreeClips`, which never emits a
// scene, and the base scene track renders through its own path keyed on
// `sceneId`. Even the hand-built scene fixtures it was written for carried
// `media: "image"` and were already visual by the second test.
export function isVisualClip(c: TimelineClip): boolean {
	return c.media === "image" || c.media === "video";
}

// Transition-eligible adjacency: ordered pairs of visual clips on the same track
// whose edges touch (a ends where b starts, within epsilon seconds).
export function adjacentVisualPairs(
	clips: TimelineClip[],
	epsilon = BOUNDARY_TOLERANCE_SEC,
): Array<{ from: TimelineClip; to: TimelineClip }> {
	const vis = clips.filter(isVisualClip);
	const pairs: Array<{ from: TimelineClip; to: TimelineClip }> = [];
	for (const a of vis) {
		for (const b of vis) {
			if (a.id === b.id || a.track !== b.track) continue;
			if (Math.abs(a.start + a.dur - b.start) <= epsilon) pairs.push({ from: a, to: b });
		}
	}
	return pairs;
}

// Merge an agent run's overlay results into the existing client clips. The job is
// seeded with the user's current clips, so its results CONTAIN them: a result that
// carries an id replaces its match (no duplicate, track preserved by `build`); a
// result without an id is agent-created and gets a fresh id (from `baseId`) appended.
const urlOf = (value: unknown): unknown =>
	value && typeof value === "object" && "url" in value ? value.url : undefined;

export function upsertAgentClips<C extends { id: number }, J>(
	prev: C[],
	jobItems: ReadonlyArray<J>,
	idOf: (j: J) => number | undefined,
	build: (j: J, id: number) => C,
	baseId: number,
): C[] {
	const map = new Map<number, C>(prev.map((c) => [c.id, c]));
	let next = baseId;
	for (const j of jobItems) {
		const id = idOf(j) ?? next++;
		// A file still uploading is the editor's alone: the agent neither edits a clip
		// on one nor points a clip at one.
		if (isPendingMedia(urlOf(map.get(id))) || isPendingMedia(urlOf(j))) continue;
		map.set(id, build(j, id));
	}
	return [...map.values()];
}

// Ripple-delete shift: how far left a clip sitting at (track, start) slides once
// `removed` clips are lifted out — the summed duration of removed clips that were
// earlier on the SAME track. Per-track so an unrelated layer never shifts.
export function rippleShift(
	removed: ReadonlyArray<{ track: number; start: number; dur: number }>,
	track: number,
	start: number,
): number {
	return removed
		.filter((r) => r.track === track && r.start < start - 1e-6)
		.reduce((sum, r) => sum + r.dur, 0);
}

export function rippleAfterDurationChange<T extends { id: number; start: number }>(
	clips: readonly T[],
	changedId: number,
	boundarySec: number,
	deltaSec: number,
): T[] {
	if (Math.abs(deltaSec) < 0.001) return [...clips];
	const delta = Math.round(deltaSec * 1000) / 1000;
	return clips.map((clip) =>
		clip.id !== changedId && clip.start > boundarySec + 1e-6
			? { ...clip, start: Math.max(0, Math.round((clip.start + delta) * 1000) / 1000) }
			: clip,
	);
}

// Where a new scene splices into the sequential reel for a click at `t` seconds:
// before the first scene whose midpoint lies past t, else appended at the end.
// Midpoint (not edge) so a click "on" a scene inserts at its nearest boundary.
export function sceneInsertIndex(
	scenes: ReadonlyArray<{ start?: number; dur: number }>,
	t: number,
): number {
	let acc = 0;
	for (let i = 0; i < scenes.length; i++) {
		const s = scenes[i]!;
		const start = s.start ?? acc;
		const dur = Math.max(1, s.dur);
		if (t < start + dur / 2) return i;
		acc = start + dur;
	}
	return scenes.length;
}

// Snap a raw timeline second to the nearest candidate (playhead, clip edges,
// beats) within `threshold` seconds; otherwise keep the raw value. Result is
// rounded to centiseconds and clamped at 0.
export function snapTime(
	raw: number,
	candidates: ReadonlyArray<number>,
	threshold: number,
): number {
	let best = raw;
	let bestD = threshold;
	for (const c of candidates) {
		const d = Math.abs(c - raw);
		if (d < bestD) {
			best = c;
			bestD = d;
		}
	}
	return Math.max(0, Math.round(best * 100) / 100);
}

// Rows present in the free-clip space, plus one trailing empty row so a clip can
// always be dragged onto a fresh layer.
export function freeRowCount(clips: TimelineClip[]): number {
	const max = clips.reduce((m, c) => Math.max(m, c.track), -1);
	return max + 2; // existing rows (0..max) + one empty
}

// Compact occupied free-track indices after a clip leaves a row. Empty rows in
// the middle disappear; the editor still renders one trailing empty row via
// freeRowCount().
export function compactFreeTrackMap(clips: ReadonlyArray<{ track: number }>): Map<number, number> {
	const occupied = Array.from(
		new Set(clips.map((c) => c.track).filter((t) => Number.isFinite(t) && t >= 0)),
	).sort((a, b) => a - b);
	return new Map(occupied.map((track, index) => [track, index]));
}

/** A base-track visual: one per beat, or one per visual clip when a beat holds
 *  several. Derived rather than read, because a multi-image beat renders one
 *  clip per visual while the primary keeps the beat's own clip id.
 *
 *  Lives here rather than beside the component that draws it: the base row is
 *  derived in the state layer and consumed in the ui layer, and a type owned by
 *  the consumer would make the state layer import upward. */
export interface BaseTrackClip {
	id: string;
	sceneId: number;
	vclipId: string | null;
	start: number;
	dur: number;
	thumb?: string;
	label: string;
	gen: boolean;
	hasImg: boolean;
}
