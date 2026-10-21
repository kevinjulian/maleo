/* Saving a project-local edit back to a reusable material.
 *
 * After a successful save the group is FAITHFUL to the row it just wrote, so the
 * badge must read "From material" and the revert action must disappear. Recording
 * an override instead left it saying "Modified from material" and still offering
 * "Revert to material" — inviting an operator to revert away the thing they had
 * just published.
 *
 * This exercises the state transition the drawer performs rather than rendering
 * it: the save is async and behind a `window.prompt`, and a static render cannot
 * reach the state that follows it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import {
	EMPTY_PROJECT_MATERIALS,
	MATERIAL_ELEMENT_PATHS,
	defaulterSource,
	operatorSource,
	type MaterialGroupValue,
	type ProjectMaterials,
} from "@maleo/shared";
import type { ElementSourceMap } from "@models/presets/element-sources.ts";
import {
	isModifiedFromMaterial,
	materialOrigin,
	materialOriginLabel,
	overrideMaterialGroup,
	selectMaterialGroup,
} from "@models/materials/materials-seed.ts";

/** The transition `saveAsReusable` performs once the write returns. */
function afterSave(
	materials: ProjectMaterials,
	sources: ElementSourceMap,
	value: MaterialGroupValue,
	savedId: string,
): { materials: ProjectMaterials; sources: ElementSourceMap } {
	return selectMaterialGroup(materials, sources, "visual", { ...value, materialId: savedId });
}

const originOf = (state: { materials: ProjectMaterials; sources: ElementSourceMap }) =>
	materialOrigin(state.materials.visual, state.sources[MATERIAL_ELEMENT_PATHS.visual]);

/** A group the operator has typed into, with no material behind it yet. */
function handTyped(): { materials: ProjectMaterials; sources: ElementSourceMap } {
	return overrideMaterialGroup(EMPTY_PROJECT_MATERIALS, {}, "visual", {
		body: "stickman on white",
		assetIds: ["e1"],
		materialId: null,
	});
}

/** A group taken from a material and then edited away from it. */
function editedFromMaterial(): { materials: ProjectMaterials; sources: ElementSourceMap } {
	const picked = selectMaterialGroup(EMPTY_PROJECT_MATERIALS, {}, "visual", {
		body: "original look",
		assetIds: [],
		materialId: "m1",
	});
	return overrideMaterialGroup(picked.materials, picked.sources, "visual", {
		...picked.materials.visual,
		body: "my own words",
	});
}

describe("save as reusable (a new material)", () => {
	test("the group stops reading as project-only once it is published", () => {
		const before = handTyped();
		expect(originOf(before)).toBe("project");

		const after = afterSave(before.materials, before.sources, before.materials.visual, "m-new");
		expect(originOf(after)).toBe("material");
		expect(materialOriginLabel(originOf(after))).toBe("From material");
	});

	test("it does not read as modified immediately after a successful save", () => {
		const before = handTyped();
		const after = afterSave(before.materials, before.sources, before.materials.visual, "m-new");
		expect(materialOriginLabel(originOf(after))).not.toBe("Modified from material");
		expect(
			isModifiedFromMaterial(after.materials.visual, after.sources[MATERIAL_ELEMENT_PATHS.visual]),
		).toBe(false);
	});

	test("the saved body and references are preserved", () => {
		const before = handTyped();
		const after = afterSave(before.materials, before.sources, before.materials.visual, "m-new");
		expect(after.materials.visual.body).toBe("stickman on white");
		expect(after.materials.visual.assetIds).toEqual(["e1"]);
		expect(after.materials.visual.materialId).toBe("m-new");
	});

	test("the recorded source names the material that was written", () => {
		const before = handTyped();
		const after = afterSave(before.materials, before.sources, before.materials.visual, "m-new");
		expect(after.sources[MATERIAL_ELEMENT_PATHS.visual]).toEqual(
			defaulterSource("operator", "m-new"),
		);
	});
});

describe("save back (an existing material)", () => {
	test("an edited group becomes faithful again once it is written back", () => {
		const before = editedFromMaterial();
		expect(originOf(before)).toBe("modified-material");

		const after = afterSave(before.materials, before.sources, before.materials.visual, "m1");
		expect(originOf(after)).toBe("material");
	});

	/* The specific regression: revert stays offered after a successful save, so the
	 * operator can undo the thing they just published. */
	test("revert is no longer offered after the save succeeds", () => {
		const before = editedFromMaterial();
		expect(
			isModifiedFromMaterial(
				before.materials.visual,
				before.sources[MATERIAL_ELEMENT_PATHS.visual],
			),
		).toBe(true);

		const after = afterSave(before.materials, before.sources, before.materials.visual, "m1");
		expect(
			isModifiedFromMaterial(after.materials.visual, after.sources[MATERIAL_ELEMENT_PATHS.visual]),
		).toBe(false);
	});

	test("the edited text is what is kept, not the material's old body", () => {
		const before = editedFromMaterial();
		const after = afterSave(before.materials, before.sources, before.materials.visual, "m1");
		expect(after.materials.visual.body).toBe("my own words");
	});

	test("editing again after the save reads as modified once more", () => {
		const before = editedFromMaterial();
		const saved = afterSave(before.materials, before.sources, before.materials.visual, "m1");
		const reEdited = overrideMaterialGroup(saved.materials, saved.sources, "visual", {
			...saved.materials.visual,
			body: "changed again",
		});
		expect(originOf(reEdited)).toBe("modified-material");
	});

	test("other groups are untouched by the save", () => {
		const before = overrideMaterialGroup(
			editedFromMaterial().materials,
			editedFromMaterial().sources,
			"story",
			{
				body: "brief",
				assetIds: [],
				materialId: null,
			},
		);
		const after = afterSave(before.materials, before.sources, before.materials.visual, "m1");
		expect(after.materials.story.body).toBe("brief");
		expect(after.sources[MATERIAL_ELEMENT_PATHS.story]).toEqual(operatorSource());
	});
});

/* The drawer must perform this transition, not the override it used to. */
describe("the drawer wires the save to a selection", () => {
	test("saveAsReusable records a selection for the saved id", async () => {
		const src = readFileSync(`${import.meta.dirname}/project-materials-drawer.tsx`, "utf8");
		const body = src.slice(
			src.indexOf("const saveAsReusable"),
			src.indexOf("return (", src.indexOf("const saveAsReusable")),
		);
		expect(body).toMatch(
			/selectMaterialGroup\(\s*materials,\s*sources,\s*group,\s*\{\s*\.\.\.value,\s*materialId:\s*saved\.id\s*,?\s*\},?\s*\)/,
		);
		expect(body).not.toContain("writeGroup(group, { ...value, materialId: saved.id })");
	});
});
