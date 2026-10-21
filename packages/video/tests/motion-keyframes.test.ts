import { describe, expect, test } from "vite-plus/test";
import {
	evalColorTrack,
	evalMotion,
	evalTrack,
	fromLegacy,
	presetKeyframes,
	resolveMotionKeyframes,
	type KeyframeMotion,
	type ValueKeyframe,
} from "../src/lib/motion-keyframes";
import { MOTION_PRESETS } from "../src/lib/motion-presets";
import { overlayAnimSchema } from "../src/schema";

const linear2 = (): KeyframeMotion => ({
	keyframes: [
		{ t: 0, scale: 1, x: 0, y: 0, easing: "linear" },
		{ t: 1, scale: 2, x: 100, y: -50, easing: "linear" },
	],
});

describe("evalMotion — endpoints", () => {
	test("empty keyframes returns neutral", () => {
		expect(evalMotion({ keyframes: [] }, 0.5)).toEqual({ scale: 1, x: 0, y: 0, rotate: 0 });
	});

	test("single keyframe holds its value", () => {
		const m: KeyframeMotion = { keyframes: [{ t: 0, scale: 1.3, x: 5, y: 6, rotate: 9 }] };
		expect(evalMotion(m, 0.7)).toEqual({ scale: 1.3, x: 5, y: 6, rotate: 9 });
	});

	test("progress 0 returns first keyframe", () => {
		expect(evalMotion(linear2(), 0)).toEqual({ scale: 1, x: 0, y: 0, rotate: 0 });
	});

	test("progress 1 returns last keyframe", () => {
		expect(evalMotion(linear2(), 1)).toEqual({ scale: 2, x: 100, y: -50, rotate: 0 });
	});

	test("clamps progress below 0 and above 1", () => {
		expect(evalMotion(linear2(), -3)).toEqual({ scale: 1, x: 0, y: 0, rotate: 0 });
		expect(evalMotion(linear2(), 5)).toEqual({ scale: 2, x: 100, y: -50, rotate: 0 });
	});
});

describe("evalMotion — linear interpolation", () => {
	test("midpoint is arithmetic mean", () => {
		const s = evalMotion(linear2(), 0.5);
		expect(s.scale).toBeCloseTo(1.5, 6);
		expect(s.x).toBeCloseTo(50, 6);
		expect(s.y).toBeCloseTo(-25, 6);
	});

	test("quarter point", () => {
		const s = evalMotion(linear2(), 0.25);
		expect(s.x).toBeCloseTo(25, 6);
	});
});

describe("evalMotion — easing", () => {
	const eased = (easing: "in" | "out" | "in-out" | "bezier"): KeyframeMotion => ({
		keyframes: [
			{ t: 0, scale: 0, x: 0, y: 0 },
			{ t: 1, scale: 1, x: 0, y: 0, easing },
		],
	});

	test("ease-in lags linear at midpoint", () => {
		expect(evalMotion(eased("in"), 0.5).scale).toBeCloseTo(0.25, 6);
	});

	test("ease-out leads linear at midpoint", () => {
		expect(evalMotion(eased("out"), 0.5).scale).toBeCloseTo(0.75, 6);
	});

	test("ease-in-out symmetric around 0.5", () => {
		const lo = evalMotion(eased("in-out"), 0.25).scale;
		const hi = evalMotion(eased("in-out"), 0.75).scale;
		expect(lo + hi).toBeCloseTo(1, 5);
	});

	test("bezier stays within [0,1] and monotonic", () => {
		const a = evalMotion(eased("bezier"), 0.3).scale;
		const b = evalMotion(eased("bezier"), 0.6).scale;
		expect(a).toBeGreaterThanOrEqual(0);
		expect(b).toBeLessThanOrEqual(1);
		expect(b).toBeGreaterThanOrEqual(a);
	});
});

describe("evalMotion — multi-segment", () => {
	const three: KeyframeMotion = {
		keyframes: [
			{ t: 0, scale: 1, x: 0, y: 0 },
			{ t: 0.5, scale: 1, x: 100, y: 0, easing: "linear" },
			{ t: 1, scale: 2, x: 100, y: 0, easing: "linear" },
		],
	};

	test("first segment moves x, holds scale", () => {
		const s = evalMotion(three, 0.25);
		expect(s.x).toBeCloseTo(50, 6);
		expect(s.scale).toBeCloseTo(1, 6);
	});

	test("second segment scales, holds x", () => {
		const s = evalMotion(three, 0.75);
		expect(s.scale).toBeCloseTo(1.5, 6);
		expect(s.x).toBeCloseTo(100, 6);
	});

	test("exact middle keyframe", () => {
		const s = evalMotion(three, 0.5);
		expect(s.x).toBeCloseTo(100, 6);
		expect(s.scale).toBeCloseTo(1, 6);
	});
});

describe("legacy conversion", () => {
	test("fromLegacy produces 2 linear keyframes matching from/to", () => {
		const m = fromLegacy({ from: { scale: 1, x: -5, y: 3 }, to: { scale: 1.2, x: 5, y: -3 } });
		expect(m.keyframes).toHaveLength(2);
		expect(evalMotion(m, 0)).toEqual({ scale: 1, x: -5, y: 3, rotate: 0 });
		expect(evalMotion(m, 1)).toEqual({ scale: 1.2, x: 5, y: -3, rotate: 0 });
	});

	test("presetKeyframes matches the preset endpoints", () => {
		const id = "slow-zoom-in";
		const m = presetKeyframes(id);
		expect(evalMotion(m, 0).scale).toBeCloseTo(MOTION_PRESETS[id].from.scale, 6);
		expect(evalMotion(m, 1).scale).toBeCloseTo(MOTION_PRESETS[id].to.scale, 6);
	});

	test("resolveMotionKeyframes falls back to ken-burns for unknown label", () => {
		const m = resolveMotionKeyframes("does-not-exist");
		expect(evalMotion(m, 1).scale).toBeCloseTo(MOTION_PRESETS["ken-burns"].to.scale, 6);
	});

	test("legacy conversion is byte-identical to old interpolate at samples", () => {
		// Old renderer: linear interpolate frame->[from,to]. Verify eval matches for
		// each built-in preset at a few progress points.
		/* `Object.keys` widened back to the table's own key type. `keysOf` in
		 * `@maleo/shared` does exactly this, but this package declares that it
		 * cannot import shared — see `src/exports.ts` — and this test was the one
		 * place violating that, which is also why the suite could not resolve its
		 * imports and never ran in CI. */
		const presetIds = Object.keys(MOTION_PRESETS) as Array<keyof typeof MOTION_PRESETS>;
		for (const id of presetIds) {
			const p = MOTION_PRESETS[id];
			const m = presetKeyframes(id);
			for (const prog of [0, 0.33, 0.5, 0.8, 1]) {
				const s = evalMotion(m, prog);
				expect(s.scale).toBeCloseTo(p.from.scale + (p.to.scale - p.from.scale) * prog, 6);
				expect(s.x).toBeCloseTo(p.from.x + (p.to.x - p.from.x) * prog, 6);
				expect(s.y).toBeCloseTo(p.from.y + (p.to.y - p.from.y) * prog, 6);
			}
		}
	});
});

describe("evalTrack — single-value tracks", () => {
	const track: ValueKeyframe[] = [
		{ t: 0, v: 0 },
		{ t: 0.5, v: 100, easing: "linear" },
		{ t: 1, v: 100, easing: "linear" },
	];

	test("empty/undefined returns fallback", () => {
		expect(evalTrack(undefined, 0.5, 7)).toBe(7);
		expect(evalTrack([], 0.5, 7)).toBe(7);
	});

	test("single keyframe holds value", () => {
		expect(evalTrack([{ t: 0.5, v: 42 }], 0, 0)).toBe(42);
		expect(evalTrack([{ t: 0.5, v: 42 }], 1, 0)).toBe(42);
	});

	test("linear interpolation + hold segment", () => {
		expect(evalTrack(track, 0.25, 0)).toBeCloseTo(50, 6);
		expect(evalTrack(track, 0.75, 0)).toBeCloseTo(100, 6);
	});

	test("clamps outside 0..1", () => {
		expect(evalTrack(track, -1, 0)).toBe(0);
		expect(evalTrack(track, 2, 0)).toBe(100);
	});

	test("easing applies per segment", () => {
		const eased: ValueKeyframe[] = [
			{ t: 0, v: 0 },
			{ t: 1, v: 1, easing: "in" },
		];
		expect(evalTrack(eased, 0.5, 0)).toBeCloseTo(0.25, 6);
	});

	test("matches evalMotion for equivalent 2-keyframe input", () => {
		const kfTrack: ValueKeyframe[] = [
			{ t: 0, v: 1 },
			{ t: 1, v: 1.5, easing: "out" },
		];
		const motion = {
			keyframes: [
				{ t: 0, scale: 1, x: 0, y: 0 },
				{ t: 1, scale: 1.5, x: 0, y: 0, easing: "out" as const },
			],
		};
		for (const p of [0, 0.3, 0.5, 0.9, 1]) {
			expect(evalTrack(kfTrack, p, 1)).toBeCloseTo(evalMotion(motion, p).scale, 8);
		}
	});
});

describe("evalColorTrack — color tracks", () => {
	test("empty/undefined returns fallback", () => {
		expect(evalColorTrack(undefined, 0.5, "#ffffff")).toBe("#ffffff");
		expect(evalColorTrack([], 0.5, "#ffffff")).toBe("#ffffff");
	});

	test("hex colors interpolate to concrete rgb", () => {
		const track = [
			{ t: 0, v: "#000000" },
			{ t: 1, v: "#ffffff", easing: "linear" as const },
		];
		expect(evalColorTrack(track, 0.5, "#000000")).toBe("rgb(128, 128, 128)");
	});

	test("non-hex css colors use color-mix fallback", () => {
		const track = [
			{ t: 0, v: "red" },
			{ t: 1, v: "blue", easing: "linear" as const },
		];
		expect(evalColorTrack(track, 0.25, "red")).toBe("color-mix(in srgb, blue 25%, red)");
	});
});

describe("overlay animation schema", () => {
	test("accepts Motion Studio numeric style and layout tracks", () => {
		const parsed = overlayAnimSchema.parse({
			tracks: {
				width: [
					{ t: 0, v: 60 },
					{ t: 1, v: 100, easing: "out" },
				],
				height: [
					{ t: 0, v: 20 },
					{ t: 1, v: 40 },
				],
				blur: [
					{ t: 0, v: 12 },
					{ t: 1, v: 0 },
				],
				bgOpacity: [
					{ t: 0, v: 0 },
					{ t: 1, v: 0.75 },
				],
				fontSize: [
					{ t: 0, v: 48 },
					{ t: 1, v: 96 },
				],
				letterSpacing: [
					{ t: 0, v: -1 },
					{ t: 1, v: 4 },
				],
				lineHeight: [
					{ t: 0, v: 0.95 },
					{ t: 1, v: 1.2 },
				],
			},
			colorTracks: {
				fill: [
					{ t: 0, v: "#ffffff" },
					{ t: 1, v: "#ff0000" },
				],
				bodyFill: [
					{ t: 0, v: "#cbd5e1" },
					{ t: 1, v: "#94a3b8" },
				],
				accent: [
					{ t: 0, v: "#7C66FF" },
					{ t: 1, v: "#38bdf8" },
				],
				background: [
					{ t: 0, v: "#020617" },
					{ t: 1, v: "#111827" },
				],
			},
		});
		expect(Object.keys(parsed.tracks).sort()).toEqual([
			"bgOpacity",
			"blur",
			"fontSize",
			"height",
			"letterSpacing",
			"lineHeight",
			"width",
		]);
		expect(Object.keys(parsed.colorTracks ?? {}).sort()).toEqual([
			"accent",
			"background",
			"bodyFill",
			"fill",
		]);
	});
});
