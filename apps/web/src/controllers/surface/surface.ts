/* The surface: DOM events in, kernel events out, kernel effects performed.
 *
 * It owns pointer capture on a stable root and resolves what a press concerns by
 * hit-testing once, at the press. The item's element is never party to the
 * gesture, so the item may re-render, change parent, or be recycled by
 * virtualization mid-drag without the gesture noticing.
 *
 * Everything here is expressed against structural interfaces rather than
 * `HTMLElement`. That is deliberate: a surface whose only testable form needs a
 * browser is a surface whose terminal paths get tested once, by hand.
 */
import type { FocusTarget } from "@models/timeline-view/types.ts";
import type {
	GestureId,
	GesturePoint,
	GestureTarget,
	GestureTermination,
} from "@models/timeline-view/gesture.ts";
import type { TimelineStore } from "@models/timeline-view/store.ts";
import { browserFrameClock, type FrameClock } from "@services/frame-clock/clock.ts";
import {
	createEffectInterpreter,
	type AnnouncementTarget,
	type EffectInterpreter,
	type PaintTarget,
	type PointerCaptureTarget,
} from "./interpreter.ts";
import { createScrollWriter, type ScrollTarget } from "./scroll-writer.ts";

/** The pointer facts the surface reads. A subset of `PointerEvent`. */
export interface SurfacePointerEvent {
	readonly pointerId: number;
	readonly clientX: number;
	readonly clientY: number;
	readonly pointerType?: string;
	readonly timeStamp?: number;
	/** Which button, where 0 is the primary one. */
	readonly button?: number;
	/** False for a secondary finger in a multi-touch sequence. */
	readonly isPrimary?: boolean;
	readonly altKey?: boolean;
	readonly shiftKey?: boolean;
	readonly metaKey?: boolean;
	readonly ctrlKey?: boolean;
}

/** The key facts the surface reads. */
export interface SurfaceKeyEvent {
	readonly key: string;
}

/** The wheel facts the surface reads. */
export interface SurfaceWheelEvent {
	readonly deltaX: number;
	readonly deltaY: number;
	readonly clientX: number;
	readonly ctrlKey?: boolean;
	preventDefault?(): void;
}

/**
 * Anything listeners can be attached to.
 *
 * Declared with the platform's own listener shape so a real element satisfies it
 * without a cast at every call site, and as methods rather than properties so a
 * handler taking one of the narrow event shapes above satisfies it too. The
 * narrowing happens once, in `on` below.
 */
export type SurfaceEventLike = Event | SurfacePointerEvent | SurfaceKeyEvent | SurfaceWheelEvent;

export type SurfaceListener = (event: SurfaceEventLike) => void;

export interface SurfaceEventTarget {
	addEventListener(
		type: string,
		listener: SurfaceListener,
		options?: { passive?: boolean; capture?: boolean },
	): void;
	removeEventListener(
		type: string,
		listener: SurfaceListener,
		options?: { capture?: boolean },
	): void;
}

/** Where the surface sits on the page, so a client point becomes a local one. */
export interface SurfaceBounds {
	readonly left: number;
	readonly top: number;
}

/** The surface root: it takes capture, hears events, and knows where it is. */
export interface SurfaceRoot extends SurfaceEventTarget, PointerCaptureTarget {
	getBoundingClientRect?(): SurfaceBounds;
}

/** What a press at this point concerns. `undefined` means the press is not ours. */
export type SurfaceHitTest = (
	point: GesturePoint,
	event: SurfacePointerEvent,
) => GestureTarget | undefined;

export interface TimelineSurfaceOptions {
	readonly root: SurfaceRoot;
	readonly store: TimelineStore;
	readonly hitTest: SurfaceHitTest;
	/** The element whose scroll position the viewport is applied to. */
	readonly scroller?: SurfaceEventTarget & ScrollTarget;
	/** Where `Escape` is heard. The root by default. */
	readonly keySource?: SurfaceEventTarget;
	readonly clock?: FrameClock;
	readonly liveRegion?: AnnouncementTarget;
	readonly paint?: PaintTarget;
	/** Move focus to the thing the kernel named. Only the host knows its element. */
	focus?(target: FocusTarget): void;
	/** How hard a wheel notch zooms. Larger magnifies faster. */
	readonly wheelZoomSensitivity?: number;
	/**
	 * Drive the viewport from touch, rather than leaving it to the browser.
	 *
	 * Off by default, and that default is the important half. A consumer whose
	 * timeline scrolls natively — the ordinary arrangement, and the one that keeps
	 * a press the surface declined free to become a pan — must not also receive a
	 * `pan` for the same finger, or the view moves twice. Turning this on says the
	 * surface owns the horizontal axis, and the consumer's stylesheet is expected
	 * to say so too (`touch-action: pan-y`).
	 *
	 * `pinch` is separable because two fingers are unambiguous — they never mean
	 * pan — so a consumer can take zoom without taking pan.
	 */
	readonly touchViewport?: {
		readonly pan?: boolean;
		readonly pinch?: boolean;
		/**
		 * Whether this finger is the view's to pan.
		 *
		 * Defaults to yes. A consumer says no for the regions it drives itself — a
		 * ruler being scrubbed is the case that forces this to exist: the hit test
		 * declines it, because no ITEM is being pressed, and "no item here" is not
		 * the same statement as "this finger belongs to the view". Pinch ignores it:
		 * two fingers are unambiguous wherever they land.
		 */
		pans?(event: SurfacePointerEvent): boolean;
	};
}

export interface TimelineSurface {
	/** Gestures currently in flight, for tests and for a consumer's own guards. */
	activeGestures(): readonly GestureId[];
	/** Listeners currently attached. Non-zero after `dispose` is a leak. */
	listenerCount(): number;
	readonly interpreter: EffectInterpreter;
	/**
	 * Detach everything.
	 *
	 * A gesture in flight ends as `unmount`, which rolls back — the surface
	 * disappearing is not a commit, and the previous implementation's silent drop
	 * left the item wherever the last sample had dragged it.
	 */
	dispose(): void;
}

/** A registered listener, kept so teardown can be proved rather than assumed. */
interface Registration {
	readonly target: SurfaceEventTarget;
	readonly type: string;
	readonly listener: SurfaceListener;
}

export function createTimelineSurface(options: TimelineSurfaceOptions): TimelineSurface {
	const { root, store, hitTest } = options;
	const clock = options.clock ?? browserFrameClock();
	const scroll = options.scroller ? createScrollWriter(options.scroller) : undefined;
	const interpreter = createEffectInterpreter({
		surface: root,
		scroll,
		liveRegion: options.liveRegion,
		paint: options.paint,
		clock,
		focus: options.focus,
		dispatch: (event) => {
			store.dispatch(event);
		},
	});
	store.setEffectSink((effects) => {
		interpreter.perform(effects);
	});

	/* Pointer to gesture, so a terminal path can find the gesture from the event
	 * that ended it, and so a second terminal event for the same pointer finds
	 * nothing and dispatches nothing. */
	const gestureByPointer = new Map<number, GestureId>();
	const registrations: Registration[] = [];
	let sequence = 0;
	let disposed = false;

	/* One cast, in one place. The structural listener type exists so a handler
	 * taking a narrow event shape can be attached to a real `EventTarget`, which
	 * hands its listeners a `PointerEvent` this surface reads a subset of. */
	function on<E extends SurfaceEventLike>(
		target: SurfaceEventTarget,
		type: string,
		handler: (event: E) => void,
		passive?: boolean,
	): void {
		/* SAFETY: `SurfaceEventLike` is the union of the shapes registered below,
		 * so this narrows within that union rather than across unrelated types.
		 * Each `on<E>` call site pairs a DOM event name with the shape that event
		 * actually has — `pointerdown` with the pointer fields, `keydown` with
		 * `key` — and the target calls the handler with the event it registered
		 * for. Done once here rather than at every handler. */
		const listener = handler as SurfaceListener;
		target.addEventListener(type, listener, passive === undefined ? undefined : { passive });
		registrations.push({ target, type, listener });
	}

	function localPoint(clientX: number, clientY: number): GesturePoint {
		const bounds = root.getBoundingClientRect?.();
		return { xPx: clientX - (bounds?.left ?? 0), yPx: clientY - (bounds?.top ?? 0) };
	}

	function endGesture(pointerId: number, reason: GestureTermination): void {
		const gestureId = gestureByPointer.get(pointerId);
		if (gestureId === undefined) return;
		/* Removed before dispatching, so a handler that runs synchronously off the
		 * resulting state cannot re-enter and end the same gesture twice. */
		gestureByPointer.delete(pointerId);
		store.dispatch({ type: "gestureEnd", gestureId, reason });
	}

	/* Touch points the surface is tracking for the viewport, in local pixels.
	 *
	 * Separate from `gestureByPointer` on purpose: a finger the hit test DECLINED
	 * opens no gesture, and that finger is exactly the one that pans. Tracking it
	 * here costs nothing when `touchViewport` is off, because nothing is ever put
	 * in the map. */
	const touchPoints = new Map<number, GesturePoint>();
	/* The distance between the two fingers at the last sample. Held rather than
	 * recomputed from the press, so a pinch is a ratio per sample and cannot
	 * accumulate the error a fixed baseline would. */
	let pinchDistancePx: number | undefined;
	/* Where the pinch is anchored, taken once when the second finger lands and
	 * held for the rest of it. Recomputing the midpoint per sample moves the fixed
	 * point as the fingers move, so the time under the anchor slides away — which
	 * is exactly the drift a focal zoom exists to prevent. */
	let pinchFocalPx: number | undefined;
	/* Whether each tracked finger is the view's to pan, answered once at the
	 * press. Re-asking per sample would let a finger that started on the ruler
	 * become a pan the moment it moved off it. */
	const panningPointers = new Map<number, boolean>();
	const touchPan = options.touchViewport?.pan === true;
	const touchPinch = options.touchViewport?.pinch === true;

	function forgetTouch(pointerId: number): void {
		panningPointers.delete(pointerId);
		if (!touchPoints.delete(pointerId)) return;
		/* Two fingers are needed for a pinch, so losing one ends it. The remaining
		 * finger does not silently become a pan of wherever the pinch left it: the
		 * next move re-reads its position first. */
		if (touchPoints.size < 2) {
			pinchDistancePx = undefined;
			pinchFocalPx = undefined;
		}
	}

	/** How far apart the two tracked fingers are now, or `undefined` if not two. */
	function currentPinchDistancePx(): number | undefined {
		if (touchPoints.size < 2) return undefined;
		const [first, second] = [...touchPoints.values()];
		if (!first || !second) return undefined;
		return Math.hypot(second.xPx - first.xPx, second.yPx - first.yPx);
	}

	/** The midpoint of the two tracked fingers, or `undefined` if not two. */
	function currentPinchFocalPx(): number | undefined {
		if (touchPoints.size < 2) return undefined;
		const [first, second] = [...touchPoints.values()];
		return first && second ? (first.xPx + second.xPx) / 2 : undefined;
	}

	function touchViewportMove(event: SurfacePointerEvent, panning: boolean): void {
		const previous = touchPoints.get(event.pointerId);
		if (!previous) return;
		const point = localPoint(event.clientX, event.clientY);
		touchPoints.set(event.pointerId, point);
		if (touchPoints.size >= 2) {
			if (!touchPinch) return;
			const [first, second] = [...touchPoints.values()];
			const distancePx = currentPinchDistancePx();
			const previousDistancePx = pinchDistancePx;
			pinchDistancePx = distancePx;
			/* The baseline was taken when the second finger landed, so the very first
			 * sample already magnifies — a pinch that needed two samples to start is
			 * a pinch that feels dead for its first few milliseconds. */
			if (
				!first ||
				!second ||
				distancePx === undefined ||
				previousDistancePx === undefined ||
				previousDistancePx <= 0 ||
				distancePx <= 0
			)
				return;
			store.dispatch({
				type: "zoom",
				focalPx: pinchFocalPx ?? (first.xPx + second.xPx) / 2,
				factor: distancePx / previousDistancePx,
			});
			return;
		}
		if (!touchPan || !panning) return;
		/* The content follows the finger, so the VIEW moves the other way. */
		const deltaPx = previous.xPx - point.xPx;
		if (deltaPx !== 0) store.dispatch({ type: "pan", deltaPx });
	}

	on<SurfacePointerEvent>(root, "pointerdown", (event) => {
		if ((touchPan || touchPinch) && event.pointerType === "touch") {
			touchPoints.set(event.pointerId, localPoint(event.clientX, event.clientY));
			panningPointers.set(event.pointerId, options.touchViewport?.pans?.(event) ?? true);
			/* A finger joining changes which pair is being measured, so the baseline
			 * is taken NOW rather than carried over from a distance that no longer
			 * describes the fingers on the glass. */
			pinchDistancePx = currentPinchDistancePx();
			pinchFocalPx = currentPinchFocalPx();
		}
		if (gestureByPointer.has(event.pointerId)) return;
		/* Primary button only. A right press opens a context menu and a middle one
		 * pastes or auto-scrolls; opening a gesture for either takes capture, which
		 * retargets the `contextmenu` that follows to the surface and stops the menu
		 * appearing at all. */
		if (event.button !== undefined && event.button !== 0) return;
		const point = localPoint(event.clientX, event.clientY);
		const target = hitTest(point, event);
		if (!target) return;
		const gestureId = `gesture-${++sequence}`;
		gestureByPointer.set(event.pointerId, gestureId);
		store.dispatch({
			type: "gestureBegin",
			gestureId,
			pointerId: event.pointerId,
			target,
			xPx: point.xPx,
			yPx: point.yPx,
			atMs: event.timeStamp ?? clock.now(),
			coarse: event.pointerType === "touch" || event.pointerType === "pen",
			/* Read at the press, not later: a policy that asked what is held NOW
			 * would change a drag's meaning halfway through when a key is released. */
			modifiers: {
				alt: event.altKey,
				shift: event.shiftKey,
				meta: event.metaKey,
				ctrl: event.ctrlKey,
			},
		});
	});

	on<SurfacePointerEvent>(root, "pointermove", (event) => {
		const gestureId = gestureByPointer.get(event.pointerId);
		if (gestureId === undefined) {
			touchViewportMove(event, panningPointers.get(event.pointerId) ?? true);
			return;
		}
		const point = localPoint(event.clientX, event.clientY);
		store.dispatch({
			type: "gestureMove",
			gestureId,
			xPx: point.xPx,
			yPx: point.yPx,
			atMs: event.timeStamp ?? clock.now(),
		});
		/* A second finger arriving during an item drag still zooms. The drag is not
		 * cancelled by it: the recognizer already engaged, and taking the edit away
		 * because a thumb landed is worse than letting both happen. A finger that
		 * IS the drag never also pans — the item is following it already. */
		touchViewportMove(event, false);
	});

	on<SurfacePointerEvent>(root, "pointerup", (event) => {
		forgetTouch(event.pointerId);
		endGesture(event.pointerId, "release");
	});
	on<SurfacePointerEvent>(root, "pointercancel", (event) => {
		forgetTouch(event.pointerId);
		endGesture(event.pointerId, "pointercancel");
	});
	on<SurfacePointerEvent>(root, "lostpointercapture", (event) => {
		endGesture(event.pointerId, "lostcapture");
	});

	on<SurfaceKeyEvent>(options.keySource ?? root, "keydown", (event) => {
		if (event.key !== "Escape") return;
		/* Every gesture, not only the first: a two-finger pinch is two gestures,
		 * and cancelling one of them would leave the other holding capture. */
		for (const pointerId of [...gestureByPointer.keys()]) endGesture(pointerId, "escape");
	});

	on<SurfaceWheelEvent>(
		root,
		"wheel",
		(event) => {
			/* A plain vertical wheel is the cross axis, which belongs to the
			 * consumer: leave it to the browser so the rows scroll. Claiming it here
			 * left a timeline whose lanes a mouse wheel could not move at all. */
			if (event.ctrlKey !== true && event.deltaX === 0) return;
			event.preventDefault?.();
			if (event.ctrlKey === true) {
				/* Exponential, so the same notch magnifies by the same ratio at every
				 * zoom. A linear step is coarse when zoomed out and imperceptible when
				 * zoomed in. */
				const factor = Math.exp(-event.deltaY * (options.wheelZoomSensitivity ?? 0.002));
				store.dispatch({ type: "zoom", focalPx: localPoint(event.clientX, 0).xPx, factor });
				return;
			}
			if (event.deltaX !== 0) store.dispatch({ type: "pan", deltaPx: event.deltaX });
		},
		false,
	);

	if (options.scroller) {
		const scroller = options.scroller;
		on<Event>(scroller, "scroll", () => {
			/* The echo of our own write is not new input. Without this, a zoom's
			 * published start comes straight back as a scroll computed against the
			 * pre-zoom scale, and the focal point drifts on every step. */
			if (scroll?.isEcho(scroller.scrollLeft) === true) return;
			store.dispatch({ type: "scroll", leftPx: scroller.scrollLeft });
		});
	}

	return {
		activeGestures: () => [...gestureByPointer.values()],
		listenerCount: () => registrations.length,
		interpreter,
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const pointerId of [...gestureByPointer.keys()]) endGesture(pointerId, "unmount");
			touchPoints.clear();
			panningPointers.clear();
			pinchDistancePx = undefined;
			pinchFocalPx = undefined;
			for (const { target, type, listener } of registrations)
				target.removeEventListener(type, listener);
			registrations.length = 0;
			interpreter.dispose();
			store.setEffectSink(undefined);
		},
	};
}
