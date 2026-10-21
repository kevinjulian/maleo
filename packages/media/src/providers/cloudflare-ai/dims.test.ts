import { describe, expect, it } from "vite-plus/test";
import { assertAspectSupported, resolveDimensions } from "./dims.ts";
import { resolveImageModel } from "./models.ts";

const klein = resolveImageModel("@cf/black-forest-labs/flux-2-klein-4b");
const schnell = resolveImageModel("@cf/black-forest-labs/flux-1-schnell");

const ASPECT_RATIOS: [string, number][] = [
	["1:1", 1],
	["16:9", 16 / 9],
	["9:16", 9 / 16],
	["4:5", 4 / 5],
	["3:4", 3 / 4],
];

describe("aspect to dimensions", () => {
	it("returns an EXACT ratio for every supported aspect", () => {
		// Not "close enough": task 1.2 showed the upstream floors both sides to a
		// multiple of 16, so an off-grid request comes back a different shape than
		// it asked for. Exactness here is what makes the request survive that.
		for (const [aspect, ratio] of ASPECT_RATIOS) {
			const dims = resolveDimensions(aspect, klein)!;
			expect(dims.width / dims.height).toBe(ratio);
		}
	});

	it("puts both sides on the model's grid, so nothing is floored upstream", () => {
		for (const [aspect] of ASPECT_RATIOS) {
			const dims = resolveDimensions(aspect, klein)!;
			expect(dims.width % klein.dimensions!.grid).toBe(0);
			expect(dims.height % klein.dimensions!.grid).toBe(0);
		}
	});

	it("stays inside the documented range", () => {
		for (const [aspect] of ASPECT_RATIOS) {
			const dims = resolveDimensions(aspect, klein)!;
			expect(Math.min(dims.width, dims.height)).toBeGreaterThanOrEqual(klein.dimensions!.min);
			expect(Math.max(dims.width, dims.height)).toBeLessThanOrEqual(klein.dimensions!.max);
		}
	});

	it("asks below the ceiling for wide and vertical rather than on it", () => {
		// 1920x1080 was the intuitive choice and it is WRONG: klein returns
		// 1920x1072 for it. 1792x1008 is the largest exactly-16:9 pair on the grid.
		expect(resolveDimensions("16:9", klein)).toEqual({ width: 1792, height: 1008 });
		expect(resolveDimensions("9:16", klein)).toEqual({ width: 1008, height: 1792 });
	});

	it("preserves the ratio when a model's range forces a downscale", () => {
		const narrow = { ...klein, dimensions: { min: 256, max: 960, grid: 16 } };
		const dims = resolveDimensions("16:9", narrow)!;
		expect(dims.width).toBeLessThanOrEqual(960);
		expect(dims.width / dims.height).toBe(16 / 9);
	});

	it("respects a coarser grid", () => {
		const coarse = { ...klein, dimensions: { min: 256, max: 1920, grid: 64 } };
		const dims = resolveDimensions("16:9", coarse)!;
		expect(dims.width % 64).toBe(0);
		expect(dims.height % 64).toBe(0);
		expect(dims.width / dims.height).toBe(16 / 9);
	});

	it("returns no dimensions for a model that exposes none", () => {
		expect(resolveDimensions("1:1", schnell)).toBeNull();
	});

	it("defaults an unknown aspect to a square rather than throwing", () => {
		const dims = resolveDimensions("21:9", klein)!;
		expect(dims.width).toBe(dims.height);
	});
});

describe("aspect support guard", () => {
	it("allows any aspect on a model that accepts dimensions", () => {
		expect(() => assertAspectSupported("9:16", klein)).not.toThrow();
	});

	it("allows a square on a square-only model", () => {
		expect(() => assertAspectSupported("1:1", schnell)).not.toThrow();
		expect(() => assertAspectSupported(undefined, schnell)).not.toThrow();
	});

	it("refuses a non-square on a square-only model, naming model and aspect", () => {
		expect(() => assertAspectSupported("9:16", schnell)).toThrow(/flux-1-schnell/);
		expect(() => assertAspectSupported("9:16", schnell)).toThrow(/9:16/);
	});
});
