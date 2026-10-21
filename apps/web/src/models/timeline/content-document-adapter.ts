/* Maleo's document, read as timeline state — with no schema change.
 *
 * The timeline's view-model and the edit policies read items, rows and exact
 * ticks; the storyboard stays `EditorDoc` (`schemaVersion: 2`, `clips[] +
 * markers[]`). This is the one direction that exists: a committed edit goes back
 * to the document as commands through the editor's writers
 * (`contentEditsOf` in `content-edits.ts`), executed by the Rust engine,
 * never by folding timeline state into the document here.
 *
 * Time is exact ticks in the timeline and floating seconds in the storyboard,
 * so the conversion happens here, rounding to the project's frame grid.
 */
import { framesToProject, projectTime, sourceTime } from "@models/timeline-view/tick.ts";
import { rational } from "@models/timeline-view/rational.ts";
import { timebase, type Timebase } from "@models/timeline-view/timebase.ts";
import { type Row, type TimelineItem, type TimelineState } from "@models/timeline-view/types.ts";
import {
	chapterRanges,
	occupiesFreeLane,
	clipSourceRange,
	sourceInterval,
	RENDER_FPS,
	type Clip,
	type SceneDurationMode,
	type TrackFlags,
} from "@maleo/shared";
import type { EditorDoc } from "@models/storyboard/editor-doc.ts";

/** The editor's project rate. One rate everywhere, which is why 30 is a constant. */
/** The content timeline's frame rate: one frame is the finest edit, and the ruler's finest mark. */
export const CONTENT_FPS = RENDER_FPS;
export const CONTENT_TIMEBASE: Timebase = timebase(rational(CONTENT_FPS, 1));

/** The row identity for a lane. Stable, and derived from the lane's own number. */
export function laneRowId(track: number): string {
	/* The scene track is row -1 in the document's own numbering — the base track
	 * that carries the render — and the free lanes are 0 upward. Naming them
	 * rather than passing the number through keeps a row id from being mistaken
	 * for an index into anything. */
	return track < 0 ? "scene" : `lane-${track}`;
}

/** The lane number a row id came from. The inverse of `laneRowId`. */
export function laneTrackOf(rowId: string | undefined): number {
	if (rowId === undefined || rowId === "scene") return -1;
	const parsed = Number(rowId.slice("lane-".length));
	return Number.isFinite(parsed) ? parsed : -1;
}

function secondsToTicks(seconds: number): number {
	/* Rounded to the frame grid, because a clip that starts at 1.0166666s is a
	 * clip whose start has no frame — and every consumer of it then rounds
	 * differently. */
	return framesToProject(Math.round(seconds * 30), CONTENT_TIMEBASE).ticks;
}

/** How the document's lanes become the library's rows. */
export function rowsOf(doc: EditorDoc, trackFlags: TrackFlags): Row[] {
	const rows: Row[] = [
		/* The scene track is magnetic: scenes are a contiguous sequence and a gap
		 * in them is a gap in the render. */
		{ id: "scene", placement: "magnetic", overlap: "insert" },
	];
	const highest = doc.clips.reduce(
		(max, clip) => (occupiesFreeLane(clip) ? Math.max(max, clip.track) : max),
		-1,
	);
	const declared = Object.keys(trackFlags)
		.map((key) => Number(key))
		.filter((row) => Number.isFinite(row) && row >= 0);
	const rowCount = Math.max(highest, ...declared, -1) + 1;
	for (let track = 0; track < rowCount; track += 1) {
		rows.push({
			/* Free lanes hold deliberately overlapping content — a title over a
			 * video, a sound bed under a voiceover — so overlap is permitted rather
			 * than resolved. */
			id: laneRowId(track),
			placement: "free",
			overlap: "permit",
			locked: trackFlags[track]?.locked === true,
		});
	}
	return rows;
}

/** One clip as the library sees it. Everything the library does not use stays on the clip. */
export function itemOf(clip: Clip, trackFlags: TrackFlags, sourceDuration?: number): TimelineItem {
	/* The label is whatever the clip's own family calls it. Read from the family
	 * payload rather than from a field the library added, so nothing about naming
	 * has to be kept in step with the storyboard's schema. */
	const label =
		clip.caption?.text ??
		clip.scene?.name ??
		clip.text?.content ??
		clip.audio?.content ??
		clip.video?.label ??
		clip.id;
	const range = clipSourceRange(clip),
		extent = sourceDuration ?? clip.video?.sourceDurationSec ?? clip.audio?.originalDur;
	const interval = range ? sourceInterval(range.start, clip.durationSec, range.rate) : undefined;
	// VUI sees forward timeline seconds over virtual source; domain maps rate/direction back.
	const sourceTicks = (seconds: number) =>
		sourceTime(Math.round(seconds * CONTENT_TIMEBASE.ticksPerFrame * 30));
	const source =
		range && interval && extent != null && extent >= interval.end
			? {
					timebase: CONTENT_TIMEBASE,
					inPoint: sourceTicks(
						range.reverse ? (extent - interval.end) / range.rate : range.start / range.rate,
					),
					availableStart: sourceTicks(0),
					availableEnd: sourceTicks(extent / range.rate),
				}
			: undefined;
	return {
		id: clip.id,
		rowId: laneRowId(clip.track),
		kind: clip.type,
		label,
		start: projectTime(secondsToTicks(clip.startSec)),
		duration: projectTime(secondsToTicks(clip.durationSec)),
		locked: trackFlags[clip.track]?.locked === true,
		source,
		/* Markers group clips into scenes, and clips sharing a marker move
		 * together — which is exactly what the library's grouping means. */
		groupId: clip.markerId === undefined ? undefined : `marker-${clip.markerId}`,
	};
}

export interface ContentDocumentOptions {
	/** Read the document as it now stands. */
	read(): EditorDoc;
	trackFlags?(): TrackFlags;
	sourceDuration?(clip: Clip): number | undefined;
}

/** The document as timeline state, read fresh on every call. */
export interface ContentTimelineSource {
	read(): TimelineState;
}

/** Maleo's document, as the timeline reads it. */
export function createContentDocumentAdapter(
	options: ContentDocumentOptions,
): ContentTimelineSource {
	const flags = (): TrackFlags => options.trackFlags?.() ?? {};

	function toState(doc: EditorDoc): TimelineState {
		const trackFlags = flags();
		const items = new Map<string, TimelineItem>();
		const order: string[] = [];
		for (const clip of doc.clips) {
			items.set(clip.id, itemOf(clip, trackFlags, options.sourceDuration?.(clip)));
			order.push(clip.id);
		}
		const end = doc.clips.reduce(
			(latest, clip) => Math.max(latest, secondsToTicks(clip.startSec + clip.durationSec)),
			0,
		);
		return {
			timebase: CONTENT_TIMEBASE,
			duration: projectTime(end),
			rows: rowsOf(doc, trackFlags),
			items,
			order,
			/* The ruler marks CHAPTERS, not scenes. It used to project `doc.markers`,
			 * which are one per scene — so a ruler of twenty scenes was twenty markers
			 * saying what the clips beneath them already said. A chapter marker is
			 * information: it is where one part of the story hands over to the next. */
			markers: chapterRanges(doc).map((chapter) => ({
				id: `chapter-${chapter.id}`,
				at: projectTime(secondsToTicks(chapter.startSec)),
				label: chapter.title,
			})),
			selection: new Set(),
			viewport: { start: projectTime(0), scale: 0.0004, widthPx: 1000, end: projectTime(end) },
			gestures: new Map(),
		};
	}

	return { read: () => toState(options.read()) };
}

/** A committed edit's view of a scene's span, in seconds. */
export interface SceneEditSpan {
	startSec?: number;
	durSec?: number;
}

/** Where a scene currently sits, in seconds. */
export interface ScenePlacement {
	start: number;
	dur: number;
}

/** What to write back, holding only the fields that actually changed. */
export interface ScenePatch {
	start?: number;
	dur?: number;
	/* Set alongside `dur`, never alone. Dragging a scene's edge is the operator
	 * saying how long the shot is, so the scene stops following its speech —
	 * the same move as dragging a flex item to a fixed size. A scene MOVE does
	 * not pin: where a scene sits says nothing about how long it should run. */
	durMode?: SceneDurationMode;
}

/**
 * What a committed edit asks a SCENE to change.
 *
 * Scenes are laid out by derivation: a scene's start is its explicit `start`
 * once it has been moved, and its sequential position by order until then. So a
 * run of untouched scenes rolls — shorten one and the next comes back with it,
 * which is the whole of the base track's magnetism.
 *
 * That makes writing an unchanged `start` destructive rather than harmless: it
 * pins the scene, and the run stops rolling from there on. The library reports a
 * trim as a whole new span, start included, because it does not know the start
 * was never in question — so the comparison happens here, once, rather than in
 * whichever caller happened to remember.
 */
export function sceneEditPatch(
	edit: SceneEditSpan,
	current: ScenePlacement,
	epsilonSec = 1e-6,
): ScenePatch {
	const patch: ScenePatch = {};
	if (edit.startSec !== undefined && Math.abs(edit.startSec - current.start) > epsilonSec)
		patch.start = edit.startSec;
	if (edit.durSec !== undefined && Math.abs(edit.durSec - current.dur) > epsilonSec) {
		patch.dur = edit.durSec;
		patch.durMode = "pinned";
	}
	return patch;
}
