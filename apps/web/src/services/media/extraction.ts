/* Which path produces a summary, and what it costs to say so.
 *
 * Waveforms have one path: decode audio and decimate it. Filmstrips have two,
 * and they differ by an order of magnitude — WebCodecs demuxes and decodes
 * frames directly, while seeking a `<video>` element and drawing each frame is
 * slow enough that the honest response is fewer frames, not the same number
 * later.
 *
 * The rule is that the degraded path is DECLARED. A consumer that cannot tell a
 * full-quality summary from a weaker one cannot decide whether to show it, cache
 * it, or ask again elsewhere — so the achieved density is reported separately
 * from the requested one and is never quietly set equal to it.
 */
import type { SummaryKind } from "./cache-key.ts";
import type { EnvironmentCapabilities } from "./environment.ts";
import type { ExtractionPath } from "./protocol.ts";

/** What was chosen, and what it can actually deliver. */
export interface PathChoice {
	readonly path: ExtractionPath;
	/** True when this is not the preferred path for the kind. */
	readonly degraded: boolean;
	/** The density this path can reach, at most. */
	readonly maxDensity: number;
	/** Why the preferred path was not taken, when it was not. */
	readonly reason?: string;
}

/**
 * How much coarser the seek-and-draw fallback is.
 *
 * A tenth: seeking a `<video>` and drawing to a canvas costs tens of
 * milliseconds per frame, so a filmstrip that would be one frame per second
 * becomes one per ten. Stated as a constant rather than buried in arithmetic,
 * because it is a claim about the platform that will need revisiting.
 */
export const FALLBACK_DENSITY_FACTOR = 0.1;

/** Choose the extraction path for one request, given what the environment offers. */
export function choosePath(
	kind: SummaryKind,
	requestedDensity: number,
	capabilities: EnvironmentCapabilities,
): PathChoice {
	if (kind === "waveform") {
		/* One path, so no fallback machinery is exercised and the result still
		 * names the path it took. */
		return { path: "audio-decode", degraded: false, maxDensity: requestedDensity };
	}
	if (capabilities.webCodecs)
		return { path: "webcodecs", degraded: false, maxDensity: requestedDensity };
	return {
		path: "video-seek",
		degraded: true,
		/* At least one frame: a filmstrip of zero images is not a degraded
		 * filmstrip, it is a missing one, and the item has a separate state for
		 * that. */
		maxDensity: Math.max(requestedDensity * FALLBACK_DENSITY_FACTOR, DENSITY_FLOOR),
		reason:
			"@maleo/vui: WebCodecs is unavailable, so frames are extracted by seeking and drawing at reduced density",
	};
}

/** The coarsest a filmstrip may be and still be a filmstrip. */
export const DENSITY_FLOOR = 0.1;

/**
 * Split a source range into decode ranges.
 *
 * Ranges rather than whole assets, so peak memory is a function of the range
 * being decoded and not of how long the asset is. A ten-minute track decoded
 * whole is hundreds of megabytes of samples for a summary that is a few
 * thousand numbers.
 */
export function decodeRanges(
	sourceStart: number,
	sourceEnd: number,
	ticksPerRange: number,
): Array<{ start: number; end: number }> {
	const ranges: Array<{ start: number; end: number }> = [];
	if (ticksPerRange <= 0 || sourceEnd <= sourceStart) return ranges;
	for (let start = sourceStart; start < sourceEnd; start += ticksPerRange) {
		ranges.push({ start, end: Math.min(start + ticksPerRange, sourceEnd) });
	}
	return ranges;
}

/** Reduce a range of samples to one value per bucket. */
export function decimate(samples: readonly number[], buckets: number): number[] {
	if (buckets <= 0 || samples.length === 0) return [];
	const output: number[] = [];
	const per = samples.length / buckets;
	for (let bucket = 0; bucket < buckets; bucket += 1) {
		const from = Math.floor(bucket * per);
		const to = Math.max(from + 1, Math.floor((bucket + 1) * per));
		let peak = 0;
		/* The peak rather than the mean: a waveform drawn from means is a flat
		 * band that says nothing about where the loud parts are, which is the one
		 * question a person asks a waveform. */
		for (let index = from; index < to && index < samples.length; index += 1) {
			const magnitude = Math.abs(samples[index]!);
			if (magnitude > peak) peak = magnitude;
		}
		output.push(peak);
	}
	return output;
}
