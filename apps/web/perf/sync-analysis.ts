/** Audiovisual offset analysis for the D10 marker fixture. All times are epoch milliseconds. */
export interface Draw {
	frame: number;
	at: number;
}
export interface Segment {
	label: string;
	/** When the transport command was issued. */
	command: number;
	/** When the next command was issued, or the run ended. */
	end: number;
	rate: number;
	/** Timeline seconds the command moved to; undefined for a rate change in place. */
	target?: number;
}
export interface SegmentResult {
	label: string;
	rate: number;
	settleMs: number | null;
	/** Which side bounded settling: the first draw at the commanded time, and the first output heard. */
	drawMs: number | null;
	audioMs: number | null;
	/** "onset" when output resumed after silence; "click" when only a later click showed it. */
	audioBy: "onset" | "click" | null;
	offsetsMs: number[];
}

export function percentile(values: readonly number[], p: number): number {
	if (!values.length) return Number.NaN;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
}

/** Settling ends when both the video shows the commanded time and the output resumes after the command. */
function settle(
	segment: Segment,
	draws: readonly Draw[],
	onsets: readonly number[],
	clicks: readonly number[],
	fps: number,
) {
	const drawn = draws.find(
		(draw) =>
			draw.at > segment.command &&
			(segment.target === undefined || Math.abs(draw.frame / fps - segment.target) < 0.5),
	);
	const onset = onsets.find((at) => at > segment.command && at < segment.command + 1000);
	const heard = onset ?? clicks.find((at) => at > segment.command);
	return {
		settleMs: drawn && heard !== undefined ? Math.max(drawn.at, heard) - segment.command : null,
		drawMs: drawn ? drawn.at - segment.command : null,
		audioMs: heard === undefined ? null : heard - segment.command,
		audioBy:
			onset !== undefined ? ("onset" as const) : heard === undefined ? null : ("click" as const),
	};
}

/**
 * A click's offset is its audible time minus the time the video reached the click's timeline frame.
 * Clicks are assigned to the nearest marker of the timeline frame on screen when they were heard,
 * which is unambiguous while the offset stays under half the marker spacing in wall time.
 */
export function analyzeSync(input: {
	draws: readonly Draw[];
	clicks: readonly number[];
	onsets: readonly number[];
	segments: readonly Segment[];
	fps: number;
	clickIntervalSec: number;
}): SegmentResult[] {
	const draws = [...input.draws].sort((a, b) => a.at - b.at);
	return input.segments.map((segment) => {
		const settled = settle(segment, draws, input.onsets, input.clicks, input.fps),
			settleMs = settled.settleMs;
		const offsetsMs: number[] = [];
		if (settleMs !== null) {
			const from = segment.command + settleMs;
			const window = draws.filter((draw) => draw.at > from && draw.at <= segment.end);
			for (const heard of input.clicks) {
				if (heard <= from || heard >= segment.end) continue;
				const shown = window.filter((draw) => draw.at <= heard).at(-1);
				if (!shown) continue;
				const marker =
					Math.round(shown.frame / input.fps / input.clickIntervalSec) * input.clickIntervalSec;
				const frame = Math.round(marker * input.fps);
				const reached = window.find((draw) => draw.frame >= frame);
				if (!reached) continue;
				// Interpolate back to when the exact marker frame was due at this rate.
				const due = reached.at - ((reached.frame - frame) / (input.fps * segment.rate)) * 1000;
				offsetsMs.push(heard - due);
			}
		}
		return { label: segment.label, rate: segment.rate, ...settled, offsetsMs };
	});
}
