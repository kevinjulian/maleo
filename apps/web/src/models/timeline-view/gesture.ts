/* A gesture, as state rather than as a controller.
 *
 * The previous implementation held a gesture in a controller attached to the
 * item's own element. A row change during a drag re-parented that element,
 * which unmounted it, disposed the controller, and reported a cancel — with the
 * item snapping back. Virtualization makes that the normal case rather than an
 * edge case, because a dragged item leaving the visible range is recycled.
 *
 * So a gesture lives here, keyed by its own identity, and the item it concerns
 * travels as payload. Nothing about it refers to an element, which is what makes
 * an item free to re-render, change parent, or unmount mid-gesture.
 */
import type { GestureSample } from "./engagement.ts";
import type { ItemId, RowId } from "./types.ts";

/** Host-assigned identity for one gesture. Unique for the gesture's lifetime. */
export type GestureId = string;

/** A point on the surface, in device pixels relative to the surface's origin. */
export interface GesturePoint {
	readonly xPx: number;
	readonly yPx: number;
}

/**
 * What a gesture concerns, resolved once by hit-testing at the press.
 *
 * Resolved once rather than re-read per sample: the element under the pointer
 * changes as the drag moves, and a gesture that re-derived its subject would
 * change what it is editing halfway through.
 */
export type GestureTarget =
	| { readonly kind: "item"; readonly id: ItemId; readonly edge?: "start" | "end" }
	| { readonly kind: "row"; readonly id: RowId }
	| { readonly kind: "marker"; readonly id: string }
	| { readonly kind: "ruler" }
	| { readonly kind: "surface" };

/**
 * Why a gesture ended.
 *
 * Every one of these is a terminal path the surface must report. `release` is
 * the only one that commits; the rest roll back. They are named rather than
 * collapsed into a boolean because "the browser took capture away" and "the
 * person pressed Escape" are different events to a consumer, and a test that
 * cannot tell them apart cannot prove each path is wired.
 */
export type GestureTermination = "release" | "pointercancel" | "lostcapture" | "escape" | "unmount";

/**
 * The modifier keys held when the gesture began.
 *
 * Carried on the gesture because every editor's policy reads them — bypass
 * snapping, constrain an axis, add to a selection — and reading them from a
 * later DOM event would ask a different question: what is held NOW, rather than
 * what was held when the press happened. A drag whose meaning changed halfway
 * because a key was released is not what anybody means.
 */
export interface GestureModifiers {
	readonly alt?: boolean;
	readonly shift?: boolean;
	readonly meta?: boolean;
	readonly ctrl?: boolean;
}

/** A gesture in flight. */
export interface GestureState {
	readonly id: GestureId;
	readonly pointerId: number;
	readonly target: GestureTarget;
	readonly origin: GesturePoint;
	readonly current: GesturePoint;
	/** Host clock reading at the press, in milliseconds. */
	readonly startedAtMs: number;
	readonly samples: readonly GestureSample[];
	/** Whether the consumer's recognizer has accepted this as a drag. */
	readonly engaged: boolean;
	readonly modifiers: GestureModifiers;
	/** The direction edge auto-scroll is running in, when it is running. */
	readonly autoScroll?: -1 | 1;
}

/**
 * The one terminal phase a gesture produced.
 *
 * Kept on the state rather than announced as an effect, because a terminal phase
 * is a fact about the timeline and not an instruction to the host. A second
 * terminal event for the same gesture finds nothing to end and changes nothing,
 * so this records the first and only outcome.
 */
export interface GestureOutcome {
	readonly id: GestureId;
	readonly target: GestureTarget;
	readonly phase: "commit" | "rollback";
	readonly reason: GestureTermination;
	readonly at: GesturePoint;
	readonly engaged: boolean;
	readonly modifiers: GestureModifiers;
}

/** Whether a termination commits the gesture or rolls it back. */
export function terminalPhase(reason: GestureTermination): "commit" | "rollback" {
	return reason === "release" ? "commit" : "rollback";
}

/** How far the pointer is from where it pressed, in pixels. */
export function gestureDistancePx(origin: GesturePoint, current: GesturePoint): number {
	return Math.hypot(current.xPx - origin.xPx, current.yPx - origin.yPx);
}
