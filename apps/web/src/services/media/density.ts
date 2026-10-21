/* How fine a summary has to be, decided from the pixels available to draw it.
 *
 * Not from the asset, and not from a constant. An item drawn forty pixels wide
 * can show forty buckets; asking for four thousand costs a hundred times the
 * work to produce something nobody can see, and asking for four produces a
 * waveform that looks like a rectangle.
 *
 * The step ladder matters as much as the formula: a density that changed with
 * every pixel of zoom would invalidate the cache continuously, so densities
 * quantise upward and a zoom that stays inside a step costs nothing.
 */
import type { SummaryKind } from "./cache-key.ts";

/** Densities are chosen from this ladder, so nearby zooms share a cache entry. */
export const DENSITY_STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000] as const;

export interface DensityRequest {
	/** How wide the item is drawn, in device pixels. */
	readonly widthPx: number;
	/** How long the drawn region is, in seconds of source. */
	readonly durationSeconds: number;
	readonly kind: SummaryKind;
	/** Buckets per pixel. One is enough for a waveform; a filmstrip wants far fewer. */
	readonly bucketsPerPixel?: number;
}

/** Frames per second a filmstrip aims for. A thumbnail every few pixels, not every pixel. */
const FILMSTRIP_BUCKETS_PER_PIXEL = 1 / 60;

/**
 * The density to request, quantised up to the next step.
 *
 * Up rather than to the nearest: rounding down produces a summary too coarse for
 * the pixels it will be drawn into, which is the one failure mode a person can
 * see.
 */
export function densityFor(request: DensityRequest): number {
	const perPixel =
		request.bucketsPerPixel ?? (request.kind === "filmstrip" ? FILMSTRIP_BUCKETS_PER_PIXEL : 1);
	const seconds = Math.max(request.durationSeconds, 1e-6);
	const wanted = (Math.max(0, request.widthPx) * perPixel) / seconds;
	for (const step of DENSITY_STEPS) if (step >= wanted) return step;
	return DENSITY_STEPS[DENSITY_STEPS.length - 1]!;
}

/**
 * Whether a summary in hand is good enough for the density now wanted.
 *
 * The zoom-out case: a summary produced when the item was wide already exceeds
 * what a narrower drawing needs, so nothing is requested. Zooming back in past
 * the step it was produced at asks again.
 */
export function densitySuffices(have: number, want: number): boolean {
	return have >= want;
}
