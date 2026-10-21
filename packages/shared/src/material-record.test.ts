import { describe, expect, test } from "vite-plus/test";
import {
	EMPTY_PRESET_MATERIAL_SELECTION,
	materialRecordFromValue,
	materialRecordInputSchema,
	materialRecordSchema,
	materialValueFromRecord,
	presetMaterialSelectionSchema,
	selectedMaterialIds,
} from "./material-record.ts";

const record = {
	id: "m1",
	workspace: "default",
	name: "House visual",
	description: "brand look",
	group: "visual" as const,
	body: "stickman on white",
	assetIds: ["e1", "e2"],
	createdAt: 1,
	updatedAt: 2,
};

describe("materialRecordInputSchema", () => {
	test("requires a name", () => {
		expect(materialRecordInputSchema.safeParse({ name: "  ", group: "story" }).success).toBe(false);
	});

	test("requires a known group", () => {
		expect(materialRecordInputSchema.safeParse({ name: "x", group: "style" }).success).toBe(false);
	});

	test("defaults body, description and assets", () => {
		expect(materialRecordInputSchema.parse({ name: "x", group: "rules" })).toEqual({
			name: "x",
			description: "",
			group: "rules",
			body: "",
			assetIds: [],
			referenceSettings: [],
		});
	});

	test("rejects unknown keys", () => {
		expect(
			materialRecordInputSchema.safeParse({ name: "x", group: "rules", style: {} }).success,
		).toBe(false);
	});
});

describe("materialValueFromRecord", () => {
	test("tags the value with the record it came from", () => {
		expect(materialValueFromRecord(materialRecordSchema.parse(record))).toEqual({
			body: "stickman on white",
			assetIds: ["e1", "e2"],
			referenceSettings: [],
			materialId: "m1",
		});
	});

	test("copies assets so editing the value cannot mutate the record", () => {
		const parsed = materialRecordSchema.parse(record);
		const value = materialValueFromRecord(parsed);
		value.assetIds.push("e3");
		expect(parsed.assetIds).toEqual(["e1", "e2"]);
	});
});

describe("materialRecordFromValue", () => {
	test("carries the value across and takes its name from the caller", () => {
		const input = materialRecordFromValue(
			{ body: "no captions", assetIds: [], referenceSettings: [], materialId: null },
			"rules",
			"  House rules  ",
		);
		expect(input).toEqual({
			name: "House rules",
			description: "",
			group: "rules",
			body: "no captions",
			assetIds: [],
			referenceSettings: [],
		});
	});

	test("produces a valid record input", () => {
		const input = materialRecordFromValue(
			{ body: "x", assetIds: ["e1"], referenceSettings: [], materialId: "m9" },
			"story",
			"Notes",
			"src",
		);
		expect(materialRecordInputSchema.safeParse(input).success).toBe(true);
	});
});

describe("presetMaterialSelectionSchema", () => {
	test("every group defaults to naming no record", () => {
		expect(presetMaterialSelectionSchema.parse({})).toEqual(EMPTY_PRESET_MATERIAL_SELECTION);
	});

	test("selectedMaterialIds skips unset groups and keeps group order", () => {
		const selection = presetMaterialSelectionSchema.parse({ visual: "m2", story: "m1" });
		expect(selectedMaterialIds(selection)).toEqual(["m1", "m2"]);
	});

	test("an empty selection names nothing", () => {
		expect(selectedMaterialIds(EMPTY_PRESET_MATERIAL_SELECTION)).toEqual([]);
	});
});
