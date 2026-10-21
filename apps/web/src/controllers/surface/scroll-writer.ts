/* The one writer of the scroller's position, and the echo it must not re-read.
 *
 * Setting `scrollLeft` makes the browser fire `scroll`. Reading that event back
 * as new input is how a zoom loses its focal point: the zoom publishes a start,
 * the scroller echoes it, the echo is reduced as a scroll computed against the
 * pre-zoom scale, and the view drifts a little on every step.
 *
 * So a write records what it wrote, and the next scroll reading that matches it
 * is consumed rather than dispatched. One echo per write, because a second
 * scroll at the same position genuinely is the person putting it back there.
 */

/** Anything with a horizontal scroll offset. Structural, so a test can be one. */
export interface ScrollTarget {
	scrollLeft: number;
}

/** Writes the scroller, and recognizes the echoes of its own writes. */
export interface ScrollWriter {
	/** Apply a resolved position. */
	write(leftPx: number): void;
	/** Whether this reading is the echo of the last write. Consumes it. */
	isEcho(leftPx: number): boolean;
	/** The position last written, or `undefined` when its echo has been consumed. */
	readonly pending: number | undefined;
}

/**
 * @param tolerancePx How far a reading may sit from the written value and still
 * be the same position. Browsers round `scrollLeft` to device pixels, so an
 * exact comparison would call every fractional write a new input.
 */
export function createScrollWriter(target: ScrollTarget, tolerancePx = 0.5): ScrollWriter {
	let pending: number | undefined;
	return {
		write(leftPx) {
			pending = leftPx;
			target.scrollLeft = leftPx;
		},
		isEcho(leftPx) {
			if (pending === undefined) return false;
			if (Math.abs(leftPx - pending) > tolerancePx) return false;
			pending = undefined;
			return true;
		},
		get pending() {
			return pending;
		},
	};
}
