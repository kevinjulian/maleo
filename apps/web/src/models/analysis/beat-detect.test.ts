import { describe, expect, test } from "vite-plus/test";
import { detectBeats, estimateBpm } from "./beat-detect.ts";

const RATE = 44100;

/** Synthetic track: silence with short loud bursts at the given times. */
function clickTrack(durationSec: number, clickTimes: number[]): Float32Array {
	const samples = new Float32Array(Math.floor(durationSec * RATE));
	for (const t of clickTimes) {
		const start = Math.floor(t * RATE);
		for (let i = 0; i < Math.floor(RATE * 0.03); i++) {
			if (start + i < samples.length) samples[start + i] = Math.sin(i * 0.3) * 0.9;
		}
	}
	return samples;
}

describe("detectBeats", () => {
	test("finds clicks at 0.5s spacing (120bpm)", () => {
		const clicks = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5];
		const beats = detectBeats(clickTrack(4, clicks), RATE);
		expect(beats.length).toBeGreaterThanOrEqual(6);
		// Every click should have a detected beat within 80ms.
		for (const c of clicks) {
			expect(beats.some((b) => Math.abs(b - c) < 0.08)).toBe(true);
		}
	});

	test("silence yields no beats", () => {
		expect(detectBeats(new Float32Array(RATE * 2), RATE)).toEqual([]);
	});

	test("empty input yields no beats", () => {
		expect(detectBeats(new Float32Array(0), RATE)).toEqual([]);
	});

	test("respects minimum beat spacing", () => {
		// Clicks 100ms apart should collapse (min spacing 240ms).
		const beats = detectBeats(clickTrack(2, [0.5, 0.6, 0.7, 0.8]), RATE);
		for (let i = 1; i < beats.length; i++) {
			expect(beats[i]! - beats[i - 1]!).toBeGreaterThanOrEqual(0.2);
		}
	});
});

describe("estimateBpm", () => {
	test("120bpm click track estimates ~120", () => {
		const beats = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5];
		const bpm = estimateBpm(beats);
		expect(bpm).not.toBeNull();
		expect(Math.abs((bpm ?? 0) - 120)).toBeLessThanOrEqual(4);
	});

	test("too few beats returns null", () => {
		expect(estimateBpm([0.5, 1.0])).toBeNull();
	});
});
