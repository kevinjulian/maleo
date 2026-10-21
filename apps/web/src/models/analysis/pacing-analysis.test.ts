import { describe, expect, test } from "vite-plus/test";
import {
	densityPerSecond,
	lintPacing,
	retentionCurve,
	type PacingInputs,
} from "./pacing-analysis.ts";

const empty = (totalSec: number): PacingInputs => ({
	totalSec,
	scenes: [],
	captionWords: [],
	overlays: [],
	audioHits: [],
	effects: [],
});

describe("densityPerSecond", () => {
	test("empty timeline is all zeros", () => {
		expect(densityPerSecond(empty(3))).toEqual([0, 0, 0]);
	});

	test("cuts, overlay entrances, and audio hits spike their second", () => {
		const density = densityPerSecond({
			...empty(4),
			scenes: [
				{ start: 0, dur: 2, move: "Static" },
				{ start: 2, dur: 2, move: "Slow Zoom In" },
			],
			overlays: [{ start: 1, dur: 2 }],
			audioHits: [{ start: 3, dur: 0.5 }],
		});
		expect(density[0]).toBe(0); // scene at 0 is not a cut, static move
		expect(density[1]).toBeGreaterThan(0.9); // overlay entrance
		expect(density[2]).toBeGreaterThan(1.5); // cut + motion + overlay present
		expect(density[3]).toBeGreaterThan(1); // audio hit + motion
	});
});

describe("retentionCurve", () => {
	test("dense timeline retains more than dead timeline", () => {
		const dead = retentionCurve([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		const dense = retentionCurve([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
		expect(dense[9]!).toBeGreaterThan(dead[9]!);
		expect(dead[9]!).toBeLessThan(0.75);
		expect(dense[9]!).toBeGreaterThan(0.9);
	});

	test("monotonically non-increasing", () => {
		const curve = retentionCurve([1, 3, 0, 2, 0]);
		for (let i = 1; i < curve.length; i++) expect(curve[i]!).toBeLessThanOrEqual(curve[i - 1]!);
	});

	test("sustained overload retains less than balanced pacing", () => {
		const balanced = retentionCurve([2.2, 2.2, 2.2, 2.2, 2.2]);
		const overloaded = retentionCurve([8, 8, 8, 8, 8]);
		expect(overloaded.at(-1)!).toBeLessThan(balanced.at(-1)!);
	});
});

describe("lintPacing", () => {
	test("flags sustained viewer overload", () => {
		const findings = lintPacing({
			...empty(3),
			scenes: [
				{ start: 0, dur: 3, move: "Slow Zoom In" },
				{ start: 1, dur: 2, move: "Slow Zoom In" },
			],
			overlays: [
				{ start: 0, dur: 3 },
				{ start: 0, dur: 3 },
				{ start: 1, dur: 2 },
			],
			audioHits: [
				{ start: 0, dur: 0.5 },
				{ start: 1, dur: 0.5 },
			],
			effects: [
				{ start: 0, dur: 0.4 },
				{ start: 1, dur: 0.4 },
			],
		});
		expect(
			findings.some((finding) => finding.code === "viewer_overload" && finding.severity === "high"),
		).toBe(true);
	});
	test("flags weak hook on an empty opening", () => {
		const findings = lintPacing({ ...empty(10), scenes: [{ start: 0, dur: 10, move: "Static" }] });
		expect(findings.some((f) => f.code === "weak_hook" && f.severity === "high")).toBe(true);
	});

	test("flags long static scene and dead zone", () => {
		const findings = lintPacing({ ...empty(8), scenes: [{ start: 0, dur: 8, move: "Static" }] });
		expect(findings.some((f) => f.code === "static_scene")).toBe(true);
		expect(findings.some((f) => f.code === "dead_zone")).toBe(true);
	});

	test("busy timeline with a strong hook produces no high findings", () => {
		const findings = lintPacing({
			...empty(6),
			scenes: [
				{ start: 0, dur: 2, move: "Whip Pan" },
				{ start: 2, dur: 2, move: "Slow Zoom In" },
				{ start: 4, dur: 2, move: "Slow Zoom Out" },
			],
			overlays: [
				{ start: 0.2, dur: 2 },
				{ start: 2.5, dur: 2 },
				{ start: 4.5, dur: 1.5 },
			],
			captionWords: Array.from({ length: 18 }, (_, i) => ({
				startSec: i / 3,
				endSec: i / 3 + 0.3,
			})),
		});
		expect(findings.filter((f) => f.severity === "high")).toEqual([]);
	});

	test("flags caption gaps over 1.5s", () => {
		const findings = lintPacing({
			...empty(8),
			captionWords: [
				{ startSec: 0, endSec: 0.4 },
				{ startSec: 3.0, endSec: 3.4 },
			],
		});
		expect(
			findings.some((f) => f.code === "caption_gap" && f.startSec === 0.4 && f.endSec === 3.0),
		).toBe(true);
	});
});
