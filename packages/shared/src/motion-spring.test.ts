import { describe, expect, it } from "vite-plus/test";
import { reduceSamples, sampleCurve, springProgress, type MotionSample } from "./motion-spring.ts";
import { MOTION_SPRINGS } from "./motion-tokens.ts";

const linearAt = (keys: readonly MotionSample[], t: number): number => {
	for (let i = 1; i < keys.length; i++) {
		const a = keys[i - 1]!,
			b = keys[i]!;
		if (t <= b.t) return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
	}
	return keys[keys.length - 1]!.v;
};

describe("springProgress", () => {
	it("starts at 0 and lands exactly on 1 at the settle time", () => {
		for (const spring of Object.values(MOTION_SPRINGS)) {
			expect(springProgress(spring, 0)).toBe(0);
			expect(springProgress(spring, spring.settleSec)).toBe(1);
			expect(springProgress(spring, spring.settleSec + 1)).toBe(1);
			expect(springProgress(spring, -1)).toBe(0);
		}
	});

	it("never overshoots when critically damped, and overshoots when it bounces", () => {
		const peak = (spring: (typeof MOTION_SPRINGS)[keyof typeof MOTION_SPRINGS]) =>
			Math.max(
				...sampleCurve((t) => springProgress(spring, t), 0, spring.settleSec, 240).map((s) => s.v),
			);
		expect(peak(MOTION_SPRINGS.headline)).toBeLessThanOrEqual(1);
		expect(peak(MOTION_SPRINGS.accent)).toBeGreaterThan(1.03);
	});

	it("is a pure function of time", () => {
		const spring = MOTION_SPRINGS.indicator;
		expect(springProgress(spring, 0.137)).toBe(springProgress(spring, 0.137));
	});
});

describe("reduceSamples", () => {
	it("keeps the reduced line within tolerance of every dense sample", () => {
		const spring = MOTION_SPRINGS.accent;
		const dense = sampleCurve((t) => 40 * springProgress(spring, t), 0, spring.settleSec, 60);
		const tolerance = 0.005 * 40;
		const reduced = reduceSamples(dense, tolerance);
		expect(reduced.length).toBeLessThan(dense.length);
		expect(reduced.length).toBeGreaterThanOrEqual(3);
		for (const sample of dense)
			expect(Math.abs(linearAt(reduced, sample.t) - sample.v)).toBeLessThanOrEqual(
				tolerance + 1e-9,
			);
		expect(reduced[0]).toEqual(dense[0]);
		expect(reduced[reduced.length - 1]).toEqual(dense[dense.length - 1]);
	});

	it("collapses a hold to its two ends", () => {
		const dense = sampleCurve(() => 5, 0, 2, 60);
		expect(reduceSamples(dense, 0.01)).toEqual([dense[0], dense[dense.length - 1]]);
	});

	it("gives equal keys for equal input", () => {
		const make = () =>
			reduceSamples(
				sampleCurve((t) => springProgress(MOTION_SPRINGS.label, t), 0, 0.35, 60),
				0.005,
			);
		expect(make()).toEqual(make());
	});
});

describe("sampleCurve", () => {
	it("includes both ends exactly", () => {
		const samples = sampleCurve((t) => t, 0.1, 0.25, 60);
		expect(samples[0]).toEqual({ t: 0.1, v: 0.1 });
		expect(samples[samples.length - 1]).toEqual({ t: 0.25, v: 0.25 });
	});
});
