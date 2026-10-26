import { SHAPE_ELEMENTS } from "@models/timeline/shape-elements.ts";
import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { builtInCounts } from "./built-in-elements.tsx";
import { BUILT_IN_TEXT_PRESETS } from "@models/timeline/element-catalogue.ts";

const read = (path: string): string => readFileSync(`${import.meta.dirname}/${path}`, "utf8");

/* The requirement is that the library and the rail cannot come to disagree about
 * what a built-in element is. A screenshot cannot assert that; only the import
 * graph can. */
describe("the library and the rail read one element source", () => {
	const railPath = `${import.meta.dirname}/../timeline/elements-panel.tsx`;

	test("both import the definitions from the model module", () => {
		const library = read("built-in-elements.tsx");
		const rail = readFileSync(railPath, "utf8");
		for (const src of [library, rail]) {
			expect(src).toContain('from "@models/timeline/element-catalogue.ts"');
		}
	});

	/* The failure this guards against is not an import that goes missing, it is a
	 * second list appearing next to the first — which type-checks, renders, and
	 * silently stops matching the rail the next time a preset is added. */
	test("the library declares no element list of its own", () => {
		const library = read("built-in-elements.tsx");
		expect(library).not.toContain("TEMPLATE_ITEMS");
		// No array literal of preset-ish string ids.
		expect(library).not.toMatch(/\[\s*"(title|subtitle|stat|quote|bar_chart|stat_reveal)"/);
	});

	test("motion reads saved user templates without stock items", () => {
		const rail = readFileSync(railPath, "utf8");
		expect(rail).toContain("CustomTemplatesBlock");
		expect(rail).not.toContain("MOTION_ITEMS");
	});
});

/* Cheap guards on the module itself: an empty family would render an empty group
 * that looks deliberate. */
describe("the retained catalogue", () => {
	test("text and five shapes appear exactly once", () => {
		expect(BUILT_IN_TEXT_PRESETS).toEqual(["plain"]);
		expect(SHAPE_ELEMENTS.map((item) => item.preset)).toEqual([
			"shape-rect",
			"shape-circle",
			"shape-triangle",
			"shape-star",
			"shape-cross",
		]);
		expect(new Set(SHAPE_ELEMENTS.map((item) => item.preset)).size).toBe(5);
		expect(builtInCounts("")).toEqual({ shapes: 5, text: 1 });
		expect(builtInCounts("star")).toEqual({ shapes: 1, text: 0 });
	});
	test("editor and Library expose exactly three groups", () => {
		for (const src of [read("../timeline/elements-panel.tsx"), read("elements-library.tsx")]) {
			expect(src).not.toMatch(/id: "(?:basic|custom|motion-presets)"/);
			for (const id of ["text", "shapes", "motion"]) expect(src).toContain(`id: "${id}"`);
		}
	});
});

/* Placing needs a timeline and a playhead. The library page has neither, so the
 * built-in tiles carry no handler at all and the custom block is told so. */
describe("the catalogue does not place", () => {
	test("built-in tiles render as figures with no click handler", () => {
		const library = read("built-in-elements.tsx");
		expect(library).toContain('<figure className="catalog-el-tile">');
		expect(library).not.toContain("onClick");
		expect(library).not.toContain("draggable");
	});

	test("the custom block runs unplaceable on this surface", () => {
		expect(read("elements-library.tsx")).toContain("placeable={false}");
	});
});
