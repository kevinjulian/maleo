import { describe, expect, it } from "vite-plus/test";
import { TEXT_PRESETS } from "./timeline-model.ts";
import {
	VISUAL_PRIMITIVE_IDS,
	RETIRED_VISUAL_PRESET_IDS,
	classifyVisualPreset,
	isVisualPrimitive,
	oldEffectiveVisualPreset,
	SHAPE_PRIMITIVES,
	SHAPE_POLYGONS,
	shapeGeometry,
} from "./visual-primitives.ts";

describe("visual preset retirement", () => {
	it("classifies every historical preset with an explicit, disjoint vocabulary", () => {
		for (const id of TEXT_PRESETS) expect(classifyVisualPreset(id), id).not.toBe("unknown");
		for (const id of VISUAL_PRIMITIVE_IDS) expect(classifyVisualPreset(id)).toBe("primitive");
		for (const id of RETIRED_VISUAL_PRESET_IDS) {
			expect(classifyVisualPreset(id)).toBe("retired");
			expect(isVisualPrimitive(id)).toBe(false);
		}
		expect(classifyVisualPreset("motion-comp")).toBe("composition");
		expect(isVisualPrimitive("motion-comp")).toBe(false);
	});

	it("resolves only historical missing and empty IDs to the old title", () => {
		for (const id of [undefined, null, ""]) {
			expect(oldEffectiveVisualPreset(id)).toBe("title");
			expect(classifyVisualPreset(id)).toBe("retired");
			expect(isVisualPrimitive(id)).toBe(false);
		}
	});

	it("does not classify arbitrary strings or unrelated data as retired", () => {
		for (const id of ["rve-unknown", "title.png", " title", 0, false, {}, ["title"]]) {
			expect(classifyVisualPreset(id)).toBe("unknown");
			expect(oldEffectiveVisualPreset(id)).toBe(id);
		}
	});
});

describe("shape geometry", () => {
	it("fixes triangle vertices, five star points and one-third cross bars", () => {
		expect(SHAPE_POLYGONS["shape-triangle"]).toEqual([
			[0.5, 0],
			[1, 1],
			[0, 1],
		]);
		const star = SHAPE_POLYGONS["shape-star"];
		expect(star).toHaveLength(10);
		expect(star[0]).toEqual([0.5, 0]);
		for (const [i, [x, y]] of star.entries())
			expect(Math.hypot(x - 0.5, y - 0.5)).toBeCloseTo(i % 2 === 0 ? 0.5 : 0.25);
		expect(SHAPE_POLYGONS["shape-cross"]).toHaveLength(12);
		expect(SHAPE_POLYGONS["shape-cross"].slice(0, 4)).toEqual([
			[1 / 3, 0],
			[2 / 3, 0],
			[2 / 3, 1 / 3],
			[1, 1 / 3],
		]);
	});

	it("scales nonsquare boxes and keeps round stroke bounds within the box", () => {
		for (const { preset } of SHAPE_PRIMITIVES) {
			for (const [w, h, stroke] of [
				[200, 60, 8],
				[60, 200, 8],
				[0, 60, 8],
				[60, 0, 0],
				[5, 5, 100],
			]) {
				const geometry = shapeGeometry(preset, w!, h!, stroke!);
				const inset = geometry.strokeWidth / 2;
				if (geometry.kind === "polygon")
					for (const [x, y] of geometry.points) {
						expect(x - inset).toBeGreaterThanOrEqual(0);
						expect(y - inset).toBeGreaterThanOrEqual(0);
						expect(x + inset).toBeLessThanOrEqual(w!);
						expect(y + inset).toBeLessThanOrEqual(h!);
					}
				else if (geometry.kind === "ellipse") {
					expect(geometry.rx * 2 + geometry.strokeWidth).toBe(w);
					expect(geometry.ry * 2 + geometry.strokeWidth).toBe(h);
				} else {
					expect(geometry.width + geometry.strokeWidth).toBe(w);
					expect(geometry.height + geometry.strokeWidth).toBe(h);
				}
			}
		}
		expect(shapeGeometry("shape-triangle", 200, 60, 8)).toEqual({
			kind: "polygon",
			points: [
				[100, 4],
				[196, 56],
				[4, 56],
			],
			strokeWidth: 8,
		});
	});

	it("rejects invalid numbers and retains authored zero radius", () => {
		for (const invalid of [NaN, Infinity, -1]) {
			expect(() => shapeGeometry("shape-rect", invalid, 100)).toThrow(RangeError);
			expect(() => shapeGeometry("shape-star", 100, 100, invalid)).toThrow(RangeError);
		}
		expect(shapeGeometry("shape-rect", 100, 50, 0, 0)).toMatchObject({ radius: 0, strokeWidth: 0 });
	});
});
