import { describe, expect, test } from "vite-plus/test";
import { barCount, displayPeaks, MIN_DISPLAY_BARS, PX_PER_BAR } from "./waveform-bars.ts";

const peaks = (n: number, f: (i: number) => number = (i) => i / n): number[] =>
	Array.from({ length: n }, (_, i) => f(i));

describe("waveform bars", () => {
	test("an unknown width falls back to a fixed count", () => {
		expect(barCount(256)).toBe(64);
		expect(barCount(20)).toBe(20);
	});

	test("bar count follows the rendered width", () => {
		expect(barCount(256, 400)).toBe(400 / PX_PER_BAR);
	});

	test("a very narrow clip still gets the readable minimum", () => {
		expect(barCount(256, 8)).toBe(MIN_DISPLAY_BARS);
	});

	test("bar count never exceeds what was decoded", () => {
		expect(barCount(32, 4000)).toBe(32);
	});

	test("peaks are returned as-is when there is room for all of them", () => {
		const p = peaks(20);
		expect(displayPeaks(p, 4000)).toBe(p);
	});

	test("downsampling keeps the loudest sample in each bucket", () => {
		// Four peaks into (at most) two buckets: each bar is the max of its half.
		const p = [0.1, 0.9, 0.2, 0.3];
		expect(displayPeaks(p, 2 * PX_PER_BAR).length).toBe(MIN_DISPLAY_BARS > 2 ? 4 : 2);
		const wide = displayPeaks(
			peaks(64, (i) => (i === 10 ? 1 : 0)),
			MIN_DISPLAY_BARS * PX_PER_BAR,
		);
		expect(wide.length).toBe(MIN_DISPLAY_BARS);
		expect(Math.max(...wide)).toBe(1);
	});
});
