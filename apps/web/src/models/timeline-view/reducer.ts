/* `(state, event) => { state, effects }`, and nothing else.
 *
 * The reducer performs no side effect. It returns descriptions and the host
 * layer interprets them, which is what makes the interesting parts of this
 * library testable with no DOM at all.
 *
 * It also never publishes a derived value that equals the published one — so a
 * resize observer that re-arms and reports an unchanged width produces no
 * state change, no notification, and nothing to re-arm on.
 */
import {
	defaultRecognizer,
	observe,
	type GestureRecognizer,
	type GestureSample,
} from "./engagement.ts";
import { projectTime } from "./tick.ts";
import type { Effect, PaintRegion, Reduction } from "./effects.ts";
import type { GestureBeginEvent, GestureMoveEvent, TimelineEvent } from "./events.ts";
import { gestureDistancePx, terminalPhase, type GestureId, type GestureState } from "./gesture.ts";
import type { ItemId, TimelineItem, TimelineState, ViewportInput } from "./types.ts";
import {
	clampViewport,
	panBy,
	pixelAtTime,
	resizeTo,
	resolveViewport,
	scrollTo,
	viewportEquals,
	zoomAbout,
	type ScaleLimits,
} from "./viewport.ts";

/** When a drag near the edge of the viewport starts pulling the view with it. */
export interface AutoScrollPolicy {
	/** How close to an edge, in pixels, counts as being at it. */
	readonly edgePx: number;
	/** How fast the view travels while the pointer is held there. */
	readonly pixelsPerSecond: number;
}

/** Policy the reducer needs and does not decide for itself. */
export interface ReducerOptions {
	readonly scaleLimits: ScaleLimits;
	/** How tall a row is painted, for the regions the reducer invalidates. */
	readonly rowHeightPx: number;
	/**
	 * Whether a press has become a drag.
	 *
	 * Injected rather than fixed, because the one consumer that needed
	 * "threshold AND hold" previously ran a second dead zone in front of the
	 * library's, and two gates decided one question.
	 */
	readonly recognizer: GestureRecognizer;
	readonly autoScroll: AutoScrollPolicy;
}

/** Sensible limits for a consumer that has not chosen any. */
export const DEFAULT_REDUCER_OPTIONS: ReducerOptions = {
	scaleLimits: { minScale: 1e-6, maxScale: 1 },
	rowHeightPx: 40,
	recognizer: defaultRecognizer(),
	autoScroll: { edgePx: 32, pixelsPerSecond: 600 },
};

function unchanged(state: TimelineState): Reduction<TimelineState> {
	return { state, effects: [] };
}

/** The region an item occupies in the current viewport. */
function itemRegion(
	state: TimelineState,
	item: TimelineItem,
	options: ReducerOptions,
): PaintRegion {
	const left = pixelAtTime(state.viewport, item.start);
	const right = pixelAtTime(state.viewport, projectTime(item.start.ticks + item.duration.ticks));
	const rowIndex = item.rowId
		? Math.max(
				0,
				state.rows.findIndex((row) => row.id === item.rowId),
			)
		: 0;
	return {
		xPx: left,
		yPx: rowIndex * options.rowHeightPx,
		widthPx: Math.max(0, right - left),
		heightPx: options.rowHeightPx,
	};
}

/** Invalidate exactly the items whose appearance changed, and nothing else. */
function invalidateItems(
	state: TimelineState,
	ids: readonly ItemId[],
	options: ReducerOptions,
): Effect[] {
	const effects: Effect[] = [];
	for (const id of ids) {
		const item = state.items.get(id);
		if (!item) continue;
		effects.push({
			type: "invalidateRegion",
			region: itemRegion(state, item, options),
			items: [id],
		});
	}
	return effects;
}

/**
 * Apply a resolved viewport, or decline to.
 *
 * The equality guard is the rule "a derived value is not published when it
 * equals the published one", in the one place the value is written.
 */
function publishViewport(state: TimelineState, next: ViewportInput): Reduction<TimelineState> {
	const resolved = resolveViewport(clampViewport(next, state.duration));
	if (viewportEquals(resolved, state.viewport)) return unchanged(state);
	return {
		state: { ...state, viewport: resolved },
		/* The scroller is told where to be, once, by the one path that decided
		 * it. The surface applies this and does not read the resulting scroll
		 * event back as new input. */
		effects: [{ type: "scrollTo", leftPx: resolved.start.ticks * resolved.scale }],
	};
}

/** The gesture map with one entry replaced, or removed when `next` is absent. */
function withGesture(
	state: TimelineState,
	id: GestureId,
	next: GestureState | undefined,
): Map<GestureId, GestureState> {
	const gestures = new Map(state.gestures);
	if (next) gestures.set(id, next);
	else gestures.delete(id);
	return gestures;
}

/**
 * Which edge, if either, the pointer is being held against.
 *
 * Zero means neither. Reported from the pointer's position within the viewport
 * rather than from its velocity, because a finger parked at the edge is asking
 * to keep travelling and produces no further movement at all.
 */
function autoScrollDirection(
	state: TimelineState,
	xPx: number,
	options: ReducerOptions,
): -1 | 1 | 0 {
	const { edgePx } = options.autoScroll;
	if (xPx <= edgePx) return -1;
	if (xPx >= state.viewport.widthPx - edgePx) return 1;
	return 0;
}

function beginGesture(
	state: TimelineState,
	event: GestureBeginEvent,
	options: ReducerOptions,
): Reduction<TimelineState> {
	/* A second begin for a live gesture is the host repeating itself, not a
	 * second gesture: honouring it would take capture twice and leave one of them
	 * unreleased. */
	if (state.gestures.has(event.gestureId)) return unchanged(state);
	const point = { xPx: event.xPx, yPx: event.yPx };
	const sample: GestureSample = { elapsedMs: 0, distancePx: 0, coarse: event.coarse };
	const gesture: GestureState = {
		id: event.gestureId,
		pointerId: event.pointerId,
		target: event.target,
		origin: point,
		current: point,
		startedAtMs: event.atMs,
		samples: [sample],
		engaged: options.recognizer(observe([sample])),
		modifiers: event.modifiers ?? {},
	};
	return {
		state: { ...state, gestures: withGesture(state, event.gestureId, gesture) },
		effects: [{ type: "capturePointer", pointerId: event.pointerId }],
	};
}

function moveGesture(
	state: TimelineState,
	event: GestureMoveEvent,
	options: ReducerOptions,
): Reduction<TimelineState> {
	const gesture = state.gestures.get(event.gestureId);
	/* A move for a gesture that has already ended is late, not new. Ending it
	 * again is what produced a second terminal phase in the previous
	 * implementation. */
	if (!gesture) return unchanged(state);
	const point = { xPx: event.xPx, yPx: event.yPx };
	/* An engaged gesture that has not moved has nothing to learn from another
	 * sample. Before engagement the elapsed time still matters, because a hold
	 * recognizer engages on time with the pointer perfectly still. */
	if (gesture.engaged && point.xPx === gesture.current.xPx && point.yPx === gesture.current.yPx)
		return unchanged(state);
	const sample: GestureSample = {
		elapsedMs: event.atMs - gesture.startedAtMs,
		/* Pixels measured from the press point. Never inferred from the elapsed
		 * time or from a time delta, which would make engagement depend on zoom. */
		distancePx: gestureDistancePx(gesture.origin, point),
		coarse: gesture.samples[0]?.coarse,
	};
	const samples = [...gesture.samples, sample];
	const engaged = gesture.engaged || options.recognizer(observe(samples));
	const direction = engaged ? autoScrollDirection(state, point.xPx, options) : 0;
	const next: GestureState = {
		...gesture,
		current: point,
		samples,
		engaged,
		autoScroll: direction === 0 ? undefined : direction,
	};
	const effects: Effect[] = [];
	/* Only on a change of direction: re-issuing `startAutoScroll` every sample
	 * would restart the frame loop sixty times a second and make its own speed
	 * depend on how fast the pointer reports. */
	if (next.autoScroll !== gesture.autoScroll) {
		effects.push(
			next.autoScroll === undefined
				? { type: "stopAutoScroll" }
				: {
						type: "startAutoScroll",
						direction: next.autoScroll,
						pixelsPerSecond: options.autoScroll.pixelsPerSecond,
					},
		);
	}
	return { state: { ...state, gestures: withGesture(state, event.gestureId, next) }, effects };
}

function selectionEquals(a: ReadonlySet<ItemId>, b: ReadonlySet<ItemId>): boolean {
	if (a.size !== b.size) return false;
	for (const id of a) if (!b.has(id)) return false;
	return true;
}

/** Apply one event. Pure: the same state and event always give the same answer. */
export function reduce(
	state: TimelineState,
	event: TimelineEvent,
	options: ReducerOptions = DEFAULT_REDUCER_OPTIONS,
): Reduction<TimelineState> {
	switch (event.type) {
		case "scroll":
			return publishViewport(state, scrollTo(state.viewport, event.leftPx));
		case "resize":
			return publishViewport(state, resizeTo(state.viewport, event.widthPx));
		case "pan":
			return publishViewport(state, panBy(state.viewport, event.deltaPx));
		case "zoom":
			return publishViewport(
				state,
				zoomAbout(state.viewport, event.focalPx, event.factor, options.scaleLimits),
			);

		case "gestureBegin":
			return beginGesture(state, event, options);
		case "gestureMove":
			return moveGesture(state, event, options);

		case "announce":
			/* No state change: an announcement is a thing said about a result, not
			 * a result. The effect is delivered whether or not the state moved. */
			return { state, effects: [{ type: "announce", message: event.message }] };

		case "gestureEnd": {
			const gesture = state.gestures.get(event.gestureId);
			/* Exactly one terminal phase per gesture, enforced by there being
			 * nothing left to end. Escape followed by the pointer release that
			 * always follows it is the ordinary case, not an error. */
			if (!gesture) return unchanged(state);
			const effects: Effect[] = [{ type: "releasePointer", pointerId: gesture.pointerId }];
			if (gesture.autoScroll !== undefined) effects.push({ type: "stopAutoScroll" });
			return {
				state: {
					...state,
					gestures: withGesture(state, event.gestureId, undefined),
					lastGesture: {
						id: gesture.id,
						target: gesture.target,
						phase: terminalPhase(event.reason),
						reason: event.reason,
						at: gesture.current,
						engaged: gesture.engaged,
						modifiers: gesture.modifiers,
					},
				},
				effects,
			};
		}

		case "select": {
			const next = new Set(event.additive ? state.selection : []);
			for (const id of event.items) if (state.items.has(id)) next.add(id);
			if (selectionEquals(next, state.selection)) return unchanged(state);
			/* Only the items whose selected state actually changed are
			 * invalidated — the symmetric difference, which is two items for the
			 * ordinary "select another clip", not every item on the row. */
			const changed: ItemId[] = [];
			for (const id of next) if (!state.selection.has(id)) changed.push(id);
			for (const id of state.selection) if (!next.has(id)) changed.push(id);
			return {
				state: { ...state, selection: next },
				effects: invalidateItems(state, changed, options),
			};
		}

		case "focus": {
			const same =
				state.focus === event.target ||
				(state.focus !== undefined &&
					event.target !== undefined &&
					state.focus.kind === event.target.kind &&
					("id" in state.focus ? state.focus.id : undefined) ===
						("id" in event.target ? event.target.id : undefined));
			if (same) return unchanged(state);
			const next = { ...state, focus: event.target };
			return {
				state: next,
				effects: event.target ? [{ type: "focus", target: event.target }] : [],
			};
		}

		case "replaceItems": {
			const items = new Map<ItemId, TimelineItem>();
			const order: ItemId[] = [];
			for (const item of event.items) {
				items.set(item.id, item);
				order.push(item.id);
			}
			/* A selection may not name an item that no longer exists — otherwise a
			 * document change leaves the selection referring to nothing, and every
			 * consumer of the selection has to defend against it. */
			const selection = new Set<ItemId>();
			for (const id of state.selection) if (items.has(id)) selection.add(id);
			const focus =
				state.focus?.kind === "item" && !items.has(state.focus.id) ? undefined : state.focus;
			return {
				state: {
					...state,
					items,
					order,
					selection,
					focus,
					duration: event.duration ?? state.duration,
				},
				effects: [
					{
						type: "invalidateRegion",
						region: {
							xPx: 0,
							yPx: 0,
							widthPx: state.viewport.widthPx,
							heightPx: Math.max(1, state.rows.length) * options.rowHeightPx,
						},
					},
				],
			};
		}
	}
}

/**
 * Apply several events as one step.
 *
 * The reason this exists rather than a loop at the call site: two inputs
 * arriving in one frame must both be reflected in the published viewport, and
 * neither may overwrite the other with a value computed from a stale input.
 * Folding them through the reducer in order gives that by construction, because
 * each one sees the state the previous produced.
 */
export function reduceAll(
	state: TimelineState,
	events: readonly TimelineEvent[],
	options: ReducerOptions = DEFAULT_REDUCER_OPTIONS,
): Reduction<TimelineState> {
	let current = state;
	const effects: Effect[] = [];
	for (const event of events) {
		const step = reduce(current, event, options);
		current = step.state;
		effects.push(...step.effects);
	}
	return { state: current, effects };
}
