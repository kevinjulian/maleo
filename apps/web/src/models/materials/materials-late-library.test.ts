/* Seeding a preset whose material library has not arrived yet.
 *
 * The create form fetches the material library and the default preset in
 * parallel, so the preset can win. A preset NAMES materials by id, and an
 * unloaded library resolves every one of those ids to nothing — which seeds a
 * project carrying the preset's name and none of its content. The failure is
 * silent, because "id did not resolve" and "preset names no materials" produce
 * byte-identical results.
 *
 * These pin the two halves of the fix: the seed waits for the library, and if it
 * ran anyway it can be re-run once the library lands without trampling anything
 * the operator has since chosen.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import {
	EMPTY_PROJECT_MATERIALS,
	MATERIAL_ELEMENT_PATHS,
	defaulterSource,
	operatorSource,
	presetBundle,
	type ContentPreset,
	type MaterialRecord,
} from "@maleo/shared";
import { seedMaterialsFromPreset } from "./materials-seed.ts";

const LIBRARY: MaterialRecord[] = [
	{
		id: "m-story",
		workspace: "default",
		name: "Story",
		description: "",
		group: "story",
		body: "hopeful finance drama",
		assetIds: [],
		slug: "m-story",
		source: "user",
		retired: false,
		createdAt: 0,
		updatedAt: 0,
	},
	{
		id: "m-visual",
		workspace: "default",
		name: "Visual",
		description: "",
		group: "visual",
		body: "stickman on white",
		assetIds: ["e1"],
		slug: "m-visual",
		source: "user",
		retired: false,
		createdAt: 0,
		updatedAt: 0,
	},
];

const PRESET: ContentPreset = {
	id: "cp-default",
	name: "House",
	description: "",
	slug: "cp-default",
	source: "user",
	retired: false,
	createdAt: 0,
	updatedAt: 0,
	bundle: presetBundle({
		materials: { story: "m-story", visual: "m-visual", voice: null, rules: null },
		videoTemplateId: "tpl-1",
	}),
};

describe("seeding against a library that has not loaded", () => {
	/* This is the bug, pinned so the gate cannot be removed silently: an empty
	 * library is not an error, it just produces nothing. */
	test("an empty library seeds no materials at all", () => {
		const seed = seedMaterialsFromPreset(
			PRESET,
			[],
			EMPTY_PROJECT_MATERIALS,
			{},
			{ overwriteOperatorEdits: true },
		);
		expect(seed.materials).toEqual(EMPTY_PROJECT_MATERIALS);
		expect(seed.sources[MATERIAL_ELEMENT_PATHS.story]).toBeUndefined();
	});

	test("it is indistinguishable from a preset that names nothing", () => {
		const bare = { ...PRESET, bundle: presetBundle({ videoTemplateId: "tpl-1" }) };
		const unloaded = seedMaterialsFromPreset(PRESET, [], EMPTY_PROJECT_MATERIALS);
		const named = seedMaterialsFromPreset(bare, LIBRARY, EMPTY_PROJECT_MATERIALS);
		expect(unloaded.materials).toEqual(named.materials);
	});

	/* The template does NOT come from the library, so it survives the race. That is
	 * why "the preset applied" looks true from the outside while the materials are
	 * empty — and why the gate has to exist rather than being inferred from state. */
	test("the video template still resolves, which is what hides the failure", () => {
		expect(seedMaterialsFromPreset(PRESET, [], EMPTY_PROJECT_MATERIALS).videoTemplateId).toBe(
			"tpl-1",
		);
	});
});

describe("re-seeding once the library lands", () => {
	test("fills the groups the first pass could not resolve", () => {
		const first = seedMaterialsFromPreset(
			PRESET,
			[],
			EMPTY_PROJECT_MATERIALS,
			{},
			{ overwriteOperatorEdits: true },
		);
		const second = seedMaterialsFromPreset(PRESET, LIBRARY, first.materials, first.sources);
		expect(second.materials.story.body).toBe("hopeful finance drama");
		expect(second.materials.visual.body).toBe("stickman on white");
		expect(second.materials.visual.assetIds).toEqual(["e1"]);
	});

	test("the re-seed records the preset as the source, so reset-to-preset works after", () => {
		const first = seedMaterialsFromPreset(PRESET, [], EMPTY_PROJECT_MATERIALS);
		const second = seedMaterialsFromPreset(PRESET, LIBRARY, first.materials, first.sources);
		expect(second.sources[MATERIAL_ELEMENT_PATHS.visual]).toEqual(
			defaulterSource("project-preset", "cp-default"),
		);
	});

	/* The re-seed runs without `overwriteOperatorEdits`, so anything chosen during
	 * the race is kept. Losing an operator's pick to a late fetch would be a worse
	 * bug than the one being fixed. */
	test("a group the operator chose during the race is not trampled", () => {
		const first = seedMaterialsFromPreset(PRESET, [], EMPTY_PROJECT_MATERIALS);
		const chosen = {
			materials: {
				...first.materials,
				visual: { body: "my own look", assetIds: [], materialId: null },
			},
			sources: { ...first.sources, [MATERIAL_ELEMENT_PATHS.visual]: operatorSource() },
		};
		const second = seedMaterialsFromPreset(PRESET, LIBRARY, chosen.materials, chosen.sources);
		expect(second.materials.visual.body).toBe("my own look");
		// The group they did NOT touch is still filled.
		expect(second.materials.story.body).toBe("hopeful finance drama");
	});

	test("re-seeding when the first pass already succeeded changes nothing", () => {
		const first = seedMaterialsFromPreset(
			PRESET,
			LIBRARY,
			EMPTY_PROJECT_MATERIALS,
			{},
			{ overwriteOperatorEdits: true },
		);
		const second = seedMaterialsFromPreset(PRESET, LIBRARY, first.materials, first.sources);
		expect(second.materials).toEqual(first.materials);
	});
});

/* The gate and the re-seed are wired in the hook; assert the wiring exists so a
 * refactor that drops either one fails here rather than in production. */
describe("the create flow waits for the library", () => {
	test("the seed effect is gated on materialsLoaded", async () => {
		const src = readFileSync(
			`${import.meta.dirname}/../../hooks/editor/use-preset-selection.ts`,
			"utf8",
		);
		expect(src).toContain("if (!materialsLoaded || presetSeededRef.current) return;");
		expect(src).toContain("}, [materialsLoaded]);");
	});

	test("a late library re-seeds the selected preset once", async () => {
		const src = readFileSync(
			`${import.meta.dirname}/../../hooks/editor/use-preset-selection.ts`,
			"utf8",
		);
		expect(src).toContain("reseededRef");
		expect(src).toMatch(
			/seedMaterialsFromPreset\(\s*selectedPreset,\s*materialLibrary,\s*materials,\s*elementSources,?\s*\)/,
		);
	});

	test("the library reports loaded even when the fetch fails", async () => {
		const src = readFileSync(
			`${import.meta.dirname}/../../components/catalog/preset-material-picker.tsx`,
			"utf8",
		);
		// `.finally` rather than `.then`: a library that never arrives must not block create.
		expect(src).toMatch(/\.finally\(\(\) => \{\s*if \(alive\) setLoaded\(true\);\s*\}\)/);
	});
});
