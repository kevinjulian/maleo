import { expect, test } from "vite-plus/test";
import { shapeNumber } from "../src/compositions/reel-text.tsx";

test("shape numeric parameters accept authored numbers and legacy strings without losing zero", () => {
	for (const value of [0, "0"]) expect(shapeNumber({ opacity: value }, "opacity", 1)).toBe(0);
	for (const value of [8, "8"])
		expect(shapeNumber({ strokeWidth: value }, "strokeWidth", 0)).toBe(8);
	for (const value of [undefined, "", "bad", NaN, Infinity])
		expect(shapeNumber(value === undefined ? undefined : { radius: value }, "radius", 12)).toBe(12);
	expect(shapeNumber({ strokeWidth: -8 }, "strokeWidth", 0)).toBe(0);
});
