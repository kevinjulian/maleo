/* Turning a decoded peak list into the bars a clip actually draws.
 *
 * Decoding happens once at high resolution; a clip is some number of pixels
 * wide and can show far fewer bars than that. Pure, and separated from the
 * component, because the component now draws to a canvas — where a wrong bar
 * count is invisible in the DOM and cannot be asserted by looking at it.
 */

/** Bars are this many pixels apart, including the gap. */
export const PX_PER_BAR = 4;
/** Below this a waveform reads as noise, so a very short clip still gets this
 *  many bars and is drawn compressed rather than nearly empty. */
export const MIN_DISPLAY_BARS = 16;

/** How many bars fit in `widthPx`, bounded by what was decoded. */
export function barCount(peakCount: number, widthPx?: number): number {
	if (widthPx == null) return Math.min(peakCount, 64);
	return Math.max(MIN_DISPLAY_BARS, Math.min(peakCount, Math.floor(widthPx / PX_PER_BAR)));
}

/** Downsample peaks to the number of bars the clip has room for.
 *
 *  Max-of-bucket rather than mean: a waveform is read for its transients, and
 *  averaging is what turns a drum hit into a gentle rise. */
export function displayPeaks(peaks: number[], widthPx?: number): number[] {
	const bars = barCount(peaks.length, widthPx);
	if (bars >= peaks.length) return peaks;
	const bucket = peaks.length / bars;
	return Array.from({ length: bars }, (_, i) => {
		let max = 0;
		for (
			let j = Math.floor(i * bucket);
			j < Math.min(peaks.length, Math.ceil((i + 1) * bucket));
			j++
		) {
			if (peaks[j]! > max) max = peaks[j]!;
		}
		return max;
	});
}
