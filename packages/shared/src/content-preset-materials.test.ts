import { describe, expect, test } from "vite-plus/test";
import {
	contentPresetBundleSchema,
	presetLegacyMaterialSources,
	presetVideoTemplateId,
} from "./content-preset.ts";
import { EMPTY_PRESET_MATERIAL_SELECTION } from "./material-record.ts";
import { materialsFromLegacy } from "./project-materials.ts";

/* A preset row written before Project Materials shipped. Every field here is one
 * the bundle no longer presents to operators; all of them must still load. */
const LEGACY_BUNDLE = {
	style: null,
	projectRefs: { prompt: "keep the logo exact", imageIds: ["e1"], productIds: ["prod_2"] },
	settings: { aspectRatio: "9:16", timelineTemplateId: "tpl-finance" },
	pacingDevices: { zoom: true },
	infographicStyle: { accent: "#f00" },
	direction: {
		raw: "calm and hopeful",
		story: "hopeful",
		visual: "stickman",
		voice: "slow female",
	},
};

describe("preset bundle gains materials and a video template", () => {
	test("a bundle with neither field defaults to naming nothing", () => {
		const bundle = contentPresetBundleSchema.parse({});
		expect(bundle.materials).toEqual(EMPTY_PRESET_MATERIAL_SELECTION);
		expect(bundle.videoTemplateId).toBeNull();
	});

	test("materials are named by id, not embedded as bodies", () => {
		const bundle = contentPresetBundleSchema.parse({ materials: { visual: "m1", rules: "m2" } });
		expect(bundle.materials).toEqual({ story: null, visual: "m1", voice: null, rules: "m2" });
	});

	test("rejects an unknown material group", () => {
		expect(contentPresetBundleSchema.safeParse({ materials: { style: "m1" } }).success).toBe(false);
	});
});

describe("legacy preset rows still load", () => {
	test("a pre-materials bundle parses without loss", () => {
		const bundle = contentPresetBundleSchema.parse(LEGACY_BUNDLE);
		expect(bundle.pacingDevices).toEqual({ zoom: true });
		expect(bundle.infographicStyle).toEqual({ accent: "#f00" });
		expect(bundle.direction?.visual).toBe("stickman");
	});

	test("a pre-materials bundle names no materials", () => {
		const bundle = contentPresetBundleSchema.parse(LEGACY_BUNDLE);
		expect(bundle.materials).toEqual(EMPTY_PRESET_MATERIAL_SELECTION);
	});

	test("its template selection is read from the settings blob", () => {
		expect(presetVideoTemplateId(contentPresetBundleSchema.parse(LEGACY_BUNDLE))).toBe(
			"tpl-finance",
		);
	});

	test("an explicit template id wins over the settings blob", () => {
		const bundle = contentPresetBundleSchema.parse({
			...LEGACY_BUNDLE,
			videoTemplateId: "tpl-new",
		});
		expect(presetVideoTemplateId(bundle)).toBe("tpl-new");
	});

	test("a bundle selecting no template anywhere reads as null", () => {
		expect(presetVideoTemplateId(contentPresetBundleSchema.parse({}))).toBeNull();
	});

	test("its direction and refs load into materials by group", () => {
		const bundle = contentPresetBundleSchema.parse(LEGACY_BUNDLE);
		const materials = materialsFromLegacy(presetLegacyMaterialSources(bundle));
		expect(materials.story.body).toBe("hopeful");
		expect(materials.voice.body).toBe("slow female");
		expect(materials.visual.body).toBe("stickman\n\nkeep the logo exact");
		expect(materials.visual.assetIds).toEqual(["e1", "prod_2"]);
	});

	test("its unrouted raw direction does not leak into a group", () => {
		const bundle = contentPresetBundleSchema.parse({
			direction: { raw: "calm and hopeful", story: "", visual: "", voice: "" },
		});
		const materials = materialsFromLegacy(presetLegacyMaterialSources(bundle));
		expect(materials.story.body).toBe("");
		expect(materials.visual.body).toBe("");
	});
});
