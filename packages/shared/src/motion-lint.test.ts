import { describe, expect, it } from "vite-plus/test";
import type { CompositionConfig, CompositionOverlayJson } from "./composition-schema.ts";
import { compileMotion } from "./motion-compile.ts";
import { MOTION_EXAMPLES } from "./motion-examples.ts";
import type { MotionIntent } from "./motion-intent.ts";
import { lintMotion } from "./motion-lint.ts";

type Keys = Array<{ t: number; v: number }>;
const shape = (
	relStart: number,
	dur: number,
	tracks: Record<string, Keys>,
): CompositionOverlayJson => ({
	relStart,
	dur,
	preset: "shape-rect",
	content: "",
	layout: { xPct: 10, yPct: 10, widthPct: 30, heightPct: 10, fit: "contain" },
	anim: {
		tracks: Object.fromEntries(
			Object.entries(tracks).map(([k, keys]) => [
				k,
				keys.map((key) => ({ ...key, easing: "linear" as const })),
			]),
		),
	},
});
const config = (overlays: CompositionOverlayJson[], spanSec = 3): CompositionConfig => ({
	schemaVersion: 1,
	overlays,
	spanSec,
});
const codes = (c: CompositionConfig) => lintMotion(c).map((f) => f.code);

describe("lintMotion", () => {
	it("finds nothing in the reference examples", () => {
		for (const e of MOTION_EXAMPLES)
			expect(lintMotion(compileMotion(e.intent, { spanSec: e.spanSec }))).toEqual([]);
	});

	it("reports two large moves starting on the same frame", () => {
		const grow = {
			width: [
				{ t: 0, v: 0 },
				{ t: 0.2, v: 30 },
				{ t: 1, v: 30 },
			],
		};
		const findings = lintMotion(config([shape(0.5, 2, grow), shape(0.5, 2, grow)]));
		expect(findings).toContainEqual(
			expect.objectContaining({ code: "simultaneous_large_moves", layer: 1, atSec: 0.5 }),
		);
	});

	it("reports text that moves before it can be read", () => {
		const base = MOTION_EXAMPLES.find((e) => e.presentation === "headline")!;
		const intent: MotionIntent = {
			layers: [
				{
					...base.intent.layers[1]!,
					content: "one two three four five six",
					exit: { state: "out", to: "up" },
				},
			],
			states: [
				{ id: "in", atSec: 0, changes: [] },
				{ id: "out", atSec: 1.25, changes: [] },
			],
		};
		const findings = lintMotion(compileMotion(intent, { spanSec: 3 }));
		const reading = findings.find((f) => f.code === "reading_time")!;
		expect(reading).toMatchObject({ layer: 0 });
		expect(reading.atSec).toBeCloseTo(1.25, 1);
	});

	it("reports every layer entering on the same frame", () => {
		const fade = {
			opacity: [
				{ t: 0, v: 0 },
				{ t: 0.2, v: 1 },
				{ t: 1, v: 1 },
			],
		};
		expect(codes(config([shape(0.4, 2, fade), shape(0.4, 2, fade)]))).toContain(
			"same_frame_entrance",
		);
	});

	it("reports an exit longer than the entrance", () => {
		const opacity = [
			{ t: 0, v: 0 },
			{ t: 0.05, v: 1 },
			{ t: 0.6, v: 1 },
			{ t: 1, v: 0 },
		];
		expect(codes(config([shape(0, 2, { opacity })]))).toContain("exit_longer_than_entrance");
	});

	it("reports a layer resting outside the frame", () => {
		const base = MOTION_EXAMPLES.find((e) => e.presentation === "headline")!;
		const intent: MotionIntent = {
			...base.intent,
			layers: base.intent.layers.map((l) =>
				l.id === "bar" ? { ...l, box: { ...l.box, xPct: 90, widthPct: 30 } } : l,
			),
		};
		expect(lintMotion(compileMotion(intent, { spanSec: 2.4 }))).toContainEqual(
			expect.objectContaining({ code: "off_frame_at_rest", layer: 0 }),
		);
	});
});
