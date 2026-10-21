import { expect, test } from "vite-plus/test";
import {
	clipMaskSchema,
	clipColorSchema,
	clipBlendModeSchema,
	clipCompositingBlockers,
	hasClipCompositing,
	clipMaskImage,
} from "./clip-compositing.ts";
import { clipControlBlockers } from "./clip-animation.ts";

const mask = {
	shape: "ellipse" as const,
	xPct: 25,
	yPct: 25,
	widthPct: 50,
	heightPct: 50,
	rotationDeg: 0,
	featherPct: 0,
	inverted: false,
};
test("compositing validates finite local geometry and neutral legacy fields", () => {
	expect(clipMaskSchema.parse(mask)).toEqual(mask);
	for (const patch of [
		{ xPct: -1 },
		{ widthPct: 0 },
		{ xPct: 80 },
		{ rotationDeg: 181 },
		{ featherPct: 51 },
		{ heightPct: NaN },
		{ shape: "path" },
	])
		expect(clipMaskSchema.safeParse({ ...mask, ...patch }).success).toBe(false);
	expect(clipColorSchema.safeParse({ brightness: 2, contrast: 0, saturation: 3 }).success).toBe(
		true,
	);
	expect(
		clipColorSchema.safeParse({ brightness: Infinity, contrast: 1, saturation: 1 }).success,
	).toBe(false);
	expect(clipBlendModeSchema.safeParse("overlay").success).toBe(false);
	expect(hasClipCompositing(undefined)).toBe(false);
	expect(
		hasClipCompositing({
			color: { brightness: 1, contrast: 1, saturation: 1 },
			blendMode: "normal",
		}),
	).toBe(false);
	expect(hasClipCompositing({ mask })).toBe(true);
	expect(decodeURIComponent(clipMaskImage({ ...mask, rotationDeg: 90 }, 200, 100))).toContain(
		"rotate(90 100 50)",
	);
	expect(() => clipMaskImage(mask, 0, 100)).toThrow("Invalid mask box");
});
test("canonical and legacy control boundaries reject unsupported compositing before projection", () => {
	const input = {
		clips: [
			{
				payload: {
					label: "Interview",
					layout: { blendMode: "overlay", mask: { ...mask, widthPct: 0 } },
				},
			},
		],
	};
	expect(clipCompositingBlockers(input)).toEqual([
		"Interview: invalid mask. Repair compositing before export.",
		"Interview: invalid blendMode. Repair compositing before export.",
	]);
	expect(clipControlBlockers(input)).toEqual(clipCompositingBlockers(input));
	expect(
		clipControlBlockers({
			scenes: [{ layout: { mask, color: { brightness: 1, contrast: 1, saturation: 1 } } }],
		}),
	).toEqual([]);
});
