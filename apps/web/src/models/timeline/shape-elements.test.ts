import { expect, test } from "vite-plus/test";
import { patchShapeNumber, shapeElement } from "./shape-elements.ts";
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
