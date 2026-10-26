import { expect, test } from "vite-plus/test";
import { initialShapeLayout, patchShapeNumber, shapeElement } from "./shape-elements.ts";
test("only existing shape presets identify shapes and numerical edits preserve valid zero", () => {
	expect(shapeElement("shape-circle")?.label).toBe("Circle");
	expect(shapeElement("title")).toBeUndefined();
	expect(patchShapeNumber({ fill: "transparent", opacity: 0 }, "radius", 0)).toEqual({
		fill: "transparent",
		opacity: 0,
		radius: 0,
	});
	for (const value of [-1, NaN, Infinity])
		expect(patchShapeNumber({}, "strokeWidth", value)).toBeUndefined();
});

test("new shapes keep their visible proportions on wide and portrait canvases", () => {
	for (const aspect of [16 / 9, 1, 9 / 16]) {
		for (const preset of ["shape-circle", "shape-triangle", "shape-star", "shape-cross"]) {
			const layout = initialShapeLayout(preset, aspect)!;
			expect((layout.widthPct * aspect) / layout.heightPct!).toBeCloseTo(1, 8);
			expect(layout.xPct + layout.widthPct / 2).toBeCloseTo(50, 8);
			expect(layout.yPct + layout.heightPct! / 2).toBeCloseTo(50, 8);
		}
		const rectangle = initialShapeLayout("shape-rect", aspect)!;
		expect((rectangle.widthPct * aspect) / rectangle.heightPct!).toBeCloseTo(4, 8);
	}
	expect(initialShapeLayout("plain", 16 / 9)).toBeUndefined();
});
