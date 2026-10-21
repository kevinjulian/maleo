/* The viewport, resolved in one place.
 *
 * This is the direct answer to a measured failure. The previous implementation
 * published the viewport from four places — scroll, resize, wheel, and pinch —
 * each constructing a fresh object; a `ResizeObserver` re-armed on every publish
 * and republished an equal value, and the loop that produced could overwrite a
 * zoom with a scroll computed from a stale input.
 *
 * Two rules remove that family:
 *
 *   1. Every input is an event. Nothing publishes the viewport but `resolve`.
 *   2. A resolution equal to the published one is not published at all, so a
 *      republish of an equal value cannot start anything.
 */
import { projectTime, type ProjectTime } from "./tick.ts";
import type { Viewport, ViewportInput } from "./types.ts";

/** The smallest magnification the viewport will resolve to. */
const MIN_SCALE = Number.MIN_VALUE;

/** Fill in the derived field. The only place `end` is ever computed. */
export function resolveViewport(input: ViewportInput): Viewport {
	const spanTicks = Math.round(input.widthPx / input.scale);
	return { ...input, end: projectTime(input.start.ticks + spanTicks) };
}

/**
 * Whether two viewports are the same view.
 *
 * Compared on the three stored fields. `end` is derived from them, so a
 * comparison that included it would be asking the same question twice — and a
 * comparison that omitted one of the three would let a change through.
 */
export function viewportEquals(a: Viewport, b: Viewport): boolean {
	return a.start.ticks === b.start.ticks && a.scale === b.scale && a.widthPx === b.widthPx;
}

/** Keep the viewport inside the timeline, allowing a screen of run-off at the end. */
export function clampViewport(input: ViewportInput, duration: ProjectTime): ViewportInput {
	const spanTicks = Math.round(input.widthPx / input.scale);
	const maxStart = Math.max(0, duration.ticks - Math.round(spanTicks / 2));
	const ticks = Math.min(Math.max(0, input.start.ticks), maxStart);
	return { ...input, start: projectTime(ticks) };
}

/** Move the view by a pixel delta, without changing magnification. */
export function panBy(input: ViewportInput, deltaPx: number): ViewportInput {
	return { ...input, start: projectTime(input.start.ticks + Math.round(deltaPx / input.scale)) };
}

/** Move the view to an absolute scroll offset in pixels. */
export function scrollTo(input: ViewportInput, leftPx: number): ViewportInput {
	return { ...input, start: projectTime(Math.round(leftPx / input.scale)) };
}

/** The scroll offset in pixels that corresponds to the current start. */
export function scrollOffsetPx(input: ViewportInput): number {
	return input.start.ticks * input.scale;
}

/**
 * Zoom about a point, keeping the time under that point where it was.
 *
 * The focal point is held by construction rather than corrected afterwards: the
 * time under the pixel is read before the scale changes and the start is
 * re-derived from it, so repeated zooming cannot accumulate drift. Rounding to
 * a whole tick is the only movement, and it is bounded by one tick — a
 * thousandth of a frame — rather than growing with the number of steps.
 */
export function zoomAbout(
	input: ViewportInput,
	focalPx: number,
	factor: number,
	limits: ScaleLimits,
): ViewportInput {
	const focalTicks = input.start.ticks + focalPx / input.scale;
	const scale = clampScale(input.scale * factor, limits);
	return { ...input, scale, start: projectTime(Math.round(focalTicks - focalPx / scale)) };
}

/** How far in and out a consumer allows zooming. */
export interface ScaleLimits {
	readonly minScale: number;
	readonly maxScale: number;
}

/** Hold a magnification inside its limits. */
export function clampScale(scale: number, limits: ScaleLimits): number {
	if (!Number.isFinite(scale) || scale <= 0) return Math.max(limits.minScale, MIN_SCALE);
	return Math.min(Math.max(scale, limits.minScale), limits.maxScale);
}

/** Resize the viewport. Magnification is kept; the visible span changes with the width. */
export function resizeTo(input: ViewportInput, widthPx: number): ViewportInput {
	return { ...input, widthPx: Math.max(0, widthPx) };
}

/** The time under a pixel offset within the viewport. */
export function timeAtPixel(input: ViewportInput, offsetPx: number): ProjectTime {
	return projectTime(Math.round(input.start.ticks + offsetPx / input.scale));
}

/** The pixel offset within the viewport at which a time falls. */
export function pixelAtTime(input: ViewportInput, time: ProjectTime): number {
	return (time.ticks - input.start.ticks) * input.scale;
}
