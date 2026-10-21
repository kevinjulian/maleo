import { describe, expect, test } from "vite-plus/test";
import {
	addKeyframe,
	moveKeyframe,
	removeKeyframe,
	seedMotion,
	sortKeyframes,
	updateKeyframe,
} from "./motion-editor-model.ts";
import type { CustomMotion } from "@maleo/shared";

const base = (): CustomMotion => ({
	keyframes: [
		{ t: 0, scale: 1, x: 0, y: 0, easing: "linear" },
		{ t: 1, scale: 1.2, x: 10, y: -10, easing: "linear" },
	],
});

describe("seedMotion", () => {
	test("derives a 2+ keyframe motion from a preset label", () => {
		const m = seedMotion("Slow Zoom In");
		expect(m.keyframes.length).toBeGreaterThanOrEqual(2);
		expect(m.keyframes[0].t).toBe(0);
		expect(m.keyframes[m.keyframes.length - 1].t).toBe(1);
	});

	test("unknown label still yields a valid motion", () => {
		expect(seedMotion("nope").keyframes.length).toBeGreaterThanOrEqual(2);
	});
});

describe("addKeyframe", () => {
	test("inserts an interpolated keyframe, keeps sort order", () => {
		const { motion, index } = addKeyframe(base(), 0.5);
		expect(motion.keyframes).toHaveLength(3);
		expect(motion.keyframes[index].t).toBeCloseTo(0.5, 6);
		// midpoint of x 0->10
		expect(motion.keyframes[index].x).toBeCloseTo(5, 6);
		expect(motion.keyframes.map((k) => k.t)).toEqual(
			motion.keyframes.map((k) => k.t).sort((a, b) => a - b),
		);
	});

	test("clamps insertion inside the timeline", () => {
		expect(addKeyframe(base(), 0).motion.keyframes[1].t).toBeGreaterThan(0);
		expect(addKeyframe(base(), 5).motion.keyframes[1].t).toBeLessThan(1);
	});

	test("does not mutate input", () => {
		const m = base();
		addKeyframe(m, 0.5);
		expect(m.keyframes).toHaveLength(2);
	});
});

describe("removeKeyframe", () => {
	test("removes an interior keyframe", () => {
		const three = addKeyframe(base(), 0.5).motion;
		expect(removeKeyframe(three, 1).keyframes).toHaveLength(2);
	});

	test("refuses to drop below 2 keyframes", () => {
		expect(removeKeyframe(base(), 0).keyframes).toHaveLength(2);
	});

	test("out-of-range index is a no-op", () => {
		const three = addKeyframe(base(), 0.5).motion;
		expect(removeKeyframe(three, 9)).toBe(three);
	});
});

describe("updateKeyframe", () => {
	test("patches fields immutably", () => {
		const m = base();
		const next = updateKeyframe(m, 1, { scale: 2, easing: "bezier" });
		expect(next.keyframes[1].scale).toBe(2);
		expect(next.keyframes[1].easing).toBe("bezier");
		expect(m.keyframes[1].scale).toBe(1.2); // original untouched
	});
});

describe("moveKeyframe", () => {
	test("pins endpoints", () => {
		const m = base();
		expect(moveKeyframe(m, 0, 0.4).motion.keyframes[0].t).toBe(0);
		expect(moveKeyframe(m, 1, 0.4).motion.keyframes[1].t).toBe(1);
	});

	test("constrains interior between neighbours", () => {
		const three = addKeyframe(base(), 0.5).motion;
		// try to push middle past the end -> clamped below 1
		const moved = moveKeyframe(three, 1, 9).motion;
		expect(moved.keyframes[1].t).toBeLessThan(1);
		expect(moved.keyframes[1].t).toBeGreaterThan(0);
	});
});

describe("sortKeyframes", () => {
	test("orders by t without mutating", () => {
		const kfs = [
			{ t: 1, scale: 1, x: 0, y: 0 },
			{ t: 0, scale: 1, x: 0, y: 0 },
		];
		expect(sortKeyframes(kfs).map((k) => k.t)).toEqual([0, 1]);
		expect(kfs[0].t).toBe(1);
	});
});
