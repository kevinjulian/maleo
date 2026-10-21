import { describe, expect, test } from "vite-plus/test";
import {
	EMPTY_MATERIAL_GROUP,
	EMPTY_PROJECT_MATERIALS,
	MATERIAL_ELEMENT_PATHS,
	MATERIAL_GROUPS,
	isEmptyMaterialGroup,
	isEmptyMaterials,
	directionFromMaterials,
	hasRoutableMaterials,
	materialRoutingFor,
	materialsFromLegacy,
	normalizeProjectMaterials,
	projectMaterialsSchema,
	referenceUseForVisualMaterial,
	resolveSelectionHints,
	resolveProjectMaterials,
	routedAssetIds,
	routedMaterials,
	type ProjectMaterials,
	visualReferenceSettings,
	withMaterialGroup,
} from "./project-materials.ts";

function group(body: string, assetIds: string[] = []) {
	return { ...EMPTY_MATERIAL_GROUP, body, assetIds };
}

describe("projectMaterialsSchema", () => {
	test("fills every group and the style bible from an empty object", () => {
		expect(projectMaterialsSchema.parse({})).toEqual(EMPTY_PROJECT_MATERIALS);
	});

	test("rejects unknown keys", () => {
		expect(
			projectMaterialsSchema.safeParse({ story: EMPTY_MATERIAL_GROUP, other: 1 }).success,
		).toBe(false);
	});

	test("rejects an unknown key inside a group", () => {
		expect(projectMaterialsSchema.safeParse({ story: { body: "x", tone: "calm" } }).success).toBe(
			false,
		);
	});
});

describe("normalizeProjectMaterials", () => {
	test("unparseable input reads as empty rather than throwing", () => {
		expect(normalizeProjectMaterials("nonsense")).toEqual(EMPTY_PROJECT_MATERIALS);
		expect(normalizeProjectMaterials(null)).toEqual(EMPTY_PROJECT_MATERIALS);
		expect(normalizeProjectMaterials({ story: { body: 42 } })).toEqual(EMPTY_PROJECT_MATERIALS);
	});

	test("keeps a populated group and its material id", () => {
		const materials = normalizeProjectMaterials({
			visual: { body: "stickman", assetIds: ["e1"], materialId: "m1" },
		});
		expect(materials.visual).toEqual({
			body: "stickman",
			assetIds: ["e1"],
			referenceSettings: [],
			materialId: "m1",
		});
		expect(materials.story).toEqual(EMPTY_MATERIAL_GROUP);
	});

	test("keeps visual reference settings", () => {
		const materials = normalizeProjectMaterials({
			visual: {
				body: "",
				assetIds: ["woman"],
				referenceSettings: [
					{
						entityId: "woman",
						role: "character",
						referenceUse: "exact",
						state: "locked",
						locked: true,
					},
				],
			},
		});
		expect(visualReferenceSettings(materials)).toEqual([
			{
				entityId: "woman",
				role: "character",
				referenceUse: "exact",
				selectionHint: "",
				state: "locked",
				locked: true,
			},
		]);
	});
});

describe("emptiness", () => {
	test("a group with only a material id is still empty", () => {
		expect(isEmptyMaterialGroup({ body: "", assetIds: [], materialId: "m1" })).toBe(true);
	});

	test("assets alone make a group non-empty", () => {
		expect(isEmptyMaterialGroup(group("", ["e1"]))).toBe(false);
	});

	test("reference settings alone make a group non-empty", () => {
		expect(
			isEmptyMaterialGroup({
				...EMPTY_MATERIAL_GROUP,
				referenceSettings: [
					{
						entityId: "style",
						role: "style",
						referenceUse: "style",
						selectionHint: "",
						state: "user-set",
						locked: false,
					},
				],
			}),
		).toBe(false);
	});

	test("a style bible alone makes materials non-empty", () => {
		expect(
			isEmptyMaterials({
				...EMPTY_PROJECT_MATERIALS,
				styleBible: { body: "flat vector", locked: false },
			}),
		).toBe(false);
		expect(isEmptyMaterials(EMPTY_PROJECT_MATERIALS)).toBe(true);
	});
});

describe("material routing", () => {
	test("story stage never reads visual or voice", () => {
		expect(materialRoutingFor("story")).toEqual(["story", "rules"]);
	});

	test("visual and voice stages read story context but not each other", () => {
		expect(materialRoutingFor("visual")).toEqual(["visual", "story", "rules"]);
		expect(materialRoutingFor("voice")).toEqual(["voice", "story", "rules"]);
	});

	test("rules reach every stage", () => {
		for (const stage of ["story", "visual", "voice"] as const) {
			expect(materialRoutingFor(stage)).toContain("rules");
		}
	});

	test("routedMaterials drops empty groups and keeps layer order", () => {
		const materials = {
			...EMPTY_PROJECT_MATERIALS,
			story: group("finance drama"),
			visual: group("stickman on white"),
			rules: group("no captions"),
		};
		expect(routedMaterials(materials, "visual").map(([g]) => g)).toEqual([
			"visual",
			"story",
			"rules",
		]);
		expect(routedMaterials(materials, "story").map(([g]) => g)).toEqual(["story", "rules"]);
	});

	test("visual-only instructions never reach the story stage", () => {
		const materials = { ...EMPTY_PROJECT_MATERIALS, visual: group("stickman on white background") };
		expect(routedMaterials(materials, "story")).toEqual([]);
	});

	test("routedAssetIds dedupes across groups in layer order", () => {
		const materials = {
			...EMPTY_PROJECT_MATERIALS,
			visual: group("look", ["e2", "e1"]),
			story: group("notes", ["e1", "e3"]),
		};
		expect(routedAssetIds(materials, "visual")).toEqual(["e2", "e1", "e3"]);
	});

	test("visual reference use can override role defaults", () => {
		const materials = {
			...EMPTY_PROJECT_MATERIALS,
			visual: {
				...EMPTY_MATERIAL_GROUP,
				assetIds: ["woman", "look"],
				referenceSettings: [
					{
						entityId: "woman",
						role: "character",
						referenceUse: "inspiration",
						selectionHint: "",
						state: "user-set",
						locked: false,
					},
					{
						entityId: "look",
						role: "style",
						referenceUse: null,
						selectionHint: "",
						state: "generated",
						locked: false,
					},
				],
			},
		} satisfies ProjectMaterials;
		expect(referenceUseForVisualMaterial(materials, "woman", "character")).toBe("inspiration");
		expect(referenceUseForVisualMaterial(materials, "look", "style")).toBe("style");
		expect(referenceUseForVisualMaterial(materials, "product", "product")).toBe("direct_place");
	});
});

describe("selection hints", () => {
	const settings = [
		{
			entityId: "john",
			role: "character",
			referenceUse: "exact",
			selectionHint: "John, man, father",
			state: "user-set",
			locked: false,
		},
		{
			entityId: "anna",
			role: "character",
			referenceUse: "exact",
			selectionHint: "Anna, woman, mother",
			state: "user-set",
			locked: false,
		},
		{
			entityId: "watercolor",
			role: "style",
			referenceUse: "style",
			selectionHint: "dreamy watercolor",
			state: "preset-set",
			locked: false,
		},
	] satisfies ProjectMaterials["visual"]["referenceSettings"];

	test("selects one clear matching hint", () => {
		expect(resolveSelectionHints(settings, "Anna walks into the cafe").selectedIds).toEqual([
			"anna",
		]);
	});

	test("normalizes case and punctuation", () => {
		expect(resolveSelectionHints(settings, "The WOMAN enters").selectedIds).toEqual(["anna"]);
	});

	test("reports same-role ambiguity", () => {
		const result = resolveSelectionHints(
			settings,
			"mother and father argue in the kitchen",
			"character",
		);
		expect(result.selectedIds).toEqual([]);
		expect(result.ambiguous.map((match) => match.entityId)).toEqual(["john", "anna"]);
	});

	test("keeps style matching separate from character ambiguity", () => {
		const result = resolveSelectionHints(settings, "Anna in a dreamy watercolor closeup");
		expect(result.selectedIds).toEqual(["anna", "watercolor"]);
		expect(result.ambiguous).toEqual([]);
	});

	test("does not guess when no hint matches", () => {
		expect(resolveSelectionHints(settings, "A street with no named subject")).toEqual({
			selectedIds: [],
			matches: [],
			ambiguous: [],
		});
	});
});

describe("withMaterialGroup", () => {
	test("replaces one group without mutating the input", () => {
		const next = withMaterialGroup(EMPTY_PROJECT_MATERIALS, "rules", group("no humans"));
		expect(next.rules.body).toBe("no humans");
		expect(EMPTY_PROJECT_MATERIALS.rules).toEqual(EMPTY_MATERIAL_GROUP);
	});
});

describe("element paths", () => {
	test("one stable path per group", () => {
		expect(MATERIAL_GROUPS.map((g) => MATERIAL_ELEMENT_PATHS[g])).toEqual([
			"materials.story",
			"materials.visual",
			"materials.voice",
			"materials.rules",
		]);
	});
});

describe("materialsFromLegacy", () => {
	test("routed direction channels land in their groups", () => {
		const materials = materialsFromLegacy({
			direction: {
				raw: "everything mixed",
				story: "hopeful",
				visual: "stickman",
				voice: "slow female",
				rules: "",
			},
		});
		expect(materials.story.body).toBe("hopeful");
		expect(materials.visual.body).toBe("stickman");
		expect(materials.voice.body).toBe("slow female");
	});

	test("unrouted raw direction is not folded into any group", () => {
		const materials = materialsFromLegacy({
			direction: {
				raw: "calm tone, stickman, slow narrator",
				story: "",
				visual: "",
				voice: "",
				rules: "",
			},
		});
		expect(isEmptyMaterials(materials)).toBe(true);
	});

	test("legacy projectReferences prompt becomes visual material, not story", () => {
		const materials = materialsFromLegacy({
			projectReferences: { prompt: "keep the logo exact", entityIds: ["e1"] },
		});
		expect(materials.visual.body).toBe("keep the logo exact");
		expect(materials.visual.assetIds).toEqual(["e1"]);
		expect(materials.story.body).toBe("");
	});

	test("four-bucket project references normalise into visual assets", () => {
		const materials = materialsFromLegacy({
			projectReferences: {
				prompt: "",
				imageIds: ["e1"],
				productIds: ["prod_2"],
				mediaAssetIds: ["refmedia:e1"],
			},
		});
		expect(materials.visual.assetIds).toEqual(["e1", "prod_2"]);
	});

	test("visual direction and reference prompt both survive", () => {
		const materials = materialsFromLegacy({
			direction: { raw: "", story: "", visual: "stickman", voice: "", rules: "" },
			projectReferences: { prompt: "keep the logo exact", entityIds: [] },
		});
		expect(materials.visual.body).toBe("stickman\n\nkeep the logo exact");
	});

	test("style bible loads unlocked so regeneration may still replace it", () => {
		const materials = materialsFromLegacy({ styleBible: "flat vector, muted palette" });
		expect(materials.styleBible).toEqual({ body: "flat vector, muted palette", locked: false });
	});

	test("rules start empty because no legacy field expressed a constraint", () => {
		const materials = materialsFromLegacy({
			direction: { raw: "x", story: "a", visual: "b", voice: "c", rules: "" },
		});
		expect(materials.rules).toEqual(EMPTY_MATERIAL_GROUP);
	});
});

describe("resolveProjectMaterials", () => {
	test("populated materials win over legacy fields", () => {
		const materials = resolveProjectMaterials(
			{ visual: { body: "new look", assetIds: [], materialId: null } },
			{ direction: { raw: "", story: "", visual: "old look", voice: "", rules: "" } },
		);
		expect(materials.visual.body).toBe("new look");
	});

	test("an empty materials object still falls back to legacy fields", () => {
		const materials = resolveProjectMaterials(EMPTY_PROJECT_MATERIALS, {
			direction: { raw: "", story: "", visual: "old look", voice: "", rules: "" },
		});
		expect(materials.visual.body).toBe("old look");
	});

	test("a project with neither reads as empty", () => {
		expect(resolveProjectMaterials(undefined, {})).toEqual(EMPTY_PROJECT_MATERIALS);
	});
});

describe("directionFromMaterials", () => {
	const materials = {
		...EMPTY_PROJECT_MATERIALS,
		story: group("hopeful finance drama"),
		visual: group("stickman on white"),
		voice: group("slow female narrator"),
		rules: group("no captions"),
	};

	test("each group lands on its own channel", () => {
		const direction = directionFromMaterials(materials);
		expect(direction.story).toBe("hopeful finance drama");
		expect(direction.visual).toBe("stickman on white");
		expect(direction.voice).toBe("slow female narrator");
		expect(direction.rules).toBe("no captions");
	});

	/* `raw` exists to be split by the router. Materials are already routed, so
	 * leaving text there would invite a second, contradictory split. */
	test("raw is emptied so nothing re-routes what is already routed", () => {
		expect(directionFromMaterials(materials).raw).toBe("");
	});

	test("the style bible layers with visual, not on a channel of its own", () => {
		const withBible = {
			...materials,
			styleBible: { body: "flat vector, muted palette", locked: false },
		};
		const direction = directionFromMaterials(withBible);
		expect(direction.visual).toBe("stickman on white\n\nflat vector, muted palette");
		expect(direction.story).not.toContain("flat vector");
	});

	test("an edited style guide is used as saved, without rewriting", () => {
		const withBible = {
			...materials,
			styleBible: { body: "exact saved style guide sentence", locked: true },
		};
		expect(directionFromMaterials(withBible).visual).toContain("exact saved style guide sentence");
	});

	test("a style bible with no visual material still reaches the visual channel", () => {
		const bibleOnly = {
			...EMPTY_PROJECT_MATERIALS,
			styleBible: { body: "flat vector", locked: true },
		};
		expect(directionFromMaterials(bibleOnly).visual).toBe("flat vector");
	});

	test("empty materials produce empty channels", () => {
		expect(directionFromMaterials(EMPTY_PROJECT_MATERIALS)).toEqual({
			raw: "",
			story: "",
			visual: "",
			voice: "",
			rules: "",
		});
	});

	test("hasRoutableMaterials gates whether the conversion is worth doing", () => {
		expect(hasRoutableMaterials(EMPTY_PROJECT_MATERIALS)).toBe(false);
		expect(hasRoutableMaterials(materials)).toBe(true);
	});
});
