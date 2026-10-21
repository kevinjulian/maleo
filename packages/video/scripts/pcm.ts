/* Decoded audio for the render proofs: ffmpeg's mono f32le output, copied into
 * an owned Float32Array and read only through functions that take it as an
 * argument.
 *
 * Why not read the Buffer `execFileSync` returns: under load, a per-iteration
 * closure reading `pcm.readFloatLE` in prove-clip-animation returned the wrong
 * amplitude (0.0176) while a function given the same buffer returned the right
 * one (0.0604), and the decoded bytes were hash-identical to a separate decode
 * of the same output (Bun 1.3.1, 2026-10-09). The render was correct every
 * time; the measurement was not. It did not reproduce outside a full render
 * loop, so the cause inside Bun is not pinned down — this is the pattern that
 * measured correctly in every loaded run. */
import { execFileSync } from "node:child_process";

/** Mono float samples of `file` at `rate`, in memory this module owns. */
export function decodePcm(
	file: string,
	rate = 48000,
	before: readonly string[] = [],
): Float32Array {
	const bytes = execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			...before,
			"-i",
			file,
			"-vn",
			"-ac",
			"1",
			"-ar",
			String(rate),
			"-f",
			"f32le",
			"pipe:1",
		],
		{ maxBuffer: 16 * 1024 * 1024 },
	);
	// A copy, aligned for Float32Array and detached from the child-process buffer.
	return new Float32Array(new Uint8Array(bytes).buffer);
}

/** Amplitude of `frequency` over 0.1 s of samples from `time`, by single-bin DFT. */
export function amplitudeAt(
	samples: Float32Array,
	frequency: number,
	time: number,
	rate = 48000,
): number {
	let real = 0,
		imaginary = 0;
	const start = Math.floor(time * rate),
		count = rate / 10;
	for (let i = 0; i < count; i++) {
		const sample = samples[start + i] ?? 0,
			angle = (2 * Math.PI * frequency * i) / rate;
		real += sample * Math.cos(angle);
		imaginary += sample * Math.sin(angle);
	}
	return (2 * Math.hypot(real, imaginary)) / count;
}

/** The largest absolute sample in `[from, to)`, by sample index. */
export function peakOf(samples: Float32Array, from: number, to: number): number {
	let value = 0;
	for (let i = Math.max(0, from); i < Math.min(samples.length, to); i++)
		value = Math.max(value, Math.abs(samples[i]!));
	return value;
}

/** `peakOf` over `[from, to)` seconds, each bound turned into a sample index by `index`. */
export function peakSeconds(
	samples: Float32Array,
	from: number,
	to: number,
	index: (x: number) => number = Math.floor,
	rate = 48000,
): number {
	return peakOf(samples, index(from * rate), index(to * rate));
}

/** Upward zero crossings in `[from, to)`, by sample index. */
export function crossingsOf(samples: Float32Array, from: number, to: number): number {
	let crossings = 0,
		previous = 0;
	for (let i = from; i < to; i++) {
		const value = samples[i] ?? 0;
		if (previous <= 0 && value > 0) crossings++;
		previous = value;
	}
	return crossings;
}
