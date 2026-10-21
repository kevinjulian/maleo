/* The one place a kernel effect becomes something that happens.
 *
 * Pointer capture, scrolling, focus, announcement, and paint invalidation are
 * performed here and nowhere else. No component calls `setPointerCapture` or
 * writes `scrollLeft`; a component that wanted to would have to dispatch an
 * event, which is the same road in the other direction and is the point.
 *
 * That is what makes "two owners on one pointer" unrepresentable rather than
 * merely discouraged: there is one interpreter, and it is the only thing holding
 * capture.
 */
import type { Effect, PaintRegion } from "@models/timeline-view/effects.ts";
import type { FocusTarget } from "@models/timeline-view/types.ts";
import type { TimelineEvent } from "@models/timeline-view/events.ts";
import { browserFrameClock, type FrameClock } from "@services/frame-clock/clock.ts";
import type { ScrollWriter } from "./scroll-writer.ts";

/** Whatever capture is taken on. The surface root, never the item's element. */
export interface PointerCaptureTarget {
	setPointerCapture(pointerId: number): void;
	releasePointerCapture(pointerId: number): void;
}

/** Where a repaint is asked for. Region by region, never "repaint everything". */
export interface PaintTarget {
	invalidate(region: PaintRegion): void;
}

/** The live region. Structural rather than an element, so the announcement is testable. */
export interface AnnouncementTarget {
	textContent: string | null;
}

/** Everything the interpreter is allowed to touch. */
export interface InterpreterHost {
	readonly surface: PointerCaptureTarget;
	/** The one writer of the scroller's position. */
	readonly scroll?: ScrollWriter;
	readonly liveRegion?: AnnouncementTarget;
	readonly paint?: PaintTarget;
	readonly clock?: FrameClock;
	/**
	 * Move focus to the thing the kernel named.
	 *
	 * The kernel owns which THING is focused; the host owns which element that
	 * is, because only the host knows which items are currently mounted.
	 */
	focus?(target: FocusTarget): void;
	/**
	 * Report back into the kernel.
	 *
	 * Auto-scroll is the reason this exists: a frame of travel is an input like
	 * any other, so it is dispatched as a `pan` rather than written to the
	 * viewport directly. An effect never carries a callback; the host answers by
	 * dispatching.
	 */
	dispatch(event: TimelineEvent): void;
}

/** Performs effects, and can be asked to stop everything it started. */
export interface EffectInterpreter {
	perform(effects: readonly Effect[]): void;
	/** Release every capture and cancel every frame. Idempotent. */
	dispose(): void;
	/** Pointers currently captured. Non-empty after teardown is a leak. */
	capturedPointers(): readonly number[];
	/** Whether a frame is outstanding. Read by the leak test. */
	hasPendingFrame(): boolean;
}

export function createEffectInterpreter(host: InterpreterHost): EffectInterpreter {
	const clock = host.clock ?? browserFrameClock();
	const captured = new Set<number>();
	let frame: number | undefined;
	let travel: { direction: -1 | 1; pixelsPerSecond: number; lastMs: number } | undefined;
	let disposed = false;

	function cancelFrame(): void {
		if (frame === undefined) return;
		clock.cancel(frame);
		frame = undefined;
	}

	function stopAutoScroll(): void {
		travel = undefined;
		cancelFrame();
	}

	function step(timeMs: number): void {
		frame = undefined;
		/* Re-read `travel` rather than closing over it: a terminal phase between
		 * the request and the callback has cleared it, and this is the moment the
		 * previous implementation kept scrolling through. */
		if (!travel || disposed) return;
		const elapsedMs = Math.max(0, timeMs - travel.lastMs);
		travel = { ...travel, lastMs: timeMs };
		const deltaPx = (travel.direction * travel.pixelsPerSecond * elapsedMs) / 1000;
		if (deltaPx !== 0) host.dispatch({ type: "pan", deltaPx });
		frame = clock.request(step);
	}

	function performOne(effect: Effect): void {
		switch (effect.type) {
			case "capturePointer":
				/* A capture that cannot be taken is not fatal. `setPointerCapture`
				 * THROWS for a pointer the browser no longer considers active — a
				 * synthetic press, a pointer released before the effect ran, a touch
				 * the browser cancelled — and letting that escape would abort the
				 * dispatch that produced it and leave the gesture half-open. The
				 * gesture continues without capture, which is degraded rather than
				 * broken: events still arrive while the pointer stays over the
				 * surface. */
				try {
					host.surface.setPointerCapture(effect.pointerId);
					captured.add(effect.pointerId);
				} catch {
					/* Not recorded, so teardown does not try to release it either. */
				}
				return;
			case "releasePointer":
				/* Released whether or not it was recorded, because the browser may
				 * have taken it away already; releasing a capture nobody holds is a
				 * no-op, and skipping it when we think it is gone is a leak. It
				 * throws in the same circumstances as the capture above, and for the
				 * same reason that must not escape. */
				try {
					host.surface.releasePointerCapture(effect.pointerId);
				} catch {
					/* Already gone, which is the state this was asking for. */
				}
				captured.delete(effect.pointerId);
				return;
			case "scrollTo":
				host.scroll?.write(effect.leftPx);
				return;
			case "startAutoScroll":
				travel = {
					direction: effect.direction,
					pixelsPerSecond: effect.pixelsPerSecond,
					lastMs: clock.now(),
				};
				cancelFrame();
				frame = clock.request(step);
				return;
			case "stopAutoScroll":
				stopAutoScroll();
				return;
			case "focus":
				host.focus?.(effect.target);
				return;
			case "announce":
				/* The region is already in the document — the host owns it, and only
				 * its text changes here. A live region mounted together with its first
				 * text is not announced by most screen readers. */
				if (host.liveRegion) host.liveRegion.textContent = effect.message;
				return;
			case "invalidateRegion":
				host.paint?.invalidate(effect.region);
				return;
		}
	}

	return {
		perform(effects) {
			if (disposed) return;
			for (const effect of effects) performOne(effect);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			stopAutoScroll();
			for (const pointerId of [...captured]) {
				try {
					host.surface.releasePointerCapture(pointerId);
				} catch {
					/* The browser dropped it first, which is the outcome anyway. */
				}
			}
			captured.clear();
		},
		capturedPointers: () => [...captured],
		hasPendingFrame: () => frame !== undefined,
	};
}
