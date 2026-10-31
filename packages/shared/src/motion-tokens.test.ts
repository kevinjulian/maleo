import { describe, expect, it } from "vite-plus/test";
import { MOTION_CLASSES, MOTION_RULES, MOTION_SPRINGS, readingTimeSec } from "./motion-tokens.ts";

describe("motion tokens", () => {
	it("keeps the published motion rules inside their spec ranges", () => {
		expect(MOTION_RULES.cascadeGapSec).toBeGreaterThanOrEqual(0.1);
		expect(MOTION_RULES.cascadeGapSec).toBeLessThanOrEqual(0.2);
		expect(MOTION_RULES.secondaryOffsetRatio).toBeGreaterThanOrEqual(0.5);
		expect(MOTION_RULES.secondaryOffsetRatio).toBeLessThanOrEqual(0.7);
		expect(MOTION_RULES.ambientAmplitudePct).toBeLessThanOrEqual(5);
		expect(MOTION_RULES.exitFactor).toBeLessThanOrEqual(1);
		expect(MOTION_RULES.textAfterContainer).toBeGreaterThanOrEqual(0.5);
	});

	it("defines a spring for every class", () => {
		for (const id of MOTION_CLASSES) {
			const spring = MOTION_SPRINGS[id];
			expect(spring.zeta).toBeGreaterThan(0);
			expect(spring.zeta).toBeLessThanOrEqual(1);
			expect(spring.settleSec).toBeGreaterThan(0);
		}
	});

	it("gives short text at least the minimum hold and long text more", () => {
		expect(readingTimeSec("Ship")).toBe(1);
		expect(readingTimeSec("one two three four five six")).toBe(2);
		expect(readingTimeSec("   ")).toBe(1);
	});
});
