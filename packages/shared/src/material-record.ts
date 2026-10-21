import { z } from "zod";
import { libraryFixtureFieldsSchema } from "./library-fixture.ts";
import {
	MATERIAL_GROUPS,
	type MaterialGroup,
	type MaterialGroupValue,
	visualMaterialReferenceSchema,
} from "./project-materials.ts";

/* A reusable material: named, workspace-scoped generation context an operator can
 * select into any project, and that a Project Preset names per group.
 *
 * A record is scoped to ONE group. A "story material" and a "visual material" are
 * not interchangeable — they route to different stages — so a single record that
 * spanned groups would either have to be split at selection time or would smuggle
 * visual text into research. Scoping at the record makes the group a property of
 * the thing being reused rather than of where it happened to be dropped.
 *
 * Presets name material ids; projects store a resolved VALUE plus the id. That
 * asymmetry is deliberate: a preset is a recipe and should follow its material as
 * it is edited, while a project created three weeks ago must not silently change
 * what it generated from.
 */

export const materialRecordInputSchema = z
	.object({
		name: z.string().trim().min(1).max(80),
		description: z.string().trim().max(240).default(""),
		group: z.enum(MATERIAL_GROUPS),
		body: z.string().trim().max(8000).default(""),
		assetIds: z.array(z.string().min(1)).default([]),
		referenceSettings: z.array(visualMaterialReferenceSchema).default([]),
	})
	.strict();

export const materialRecordSchema = materialRecordInputSchema
	.extend({
		id: z.string().min(1),
		/* The owning tenant. On the READ shape only: a caller never chooses which
		 * workspace it writes into, the route does, from the request it authenticated.
		 * Accepting it on the input shape would make cross-tenant writes a matter of
		 * sending the right JSON. */
		/* Fixture Materials are the exception to `min(1)`: they live in the reserved
		 * empty workspace so one row can serve every workspace, which is what lets a
		 * global preset bundle name a material id at all. */
		workspace: z.string(),
		createdAt: z.number().int().nonnegative(),
		updatedAt: z.number().int().nonnegative(),
	})
	.extend(libraryFixtureFieldsSchema.shape);

type ParsedMaterialRecordInput = z.infer<typeof materialRecordInputSchema>;
type ParsedMaterialRecord = z.infer<typeof materialRecordSchema>;
export type MaterialRecordInput = Omit<ParsedMaterialRecordInput, "referenceSettings"> & {
	referenceSettings?: ParsedMaterialRecordInput["referenceSettings"];
};
export type MaterialRecord = Omit<ParsedMaterialRecord, "referenceSettings"> & {
	referenceSettings?: ParsedMaterialRecord["referenceSettings"];
};

/** The project-side value a record supplies, tagged with the record it came from. */
export function materialValueFromRecord(record: MaterialRecord): MaterialGroupValue {
	return {
		body: record.body,
		assetIds: [...record.assetIds],
		referenceSettings: [...(record.referenceSettings ?? [])],
		materialId: record.id,
	};
}

/** The record fields a project-local value would save back as. Name and description
 *  are the caller's: a value has no name until someone gives it one. */
export function materialRecordFromValue(
	value: MaterialGroupValue,
	group: MaterialGroup,
	name: string,
	description = "",
): MaterialRecordInput {
	return {
		name: name.trim(),
		description: description.trim(),
		group,
		body: value.body,
		assetIds: [...value.assetIds],
		referenceSettings: [...(value.referenceSettings ?? [])],
	};
}

/** Which reusable material a Project Preset names per group. Null means the preset
 *  supplies that group inline (or not at all) rather than pointing at a record. */
export const presetMaterialSelectionSchema = z
	.object({
		story: z.string().min(1).nullable().default(null),
		visual: z.string().min(1).nullable().default(null),
		voice: z.string().min(1).nullable().default(null),
		rules: z.string().min(1).nullable().default(null),
	})
	.strict();

export type PresetMaterialSelection = z.infer<typeof presetMaterialSelectionSchema>;

export const EMPTY_PRESET_MATERIAL_SELECTION: PresetMaterialSelection = {
	story: null,
	visual: null,
	voice: null,
	rules: null,
};

/** The material ids a preset names, in stable group order, skipping unset groups. */
export function selectedMaterialIds(selection: PresetMaterialSelection): string[] {
	return MATERIAL_GROUPS.map((group) => selection[group]).filter((id): id is string => Boolean(id));
}
