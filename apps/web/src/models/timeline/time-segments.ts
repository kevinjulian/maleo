/* When the picture changes, as opposed to when the clock does.
 *
 * The preview derives three things from the playhead: which scene is painted,
 * which clips are live enough to be clicked on the canvas, and which assets are
 * worth preloading. None of them changes thirty times a second — they change
 * when a clip starts or ends, which on a real timeline is a few times a minute.
 *
 * So the surfaces that draw them do not subscribe to the time. They subscribe to
 * the SEGMENT: the gap between two consecutive boundaries, where every one of
 * those answers is constant by construction. Finding it is a binary search,
 * which is what stops the per-frame cost growing with the clip count — the
 * profile that made playback stutter at a few hundred clips while the timeline
 * itself was not re-rendering at all.
 */

/** A clip's occupied span. */
export interface TimeSpan {
	start: number;
	end: number;
}

/** Every instant at which something on the timeline starts or ends, sorted and
 *  de-duplicated. Zero is always a boundary, so a time before the first clip is
 *  segment 0 rather than -1. */
export function boundaryTimes(spans: Iterable<TimeSpan>): number[] {
	const times = new Set<number>([0]);
	for (const span of spans) {
		if (Number.isFinite(span.start)) times.add(Math.max(0, span.start));
		if (Number.isFinite(span.end)) times.add(Math.max(0, span.end));
	}
	return [...times].sort((a, b) => a - b);
}

/** Which segment `sec` falls in: the count of boundaries at or before it.
 *
 *  Binary search rather than a scan, because this runs on every frame event
 *  while the preview plays and the whole point is that it must not grow with the
 *  number of clips. */
export function segmentIndexAt(boundaries: number[], sec: number): number {
	let low = 0;
	let high = boundaries.length;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (boundaries[mid]! <= sec) low = mid + 1;
		else high = mid;
	}
	return low;
}
