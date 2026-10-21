import { SHAPE_ELEMENTS } from "@models/timeline/shape-elements.ts";
import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import {
	BASIC_ELEMENTS,
	BUILT_IN_TEXT_PRESETS,
	INFOGRAPHIC_KINDS,
	MOTION_ITEMS,
} from "@models/timeline/element-catalogue.ts";

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

	test("the rail builds its motion list from the module, not the registry", () => {
		const rail = readFileSync(railPath, "utf8");
		expect(rail).toContain("MOTION_ITEMS");
		expect(rail).not.toContain("TEMPLATE_ITEMS.filter");
	});
});

/* Cheap guards on the module itself: an empty family would render an empty group
 * that looks deliberate. */
describe("the element catalogue is populated", () => {
	test("every built-in family has members", () => {
		expect(BASIC_ELEMENTS.map((item) => item.preset)).toEqual(["plain"]);
		expect(SHAPE_ELEMENTS.map((item) => item.preset)).toEqual(["shape-rect", "shape-circle"]);
		expect(BUILT_IN_TEXT_PRESETS.length).toBeGreaterThan(0);
		expect(MOTION_ITEMS.length).toBeGreaterThan(0);
		expect(INFOGRAPHIC_KINDS.length).toBeGreaterThan(0);
	});

	/* Motion owns the presets it backs, so a preset must not be offered twice
	 * under two different families. */
	test("no preset appears in both the text and motion families", () => {
		const motion = new Set(MOTION_ITEMS.map((item) => item.preset));
		for (const { preset } of [...BASIC_ELEMENTS, ...SHAPE_ELEMENTS]) {
			expect(motion.has(preset)).toBe(false);
			expect(BUILT_IN_TEXT_PRESETS).not.toContain(preset);
		}
		for (const preset of BUILT_IN_TEXT_PRESETS) expect(motion.has(preset)).toBe(false);
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
