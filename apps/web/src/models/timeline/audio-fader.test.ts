import { describe, expect, test } from "vite-plus/test";
import {
	dbFromGain,
	FADER_RANGE_DB,
	faderFromGain,
	formatGainDb,
	gainFromFader,
} from "./audio-fader.ts";

describe("audio fader", () => {
	test("the top is unity and the bottom is silence", () => {
		expect(gainFromFader(100)).toBe(1);
		expect(gainFromFader(0)).toBe(0);
	});

	test("equal steps are equal decibels, which is the whole point", () => {
		const step = (a: number, b: number): number =>
			dbFromGain(gainFromFader(b)) - dbFromGain(gainFromFader(a));
		expect(step(90, 100)).toBeCloseTo(step(40, 50), 5);
		expect(step(90, 100)).toBeCloseTo(FADER_RANGE_DB / 10, 5);
	});

	test("a stored amplitude round-trips through the control", () => {
		for (const gain of [1, 0.5, 0.25, 0.1, 0.01]) {
			expect(gainFromFader(faderFromGain(gain))).toBeCloseTo(gain, 6);
		}
	});

	test("silence round-trips as the bottom of the fader", () => {
		expect(faderFromGain(0)).toBe(0);
		expect(gainFromFader(faderFromGain(0))).toBe(0);
	});

	test("half amplitude is about six decibels down, wherever it sits", () => {
		expect(dbFromGain(0.5)).toBeCloseTo(-6.02, 2);
		expect(faderFromGain(0.5)).toBeCloseTo(100 - 6.02 * (100 / FADER_RANGE_DB), 2);
	});

	test("positions outside the fader are clamped rather than extrapolated", () => {
		expect(gainFromFader(-10)).toBe(0);
		expect(gainFromFader(400)).toBe(1);
		expect(faderFromGain(4)).toBe(100);
	});

	test("the readout says what the level is", () => {
		expect(formatGainDb(1)).toBe("0.0 dB");
		expect(formatGainDb(0)).toBe("muted");
		expect(formatGainDb(0.5)).toBe("-6.0 dB");
	});
});
