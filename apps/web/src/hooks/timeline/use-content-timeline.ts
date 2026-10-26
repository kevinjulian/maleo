/* The content editor's timeline, on `@maleo/vui`'s kernel.
 *
 * This replaces `use-clip-drag`'s hand-written gesture policy. What moved out:
 * pointer capture, the terminal paths, the dead zone, edge auto-scroll, the
 * snapped delta, the group arithmetic, and the transaction that makes a drag one
 * undo step. What stayed here, because only Maleo knows it: which lanes accept
 * which clips, the resize quantum, the media in-point bound, the audio source
 * cap, and the beat grid.
 *
 * Three things this fixes rather than ports:
 *
 *   - **The lane change now lands live.** It landed on commit before, because
 *     lanes are separate DOM parents and writing `track` mid-drag unmounted the
 *     element the gesture was captured on. The gesture lives in the kernel's
 *     store now and the surface holds capture, so the element may come and go.
 *   - **One engagement rule.** There were two — VUI's looser gate in front of
 *     Maleo's stricter one — and neither could be reasoned about alone. The
 *     recognizer is supplied here, once, and the library applies it.
 *   - **A drag is a transaction.** The projection shows where the clip would
 *     land; the document is written on commit. Before, every pointer sample
 *     wrote to the document and the writers coalesced the mess afterwards.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { createStore } from "@models/timeline-view/store.ts";
import {
	distanceAndHoldRecognizer,
	distanceRecognizer,
	type SnapCandidate,
} from "@models/timeline-view/engagement.ts";
import { type GestureState } from "@models/timeline-view/gesture.ts";
import { type TimelineState } from "@models/timeline-view/types.ts";
import { type Operation } from "@models/timeline-view/operations.ts";
import { createGeometryQuery } from "@controllers/surface/query.ts";
import { loadedEditorEngine } from "@services/editor-engine/engine-loader.ts";
import {
	openPolicyGesture,
	type PolicyGesture,
	type PolicyProjection,
} from "@models/editor-engine/policy-gesture.ts";
import {
	createTimelineSurface,
	type SurfaceHitTest,
	type TimelineSurface,
} from "@controllers/surface/surface.ts";
import { CONTENT_TIMEBASE, laneTrackOf } from "@models/timeline/content-document-adapter.ts";
import { publishGeometry } from "@controllers/surface/geometry-probe.ts";
import { CLIP_HANDLE_PX, MIN_CLIP_PX, TOUCH_MIN_CLIP_PX } from "@models/timeline/clip-layout.ts";
import {
	createContentCrossAxis,
	LANE_HEIGHT_FALLBACK_PX,
} from "@models/timeline/content-cross-axis.ts";
import type { TimelineClip } from "@models/timeline/timeline-clips.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import { parseClipId, type Clip, type ClipSource, type TrackFlags } from "@maleo/shared";
import { contentEditsOf, type ContentEdit } from "@models/timeline/content-edits.ts";

/** Maleo's resize quantum, in seconds. Alt bypasses it. */
export const DRAG_QUANTUM_SEC = 0.1;

/* One engagement rule, declared once.
 *
 * A mouse that moves four pixels while held down meant to. A finger crossing
 * twelve pixels inside ninety milliseconds is a flick, which on a timeline means
 * throw the view — not move this clip by a frame. The AND is what stops tremor
 * inside the threshold from writing after the hold expires, and it could not be
 * expressed at all before, which is why there were two gates. */
export const FINE_ENGAGEMENT = { distancePx: 4, holdMs: 0 };
export const COARSE_ENGAGEMENT = { distancePx: 12, holdMs: 90 };

const fine = distanceRecognizer(FINE_ENGAGEMENT);
const coarse = distanceAndHoldRecognizer(COARSE_ENGAGEMENT);

/** The editor's engagement policy. The only one; the library applies it. */
export const contentRecognizer = (observation: Parameters<typeof fine>[0]): boolean =>
	observation.coarse ? coarse(observation) : fine(observation);

/** Nothing in flight. A shared empty map, so an idle timeline allocates none. */
const EMPTY_PROJECTED: ReadonlyMap<string, ProjectedClip> = new Map();

const secondsToTicks = (seconds: number): number =>
	Math.round(seconds * 30) * CONTENT_TIMEBASE.ticksPerFrame;
const ticksToSeconds = (ticks: number): number => ticks / (30 * CONTENT_TIMEBASE.ticksPerFrame);

/** What a committed gesture asks the editor to write. */

export interface ContentTimelineOptions {
	/** The document, as the library's model. Rebuilt when the document changes. */
	state(): TimelineState;
	/** Where the timeline scrolls. The surface takes capture on it. */
	scrollerRef: RefObject<HTMLDivElement | null>;
	/**
	 * Where the lane area starts inside the scroller, in pixels.
	 *
	 * The surface reports a point relative to its own root; the cross axis
	 * measures from the top of the ROWS. Between them sit the ruler, the marker
	 * band, and whatever else the consumer draws — which only the consumer can
	 * measure. Without this the first lane begins at the top of the ruler and
	 * every row resolves one or two lanes high.
	 */
	crossAxisTopPx(): number;
	/** Every row's height as drawn (scene row first), measured by the consumer
	 *  that draws them. Rows differ by lane group, so one number per tier will not do. */
	rowHeightsPx(): readonly number[];
	pxPerSec: number;
	totalSec: number;
	playhead: PlayheadHandle;
	/** Whether drags and trims snap. Read per gesture, so a toggle mid-session
	 *  applies to the next press. */
	snapping(): boolean;
	/** Whether a trim ripples the clips after it on the same lane. */
	ripple(): boolean;
	/** Scene boundaries, in seconds, for snapping. */
	sceneBoundaries(): readonly number[];
	beatTimes(): readonly number[];
	freeClips(): readonly TimelineClip[];
	selectedIds(): ReadonlySet<string>;
	trackLocked(row?: number): boolean;
	trackFlags(): TrackFlags;
	laneCount(): number;
	coarsePointer: boolean;
	/** Apply a committed gesture. One call, one undo step — the caller brackets it. */
	writeEdits(edits: readonly ContentEdit[]): void;
	/**
	 * A press that never became a drag.
	 *
	 * Selection arrives here rather than through a DOM click, and it has to:
	 * the surface takes pointer capture on the press, and a captured pointer
	 * retargets every later event — including the click — to the capturing
	 * element. A clip's own `onClick` therefore never fires during a gesture, so
	 * a timeline that selected on click would stop selecting the moment capture
	 * moved to the surface.
	 */
	select(
		clipId: string,
		modifiers: { readonly shift?: boolean; readonly meta?: boolean; readonly ctrl?: boolean },
	): void;
	/** The media in-point of a clip, when it has one. Bounds a trim at the head. */
	mediaStartSec(clipId: string): number | undefined;
	/** The source's own length, when it has one. Caps a trim at the tail. */
	sourceDurationSec(clipId: string): number | undefined;
	sourceClip?(clipId: string): Clip | undefined;
}

/**
 * The gesture in the shape the editor's collision bookkeeping already reads.
 *
 * `use-timeline-rows` resolves collisions, lane routing, and the undo bracket
 * from this, and none of that is gesture MECHANICS — it is Maleo's own policy
 * about what a drop means. So the shape is kept and fed from the kernel rather
 * than rewritten: the mechanics moved to the library, the policy stayed put.
 */
export interface ContentDragView {
	/* The parsed source, which includes `scene` — the base track's own kind.
	 * The collision pass never sees one, because the scene track is not driven
	 * from here, but narrowing the type would mean asserting rather than reading
	 * and the reader is the one that can say no. */
	readonly source: ClipSource;
	readonly refId: number | string;
	readonly mode: ContentDragMode;
	/** True once the recognizer has accepted the press as a drag. */
	readonly moved: boolean;
	/** The lane the drop currently resolves to. */
	readonly overTrack: number;
	readonly group?: ReadonlyArray<{ readonly source: ClipSource; readonly refId: number | string }>;
}

export interface ContentTimeline {
	/** The kernel store. Components subscribe to slices of it. */
	readonly store: ReturnType<typeof createStore>;
	/** The gesture in flight, for the classes and guides that draw it. */
	readonly gesture: GestureState | undefined;
	/** Where the edit currently lands, for the ghost and the insertion line. */
	readonly projection: ContentProjection | undefined;
	/** Where every moving clip currently lands. Empty when nothing is in flight. */
	readonly projectedClips: ReadonlyMap<string, ProjectedClip>;
	/** The gesture as the editor's collision bookkeeping reads it. */
	readonly clipDrag: ContentDragView | null;
	/** The snapped position, in seconds, for the magnetic guide. */
	readonly snapLine: number | null;
	/** True when the drop that just ended was made with the deliberate-overlap
	 *  modifier held, which tells collision resolution to leave it alone. */
	readonly dropAltRef: { current: boolean };
	/**
	 * Open a gesture programmatically, for a path that is not a pointer.
	 *
	 * The pointer path does not use it: the surface reports the press and the
	 * hook opens the transaction from the target it resolved.
	 */
	press(clipId: string, mode: ContentDragMode): boolean;
	readonly surface: TimelineSurface | undefined;
}

export type ContentDragMode = "move" | "resize" | "resize-l";

/** The gesture in flight, paired with the policy that interprets it. */
/** The edit in flight: the engine's gesture handle, the state it opened over,
 *  and its latest projection (absent until the first sample). */
interface OpenGesture {
	readonly mode: "move" | "trim";
	readonly clipId: string;
	readonly gesture: PolicyGesture;
	readonly base: TimelineState;
	readonly projection?: PolicyProjection;
}

/** Where one clip currently lands, while a gesture is open. */
export interface ProjectedClip {
	readonly startSec: number;
	readonly durSec: number;
	readonly track: number;
}

/** What the editor draws while a gesture is open. */
export interface ContentProjection {
	readonly clipId: string;
	readonly startSec: number;
	readonly durSec: number;
	readonly track: number;
	/** The snapped candidate, for the magnetic guide line. */
	readonly snapSec?: number;
	/** True when the destination lane refuses this clip. */
	readonly refused: boolean;
	readonly valid: boolean;
	/**
	 * Every clip the edit currently moves, at the position it would land.
	 *
	 * This is what the timeline DRAWS during a drag. The document is not written
	 * until commit, so without it the clip would sit still under the pointer —
	 * which is precisely what the previous implementation avoided by writing on
	 * every sample and leaving the writers to coalesce the mess.
	 */
	readonly clips: ReadonlyMap<string, ProjectedClip>;
}

/**
 * The snap candidates Maleo supplies.
 *
 * Everything a cut can land on: the project's ends, the playhead, every scene
 * boundary, every beat when the grid is on, and every other clip's edges. The
 * moving set is excluded by the library, so a group cannot snap to itself.
 */
export function contentSnapCandidates(options: {
	totalSec: number;
	playheadSec: number;
	sceneBoundaries: readonly number[];
	beatTimes: readonly number[];
	clips: readonly TimelineClip[];
}): SnapCandidate[] {
	const candidates: SnapCandidate[] = [
		{ ticks: 0, kind: "project-start" },
		{ ticks: secondsToTicks(options.totalSec), kind: "project-end" },
		{ ticks: secondsToTicks(options.playheadSec), kind: "playhead" },
	];
	for (const at of options.sceneBoundaries)
		candidates.push({ ticks: secondsToTicks(at), kind: "scene-boundary" });
	for (const at of options.beatTimes) candidates.push({ ticks: secondsToTicks(at), kind: "beat" });
	for (const clip of options.clips) {
		candidates.push({ ticks: secondsToTicks(clip.start), kind: "clip-start", itemId: clip.id });
		candidates.push({
			ticks: secondsToTicks(clip.start + clip.dur),
			kind: "clip-end",
			itemId: clip.id,
		});
	}
	return candidates;
}

/** Quantize a duration to the editor's grid, unless the bypass modifier is held. */
export function quantizeSeconds(seconds: number, bypass: boolean): number {
	return bypass ? seconds : Math.round(seconds / DRAG_QUANTUM_SEC) * DRAG_QUANTUM_SEC;
}

/** Which mode a resolved gesture target means. An edge is a trim; a body is a move. */
function modeOf(edge: "start" | "end" | undefined): ContentDragMode {
	return edge === undefined ? "move" : edge === "start" ? "resize-l" : "resize";
}

export function useContentTimeline(options: ContentTimelineOptions): ContentTimeline {
	const [gesture, setGesture] = useState<GestureState | undefined>(undefined);
	/* Read by the collision pass after a drop, and cleared by it. Held as a ref
	 * because it is a fact about the gesture that just ended, not state anything
	 * renders from. */
	const dropAltRef = useRef(false);
	const [projection, setProjection] = useState<ContentProjection | undefined>(undefined);
	const surfaceRef = useRef<TimelineSurface | undefined>(undefined);
	/* The open gesture. Not a copy of anything the kernel owns — it IS the edit
	 * in flight, held by the engine's edit policies (task 4.5), and the kernel's
	 * gesture state is what the surface owns. */
	const transactionRef = useRef<OpenGesture | undefined>(undefined);

	/* The latest options, read by the callbacks the surface holds.
	 *
	 * The surface is created ONCE and lives across renders. Its callbacks
	 * therefore cannot close over `options`, which is a new object every render:
	 * an effect keyed on it re-creates the surface mid-drag, and disposing a
	 * surface ends the gesture it holds as `unmount` — a rollback nobody asked
	 * for, on every render during a drag. This ref is not a second copy of any
	 * state; it is how a stable object reads current props. */
	const latest = useRef(options);
	latest.current = options;

	const store = useMemo(
		() =>
			createStore(options.state(), {
				scaleLimits: { minScale: 1e-6, maxScale: 1 },
				rowHeightPx: LANE_HEIGHT_FALLBACK_PX.visual,
				recognizer: (observation) =>
					contentRecognizer({
						...observation,
						coarse: observation.coarse || latest.current.coarsePointer,
					}),
				autoScroll: { edgePx: 48, pixelsPerSecond: 24 * 60 },
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- the store is created once and fed by `replaceItems`.
		[],
	);

	const crossAxis = useMemo(
		() =>
			createContentCrossAxis({
				trackFlags: () => latest.current.trackFlags(),
				laneCount: () => latest.current.laneCount(),
				rowHeightsPx: () => latest.current.rowHeightsPx(),
			}),
		[],
	);

	/* The document changed under us — a generation landed, undo ran, a panel
	 * wrote. The kernel is told, rather than rebuilt: a new store would drop the
	 * gesture in flight and every slice subscription with it. */
	useEffect(() => {
		const next = options.state();
		store.dispatch({
			type: "replaceItems",
			items: [...next.items.values()],
			duration: next.duration,
		});
	}, [options, store]);

	const candidates = useCallback(
		(): SnapCandidate[] =>
			!latest.current.snapping()
				? []
				: contentSnapCandidates({
						totalSec: latest.current.totalSec,
						playheadSec: latest.current.playhead.get(),
						sceneBoundaries: latest.current.sceneBoundaries(),
						beatTimes: latest.current.beatTimes(),
						clips: latest.current.freeClips(),
					}),
		[],
	);

	/** Read the open transaction's projection into the editor's own terms. */
	const publish = useCallback((open: OpenGesture): void => {
		const { clipId, projection } = open;
		if (!projection) return;
		const baseItem = open.base.items.get(clipId);
		const item =
			projection.items.find((projected) => projected.id === clipId) ??
			(baseItem && {
				id: clipId,
				rowId: baseItem.rowId,
				startTicks: baseItem.start.ticks,
				durationTicks: baseItem.duration.ticks,
			});
		if (!item) return;
		const clips = new Map<string, ProjectedClip>();
		for (const projected of projection.items) {
			const id = projected.id;
			clips.set(id, {
				startSec: ticksToSeconds(projected.startTicks),
				durSec: ticksToSeconds(projected.durationTicks),
				/* The dragged clip takes the destination row; a group member keeps
				 * its own, so a two-lane group does not collapse into one. */
				track: laneTrackOf(
					id === clipId ? (projection.destinationRow ?? projected.rowId) : projected.rowId,
				),
			});
		}
		setProjection({
			clipId,
			clips,
			startSec: ticksToSeconds(item.startTicks),
			durSec: ticksToSeconds(item.durationTicks),
			track: laneTrackOf(projection.destinationRow ?? item.rowId),
			snapSec:
				projection.snappedTo === undefined ? undefined : ticksToSeconds(projection.snappedTo.ticks),
			refused: projection.rowRefused === true,
			valid: projection.valid,
		});
	}, []);

	const editsOf = useCallback(
		(operation: Operation): ContentEdit[] =>
			contentEditsOf(operation, (id) => latest.current.sourceClip?.(id)),
		[],
	);

	const finish = useCallback(
		(outcome: "commit" | "rollback"): void => {
			const open = transactionRef.current;
			transactionRef.current = undefined;
			setProjection(undefined);
			setGesture(undefined);
			if (!open) return;
			if (outcome === "rollback") {
				open.gesture.rollback();
				return;
			}
			/* A commit that never engaged is a tap, not an edit: it selects and
			 * writes nothing. The recognizer decided which one it was, once. */
			const ended = store.getState().lastGesture;
			if (ended && !ended.engaged) {
				if (ended.target.kind === "item") latest.current.select(ended.target.id, ended.modifiers);
				open.gesture.rollback();
				return;
			}
			const result = open.gesture.commit();
			if (!result.ok || !result.operation) return;
			latest.current.writeEdits(editsOf(result.operation));
		},
		[editsOf, store],
	);

	/* The surface: capture on the scroller, hit-testing by the clip element under
	 * the pointer. The element is consulted ONCE, at the press — after that the
	 * gesture carries the clip's identity and the element may unmount, move lane,
	 * or be recycled without the gesture noticing. */
	const hitTest = useCallback<SurfaceHitTest>(
		(_point, event) => {
			/* A press that is not a free clip's is NOT OURS, and saying so is what
			 * keeps the rest of the editor working: returning a surface target would
			 * take pointer capture, and a captured pointer stops the browser panning
			 * the timeline and retargets the ruler's own handling. */
			/* SAFETY: `elementFromPoint` returns an `Element`, and the only things read
			 * from it are `closest` and `dataset`, which every element has. A point
			 * over nothing returns null, which the next line handles. */
			const element = globalThis.document?.elementFromPoint(
				event.clientX,
				event.clientY,
			) as HTMLElement | null;
			const clip = element?.closest<HTMLElement>("[data-clipid]");
			const id = clip?.dataset.clipid;
			if (id === undefined) return undefined;
			/* An id the kernel does not know is not ours.
			 *
			 * The base track draws one element per VISUAL, so a beat holding several
			 * images renders extras with `vis:` ids that exist nowhere in the document
			 * — they are views of one clip, not clips. Opening a gesture for one would
			 * take capture and then find nothing to edit, which is a dead pointer
			 * rather than a declined press. */
			const item = store.getState().items.get(id);
			if (!item) return undefined;
			// Decline capture so locked clips still receive their selection click.
			if (latest.current.trackLocked(laneTrackOf(item.rowId))) return undefined;
			/* On a finger, a press on an UNSELECTED clip is a selection, and a press
			 * anywhere else is the view's to pan. Declining here rather than opening a
			 * gesture and refusing it later is what leaves the browser free to scroll —
			 * capture taken is a pan lost. */
			/* Coarseness is the EDITOR's fact, from its pointer media query, not the
			 * event's `pointerType`. A phone driven by a synthetic mouse — every mobile
			 * test, and a real device with a mouse attached — is still a coarse surface,
			 * and reading the event would silently apply the fine rules there. */
			if (latest.current.coarsePointer && !latest.current.selectedIds().has(id)) return undefined;
			const edge = element?.closest<HTMLElement>('[data-vui-slot^="trim-"]');
			if (edge)
				return { kind: "item", id, edge: edge.dataset.vuiSlot === "trim-start" ? "start" : "end" };
			return { kind: "item", id };
			/* No dependency on `options`: it reads the current one through the ref, so
			 * the surface that holds this callback never has to be rebuilt. The store
			 * is stable for the hook's lifetime, so naming it changes nothing. */
		},
		[store],
	);

	/* The kernel's viewport, kept in the editor's own pixel space.
	 *
	 * Edge auto-scroll travels through it: the kernel decides the direction, the
	 * interpreter turns frames into `pan` events, and the resulting viewport is
	 * written to the real scroller. That only lands in the right place if the
	 * kernel's scale is the timeline's actual pixels per second. */
	useEffect(() => {
		const root = options.scrollerRef.current;
		if (!root) return;
		const targetScale = options.pxPerSec / (30 * CONTENT_TIMEBASE.ticksPerFrame);
		const viewport = store.getState().viewport;
		if (Math.abs(viewport.scale - targetScale) > Number.EPSILON) {
			store.dispatch({ type: "zoom", focalPx: 0, factor: targetScale / viewport.scale });
		}
		store.dispatch({ type: "resize", widthPx: root.clientWidth });
		store.dispatch({ type: "scroll", leftPx: root.scrollLeft });
	}, [store, options]);

	useEffect(() => {
		const root = options.scrollerRef.current;
		if (!root) return;
		const surface = createTimelineSurface({
			root,
			store,
			scroller: root,
			hitTest,
			/* Escape is heard on the document, not on the scroller. The scroller is a
			 * plain `div`: it never holds focus, so a keydown reaches the body and
			 * bubbles nowhere near it, and a drag could not be cancelled at all. */
			keySource: globalThis.document,
		});
		surfaceRef.current = surface;
		return () => {
			surface.dispose();
			surfaceRef.current = undefined;
		};
	}, [options.scrollerRef, store, hitTest]);

	/* The kernel's boxes, published on the scroller they describe.
	 *
	 * A clip's duration, its drawn width and its touch target are three different
	 * numbers, and the element's box is only one of them — so an assertion that
	 * reads the element cannot tell a clip padded to stay tappable from a clip
	 * that genuinely lasts that long.
	 *
	 * The minimums are the EDITOR's, not the library's defaults. A query that
	 * padded at a different width than the stylesheet does would report a
	 * discrepancy nobody can see and miss the one they can — the same failure the
	 * cross-axis adapter exists to prevent on the other axis. Its own effect, so
	 * a change of pointer coarseness rebuilds the query without rebuilding the
	 * surface underneath a gesture.
	 */
	useEffect(() => {
		const root = options.scrollerRef.current;
		if (!root) return;
		publishGeometry(
			root,
			createGeometryQuery({
				state: () => store.getState(),
				rows: {
					offsetOf: (rowId) => (rowId === undefined ? 0 : crossAxis.offsetOf(rowId)),
					heightOf: (rowId) => (rowId === undefined ? 0 : crossAxis.heightOf(rowId)),
				},
				/* The ruler is inside the scrolling content here rather than above
				 * it, so a row's offset is measured from the same origin the lanes
				 * are drawn at and nothing is added for it. */
				rulerHeightPx: 0,
				geometry: {
					minHitPx: TOUCH_MIN_CLIP_PX,
					minPaintPx: options.coarsePointer ? TOUCH_MIN_CLIP_PX : MIN_CLIP_PX,
					handlePx: CLIP_HANDLE_PX,
				},
			}),
		);
		return () => publishGeometry(root, undefined);
	}, [options.scrollerRef, store, crossAxis, options.coarsePointer]);

	/**
	 * Open the transaction a resolved gesture calls for.
	 *
	 * Called by the subscription below when the surface reports a new gesture —
	 * the surface resolves WHICH clip and WHICH edge by hit-testing, and this
	 * decides what that means. Nothing calls it on a pointer event, because no
	 * component sees pointer events any more.
	 */
	const openFor = useCallback(
		(clipId: string, mode: ContentDragMode): boolean => {
			const state = store.getState();
			const item = state.items.get(clipId);
			if (!item) return false;
			/* A locked lane declines before a transaction exists, so there is
			 * nothing open for a later sample to refine. */
			if (latest.current.trackLocked(laneTrackOf(item.rowId))) return false;
			/* The editor route mounts after the engine loads; without it there is
			 * no policy to ask, so the press is declined rather than half-handled. */
			const engine = loadedEditorEngine();
			if (!engine) return false;
			const id = `content-${clipId}`;
			const snaps = candidates();
			let gesture: PolicyGesture;
			try {
				gesture =
					mode === "move"
						? openPolicyGesture(
								engine,
								id,
								state,
								{ policy: "move", id: clipId, candidates: snaps },
								crossAxis,
							)
						: openPolicyGesture(
								engine,
								id,
								state,
								{
									policy: "trim",
									id: clipId,
									edge: mode === "resize-l" ? "start" : "end",
									kind: latest.current.ripple() ? "ripple" : "trim",
									candidates: snaps,
								},
								undefined,
							);
			} catch (error) {
				console.error("the edit policy refused the gesture", error);
				return false;
			}
			transactionRef.current = {
				mode: mode === "move" ? "move" : "trim",
				clipId,
				gesture,
				base: state,
			};
			return true;
		},
		[store, candidates, crossAxis],
	);

	/* Derived, not stored. A second copy of the gesture would be exactly the ref
	 * the library's bindings forbid, and it would disagree with the kernel the
	 * first time a render was skipped. */
	const clipDrag = useMemo((): ContentDragView | null => {
		if (!gesture || gesture.target.kind !== "item") return null;
		/* Parsed, not sliced-and-asserted: `parseClipId` is the editor's own reader
		 * and answers `null` for anything that is not one, so an id the library
		 * carried through from somewhere else cannot become a bogus source. */
		const reference = (id: string) =>
			latest.current.sourceClip?.(id)?.type === "caption"
				? { source: "caption" as const, refId: id }
				: parseClipId(id);
		const parsed = reference(gesture.target.id);
		if (!parsed) return null;
		const selected = options.selectedIds();
		const group =
			selected.has(gesture.target.id) && selected.size > 1
				? [...selected]
						.map(reference)
						.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
				: undefined;
		return {
			source: parsed.source,
			refId: parsed.refId,
			mode: modeOf(gesture.target.edge),
			moved: gesture.engaged,
			/* Where the drop currently resolves. Before the recognizer engages there
			 * is no projection yet, so the clip's own lane is the answer. */
			overTrack:
				projection?.track ?? laneTrackOf(store.getState().items.get(gesture.target.id)?.rowId),
			group,
		};
	}, [gesture, projection, options, store]);

	const press = useCallback(
		(clipId: string, mode: ContentDragMode): boolean => openFor(clipId, mode),
		[openFor],
	);

	/* One subscription to the gesture slice, which is where the in-flight edit
	 * lives. Nothing here holds it in a ref: a ref would be a second copy of what
	 * the kernel owns, and the two disagree the first time a render is skipped. */
	useEffect(() => {
		const slice = store.slice((state) => [...state.gestures.values()][0]);
		return slice.subscribe(() => {
			const current = slice.get();
			setGesture(current);
			if (current && !transactionRef.current && current.target.kind === "item") {
				openFor(current.target.id, modeOf(current.target.edge));
			}
			const transaction = transactionRef.current;
			if (!current) {
				finish(store.getState().lastGesture?.phase === "commit" ? "commit" : "rollback");
				return;
			}
			/* The surface began a gesture the hook has not opened a transaction for
			 * yet: this is the press. The target was resolved by hit-testing, so what
			 * it means is decided here rather than by the element that was under the
			 * pointer. */
			if (!transaction) return;
			if (!current.engaged) return;
			const deltaTicks =
				Math.round(((current.current.xPx - current.origin.xPx) / latest.current.pxPerSec) * 30) *
				CONTENT_TIMEBASE.ticksPerFrame;
			const scale = latest.current.pxPerSec / (30 * CONTENT_TIMEBASE.ticksPerFrame);
			const sample =
				transaction.mode === "move"
					? {
							deltaTicks,
							yPx: current.current.yPx - latest.current.crossAxisTopPx(),
							snap: { thresholdPx: 8, scale },
						}
					: { deltaTicks, snap: { thresholdPx: 8, scale } };
			const next: OpenGesture = { ...transaction, projection: transaction.gesture.update(sample) };
			transactionRef.current = next;
			publish(next);
		});
	}, [store, finish, publish, openFor]);

	return {
		store,
		gesture,
		projection,
		projectedClips: projection?.clips ?? EMPTY_PROJECTED,
		clipDrag,
		snapLine: projection?.snapSec ?? null,
		dropAltRef,
		press,
		surface: surfaceRef.current,
	};
}
