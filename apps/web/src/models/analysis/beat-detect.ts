/* Music beat detection for the timeline beat grid. Energy-flux onset detection:
 * bucket samples into short windows, take the positive energy delta, and pick
 * peaks above an adaptive (rolling mean + deviation) threshold with a minimum
 * spacing. Pure math is exported separately from the browser decode wrapper so
 * it can be unit-tested with synthetic signals.
 *
 * The browser wrapper streams the file through MediaBunny and folds samples
 * into energy windows as chunks arrive (constant memory — the full PCM never
 * exists at once); Web Audio full decode remains the fallback. */
import { ALL_FORMATS, AudioBufferSink, Input, UrlSource } from "mediabunny";
import { mediaCredentials } from "@models/core/cc-helpers.ts";

const WINDOW_SEC = 0.05;
const MIN_BEAT_SPACING_SEC = 0.24;
const ROLLING_WINDOWS = 20;

// Incremental RMS-energy accumulator: feed sample chunks in order, windows of
// `windowSize` samples fall out; partial windows carry across chunk boundaries.
class EnergyWindows {
	readonly windowSize: number;
	readonly energy: number[] = [];
	private sumSquares = 0;
	private filled = 0;

	constructor(sampleRate: number) {
		this.windowSize = Math.max(64, Math.floor(sampleRate * WINDOW_SEC));
	}

	push(samples: Float32Array): void {
		for (let i = 0; i < samples.length; i++) {
			const v = samples[i]!;
			this.sumSquares += v * v;
			if (++this.filled === this.windowSize) {
				this.energy.push(Math.sqrt(this.sumSquares / this.windowSize));
				this.sumSquares = 0;
				this.filled = 0;
			}
		}
	}
}

// Peak-pick beats from an RMS-energy window series.
function beatsFromEnergy(energy: number[], windowSize: number, sampleRate: number): number[] {
	if (energy.length < 4) return [];
	// Onset envelope: positive energy delta only (attacks, not decays).
	const flux = energy.map((e, i) => (i === 0 ? 0 : Math.max(0, e - energy[i - 1]!)));

	// Adaptive threshold: rolling mean + 1.5x rolling mean absolute deviation.
	const beats: number[] = [];
	let lastBeat = -Infinity;
	for (let i = 1; i < flux.length - 1; i++) {
		const lo = Math.max(0, i - ROLLING_WINDOWS);
		const local = flux.slice(lo, i + 1);
		const mean = local.reduce((a, b) => a + b, 0) / local.length;
		const dev = local.reduce((a, b) => a + Math.abs(b - mean), 0) / local.length;
		const threshold = mean + 1.5 * dev + 1e-4;
		const isPeak = flux[i]! > threshold && flux[i]! >= flux[i - 1]! && flux[i]! >= flux[i + 1]!;
		if (!isPeak) continue;
		const t = (i * windowSize) / sampleRate;
		if (t - lastBeat < MIN_BEAT_SPACING_SEC) continue;
		beats.push(Math.round(t * 1000) / 1000);
		lastBeat = t;
	}
	return beats;
}

/** Detect onset times (seconds) from mono PCM samples. */
export function detectBeats(samples: Float32Array, sampleRate: number): number[] {
	if (!samples.length || sampleRate <= 0) return [];
	const acc = new EnergyWindows(sampleRate);
	acc.push(samples);
	return beatsFromEnergy(acc.energy, acc.windowSize, sampleRate);
}

/** Median inter-beat interval → BPM estimate. Null when too few beats. */
export function estimateBpm(beats: number[]): number | null {
	if (beats.length < 4) return null;
	const intervals = beats
		.slice(1)
		.map((b, i) => b - beats[i]!)
		.filter((d) => d > 0.2 && d < 2);
	if (intervals.length < 3) return null;
	const sorted = [...intervals].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)]!;
	return Math.round(60 / median);
}

// ── Browser wrapper: decode once per url, cache beats ──

const beatCache = new Map<string, number[]>();
const beatPending = new Map<string, Promise<number[]>>();

// Streaming path: fold decoded chunks into energy windows as they arrive.
async function beatsStreaming(url: string): Promise<number[]> {
	const input = new Input({
		formats: ALL_FORMATS,
		source: new UrlSource(url, {
			requestInit: { credentials: mediaCredentials(url) },
			getRetryDelay: (attempts) => (attempts < 1 ? 0.2 : null),
		}),
	});
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error("no audio track");
		const sampleRate = await track.getSampleRate();
		let acc: EnergyWindows | null = sampleRate > 0 ? new EnergyWindows(sampleRate) : null;
		let rate = sampleRate > 0 ? sampleRate : 0;
		const sink = new AudioBufferSink(track);
		for await (const { buffer } of sink.buffers()) {
			if (!acc) {
				rate = buffer.sampleRate;
				acc = new EnergyWindows(rate);
			}
			acc.push(buffer.getChannelData(0));
		}
		if (!acc) return [];
		return beatsFromEnergy(acc.energy, acc.windowSize, rate);
	} finally {
		input.dispose();
	}
}

export async function beatsForUrl(url: string): Promise<number[]> {
	const cached = beatCache.get(url);
	if (cached) return cached;
	const inflight = beatPending.get(url);
	if (inflight) return inflight;
	const p = (async () => {
		try {
			const beats = await beatsStreaming(url);
			beatCache.set(url, beats);
			return beats;
		} catch {
			// Fall through to full Web Audio decode (format/browser not covered).
		}
		const buf = await (await fetch(url, { credentials: mediaCredentials(url) })).arrayBuffer();
		const Ctx = window.AudioContext || window.webkitAudioContext;
		const ctx = new Ctx();
		try {
			const audio = await ctx.decodeAudioData(buf);
			const beats = detectBeats(audio.getChannelData(0), audio.sampleRate);
			beatCache.set(url, beats);
			return beats;
		} finally {
			void ctx.close();
		}
	})();
	beatPending.set(url, p);
	try {
		return await p;
	} finally {
		beatPending.delete(url);
	}
}
