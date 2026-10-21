/* What the kernel asks the host to do, described rather than performed.
 *
 * Every effect here is data: it round-trips through JSON without loss and
 * carries no function and no DOM reference. That constraint is the whole point.
 * The previous implementation had two owners on one pointer and four imperative
 * writers on one derived value; both become unrepresentable when there is
 * exactly one writer producing descriptions and exactly one interpreter
 * performing them.
 *
 * If an effect ever needs a callback, the design is wrong: the host reports
 * back by dispatching an event, which is the same road in the other direction.
 */
import type { FocusTarget, ItemId } from "./types.ts";

/** A rectangle in device pixels, relative to the surface's own origin. */
export interface PaintRegion {
	readonly xPx: number;
	readonly yPx: number;
	readonly widthPx: number;
	readonly heightPx: number;
}

/** Take pointer capture on the surface. Never on the item the gesture concerns. */
export interface CapturePointerEffect {
	readonly type: "capturePointer";
	readonly pointerId: number;
}

/** Give capture back. Paired with exactly one terminal phase. */
export interface ReleasePointerEffect {
	readonly type: "releasePointer";
	readonly pointerId: number;
}

/** Move the scroller to a resolved position. The surface applies it and does not re-read it. */
export interface ScrollToEffect {
	readonly type: "scrollTo";
	readonly leftPx: number;
}

/** Begin edge auto-scroll. Driven by the host's frame clock, cancelled by `stopAutoScroll`. */
export interface StartAutoScrollEffect {
	readonly type: "startAutoScroll";
	/** -1 towards the start of the timeline, 1 towards its end. */
	readonly direction: -1 | 1;
	readonly pixelsPerSecond: number;
}

/** End edge auto-scroll, and cancel any frame it has pending. */
export interface StopAutoScrollEffect {
	readonly type: "stopAutoScroll";
}

/** Move focus. The host owns which element that is; the kernel owns which thing. */
export interface FocusEffect {
	readonly type: "focus";
	readonly target: FocusTarget;
}

/** Announce a committed result through the live region. */
export interface AnnounceEffect {
	readonly type: "announce";
	readonly message: string;
}

/**
 * Repaint a region, and only that region.
 *
 * Regions rather than "repaint": a canvas that redraws entirely on selection has
 * given back the cost that making selection a subscription bought, in a form no
 * render counter would show.
 */
export interface InvalidateRegionEffect {
	readonly type: "invalidateRegion";
	readonly region: PaintRegion;
	/** The items the region was computed for, so a test can say why it was invalidated. */
	readonly items?: readonly ItemId[];
}

/** Everything the kernel can ask for. */
export type Effect =
	| CapturePointerEffect
	| ReleasePointerEffect
	| ScrollToEffect
	| StartAutoScrollEffect
	| StopAutoScrollEffect
	| FocusEffect
	| AnnounceEffect
	| InvalidateRegionEffect;

/** Every effect type, so a test can prove it covered all of them. */
export const EFFECT_TYPES = [
	"capturePointer",
	"releasePointer",
	"scrollTo",
	"startAutoScroll",
	"stopAutoScroll",
	"focus",
	"announce",
	"invalidateRegion",
] as const satisfies readonly Effect["type"][];

/** A reducer's whole answer: the next state, and what the host should do. */
export interface Reduction<S> {
	readonly state: S;
	readonly effects: readonly Effect[];
}

/**
 * Whether a value is data all the way down.
 *
 * Used by the tests that hold effects to their contract. Written here rather
 * than in the test so the rule and the type live together — a new effect
 * variant is checked by the same predicate that documents the rule.
 */
export function isSerializable(value: unknown): boolean {
	if (value === null) return true;
	switch (typeof value) {
		case "string":
		case "number":
		case "boolean":
			return true;
		case "object":
			break;
		case "bigint":
		case "function":
		case "symbol":
		case "undefined":
			return false;
	}
	if (Array.isArray(value)) return value.every(isSerializable);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	/* `Object.values` on the narrowed value rather than an assertion to a
	 * dictionary: the shape is `unknown` because it is the thing being tested,
	 * and asserting one would be answering the question with itself. */
	return Object.values(value).every(isSerializable);
}

/** The union of two regions: the smallest rectangle containing both. */
export function unionRegions(a: PaintRegion, b: PaintRegion): PaintRegion {
	const left = Math.min(a.xPx, b.xPx);
	const top = Math.min(a.yPx, b.yPx);
	const right = Math.max(a.xPx + a.widthPx, b.xPx + b.widthPx);
	const bottom = Math.max(a.yPx + a.heightPx, b.yPx + b.heightPx);
	return { xPx: left, yPx: top, widthPx: right - left, heightPx: bottom - top };
}
