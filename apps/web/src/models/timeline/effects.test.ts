import { describe, expect, test } from "vite-plus/test";
import { autoPatternInterrupts, computeEffects } from "./effects.ts";

describe("computeEffects pattern interrupts", () => {
	test("flash spikes white, never black", () => {
		const fx = [{ effect: "flash" as const, start: 2, dur: 0.4 }];
		const mid = computeEffects(fx, 2.1);
		expect(mid.whiteOpacity).toBeGreaterThan(0.5);
		expect(mid.blackOpacity).toBe(0);
		expect(computeEffects(fx, 1.9).whiteOpacity).toBe(0);
		expect(computeEffects(fx, 2.5).whiteOpacity).toBe(0);
	});

	test("zoom_punch snaps scale up then returns to neutral", () => {
		const fx = [{ effect: "zoom_punch" as const, start: 1, dur: 0.5 }];
		const peak = computeEffects(fx, 1.12); // ~peak of the attack
		expect(peak.scale).toBeGreaterThan(1.1);
		const end = computeEffects(fx, 1.49);
		expect(end.scale).toBeLessThan(1.03);
		expect(computeEffects(fx, 0.9).scale).toBe(1);
	});

	test("whip_pan sweeps translate and ends near zero", () => {
		const fx = [{ effect: "whip_pan" as const, start: 0, dur: 0.4 }];
		const quarter = computeEffects(fx, 0.1); // sin(pi/2) peak
		expect(Math.abs(quarter.translateXPct)).toBeGreaterThan(8);
		const done = computeEffects(fx, 0.399);
		expect(Math.abs(done.translateXPct)).toBeLessThan(1);
	});

	test("intensity scales the deviation", () => {
		const full = computeEffects(
			[{ effect: "flash" as const, start: 0, dur: 1, intensity: 1 }],
			0.3,
		);
		const half = computeEffects(
			[{ effect: "flash" as const, start: 0, dur: 1, intensity: 0.5 }],
			0.3,
		);
		expect(half.whiteOpacity).toBeCloseTo(full.whiteOpacity / 2, 5);
	});
});

describe("autoPatternInterrupts", () => {
	test("injects every interval, skipping t=0 and the outro", () => {
		const out = autoPatternInterrupts(20, 4, [], 100);
		expect(out.map((e) => e.start)).toEqual([4, 8, 12, 16]);
		// Alternating kinds from the cycle.
		expect(out[0]!.effect).toBe("zoom_punch");
		expect(out[1]!.effect).toBe("flash");
		expect(out[2]!.effect).toBe("whip_pan");
	});

	test("skips slots that already have a nearby interrupt", () => {
		const existing = [{ effect: "flash" as const, start: 8.5 }];
		const out = autoPatternInterrupts(20, 4, existing, 100);
		expect(out.map((e) => e.start)).toEqual([4, 12, 16]);
	});

	test("ignores non-interrupt effects when checking occupancy", () => {
		const existing = [{ effect: "fade_in" as const, start: 8 }];
		const out = autoPatternInterrupts(20, 4, existing, 100);
		expect(out.map((e) => e.start)).toContain(8);
	});

	test("short video yields nothing", () => {
		expect(autoPatternInterrupts(3, 4, [], 100)).toEqual([]);
	});
});
