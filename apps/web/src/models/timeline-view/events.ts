/* Everything that can happen to a timeline, as data.
 *
 * Inputs that influence a derived value are dispatched here rather than
 * publishing that value themselves. Scroll, resize, zoom, and pan are the four
 * that matter most: they were four writers on one viewport, and they are four
 * events on one reducer now.
 */
import type { ProjectTime } from "./tick.ts";
import type { GestureId, GestureModifiers, GestureTarget, GestureTermination } from "./gesture.ts";
import type { FocusTarget, ItemId, TimelineItem, Viewport } from "./types.ts";

/** The scroller moved, or the host wants it to. */
export interface ScrollEvent {
	readonly type: "scroll";
	readonly leftPx: number;
}

/** The surface changed size. */
export interface ResizeEvent {
	readonly type: "resize";
	readonly widthPx: number;
	/** The scroller's leading padding, when it has one. See `ViewportInput.leadPx`. */
	readonly leadPx?: number;
}

/** Magnify about a point in the viewport. */
export interface ZoomEvent {
	readonly type: "zoom";
	readonly focalPx: number;
	/** Multiplicative: 2 doubles the magnification, 0.5 halves it. */
	readonly factor: number;
}

/** Move the view without changing magnification. */
export interface PanEvent {
	readonly type: "pan";
	readonly deltaPx: number;
}

/** Replace the selection outright. */
export interface SelectEvent {
	readonly type: "select";
	readonly items: readonly ItemId[];
	/** Add to the selection rather than replacing it. */
	readonly additive?: boolean;
}

/** Move focus, which is one thing and is not the selection. */
export interface FocusEvent {
	readonly type: "focus";
	readonly target: FocusTarget | undefined;
}

/** The consumer's document changed under us. */
export interface ReplaceItemsEvent {
	readonly type: "replaceItems";
	readonly items: readonly TimelineItem[];
	readonly duration?: ProjectTime;
}

/**
 * A pointer went down on the surface, and hit-testing resolved what it means.
 *
 * The target is carried here, once, rather than looked up again per sample. The
 * surface owns capture; the item owns nothing.
 */
export interface GestureBeginEvent {
	readonly type: "gestureBegin";
	readonly gestureId: GestureId;
	readonly pointerId: number;
	readonly target: GestureTarget;
	readonly xPx: number;
	readonly yPx: number;
	/** Host clock reading, in milliseconds. Supplied so the kernel needs no clock. */
	readonly atMs: number;
	readonly coarse?: boolean;
	/** What was held at the press. Read by the consumer's own policy. */
	readonly modifiers?: GestureModifiers;
}

/** The pointer moved while a gesture is in flight. */
export interface GestureMoveEvent {
	readonly type: "gestureMove";
	readonly gestureId: GestureId;
	readonly xPx: number;
	readonly yPx: number;
	readonly atMs: number;
}

/** The gesture ended, by whichever of the terminal paths actually happened. */
export interface GestureEndEvent {
	readonly type: "gestureEnd";
	readonly gestureId: GestureId;
	readonly reason: GestureTermination;
}

/**
 * Say something through the live region.
 *
 * The message is the host's, because only the host knows the consumer's
 * language and terminology; the kernel decides *when* there is a result worth
 * announcing and routes it through the one interpreter.
 */
export interface AnnounceEvent {
	readonly type: "announce";
	readonly message: string;
}

/** Everything a host may dispatch. */
export type TimelineEvent =
	| ScrollEvent
	| ResizeEvent
	| ZoomEvent
	| PanEvent
	| SelectEvent
	| FocusEvent
	| ReplaceItemsEvent
	| GestureBeginEvent
	| GestureMoveEvent
	| GestureEndEvent
	| AnnounceEvent;

/** Whether an event is one of the four that resolve the viewport. */
export function isViewportEvent(event: TimelineEvent): boolean {
	return (
		event.type === "scroll" ||
		event.type === "resize" ||
		event.type === "zoom" ||
		event.type === "pan"
	);
}

/** What a subscriber to the viewport slice receives. */
export type ViewportSnapshot = Viewport;
