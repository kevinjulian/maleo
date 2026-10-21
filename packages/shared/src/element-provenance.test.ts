import { describe, expect, test } from "vite-plus/test";
import {
	ELEMENT_LAYERS,
	OPERATOR_LAYER,
	isOverridden,
	outranks,
	seedableFrom,
	type ElementLayer,
	type ElementSource,
} from "./element-provenance.ts";

const source = (layer: ElementLayer, defaulterId: string | null = null): ElementSource => ({
	layer,
	defaulterId,
});

describe("the layer order is closed and total", () => {
	test("layers are declared in rank order, weakest first", () => {
		expect(ELEMENT_LAYERS).toEqual([
			"code-default",
			"workspace-default",
			"project-preset",
			"render-template",
			"operator",
		]);
	});

	test("operator is the strongest layer", () => {
		expect(OPERATOR_LAYER).toBe("operator");
		for (const layer of ELEMENT_LAYERS) {
			if (layer === OPERATOR_LAYER) continue;
			expect(outranks(OPERATOR_LAYER, layer)).toBe(true);
			expect(outranks(layer, OPERATOR_LAYER)).toBe(false);
		}
	});

	test("a layer does not outrank itself", () => {
		for (const layer of ELEMENT_LAYERS) expect(outranks(layer, layer)).toBe(false);
	});

	test("ranking is transitive across the whole set", () => {
		for (const [i, low] of ELEMENT_LAYERS.entries()) {
			for (const high of ELEMENT_LAYERS.slice(i + 1)) {
				expect(outranks(high, low)).toBe(true);
				expect(outranks(low, high)).toBe(false);
			}
		}
	});
});

/* `overridden` is DERIVED, never stored. Storing it alongside the layer is two
 * fields that must agree, which is the class of bug this whole change exists to
 * remove — the old seeding kept "is this untouched?" in the value itself, by
 * comparing against a default, and got it wrong whenever a deliberate choice
 * happened to equal that default. */
describe("overridden is derived from the layer", () => {
	test("an operator-owned element reads as overridden", () => {
		expect(isOverridden(source("operator"))).toBe(true);
	});

	test("every weaker layer reads as inherited", () => {
		for (const layer of ELEMENT_LAYERS) {
			if (layer === OPERATOR_LAYER) continue;
			expect(isOverridden(source(layer))).toBe(false);
		}
	});

	/* A project written before provenance existed carries no source. Absent must read
	 * as operator-owned: the two failure directions are not symmetric. Reading it as
	 * inherited means the first preset applied after upgrade silently wipes work
	 * somebody already did; reading it as owned only means they re-inherit less until
	 * they revert, which is visible and recoverable. */
	test("an absent source reads as operator-owned", () => {
		expect(isOverridden(undefined)).toBe(true);
		expect(isOverridden(null)).toBe(true);
	});
});

describe("seedability is decided by recorded layer, never by value", () => {
	test("an element at a weaker layer is seedable", () => {
		expect(seedableFrom(source("code-default"), "project-preset")).toBe(true);
		expect(seedableFrom(source("workspace-default"), "project-preset")).toBe(true);
	});

	test("an element at the same layer is seedable again", () => {
		// Re-applying the same defaulter has to be able to refresh what it supplied,
		// otherwise a second apply of the same preset is a no-op that looks broken.
		expect(seedableFrom(source("project-preset"), "project-preset")).toBe(true);
	});

	test("an operator-owned element is never seedable", () => {
		for (const layer of ELEMENT_LAYERS) {
			expect(seedableFrom(source("operator"), layer)).toBe(false);
		}
	});

	test("an element at a stronger layer is not seedable by a weaker one", () => {
		expect(seedableFrom(source("render-template"), "project-preset")).toBe(false);
	});

	test("an absent source is not seedable, because absent means operator-owned", () => {
		expect(seedableFrom(undefined, "project-preset")).toBe(false);
	});
});
