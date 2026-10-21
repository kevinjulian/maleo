/* Seeding a project's materials and Video Template from a Project Preset.
 *
 *     Project Preset = Project Materials + Video Template
 *
 * A preset NAMES materials by id; a project stores their resolved VALUE. The
 * asymmetry is deliberate: a preset is a recipe and should follow its material as
 * it is edited, while a project created three weeks ago must not silently change
 * what it generated from. Resolution therefore happens once, at seed time.
 *
 * Provenance rides in the existing element-source sidecar under
 * `MATERIAL_ELEMENT_PATHS`, so materials obey the same precedence rules as every
 * other seeded element rather than inventing a second set. In particular:
 * eligibility to be re-seeded is decided by the RECORDED SOURCE, never by
 * comparing values — a group whose text happens to equal what a preset supplies is
 * still the operator's if they typed it.
 */
import {
	EMPTY_MATERIAL_GROUP,
	EMPTY_PROJECT_MATERIALS,
	MATERIAL_ELEMENT_PATHS,
	MATERIAL_GROUPS,
	OPERATOR_LAYER,
	defaulterSource,
	isEmptyMaterialGroup,
	materialValueFromRecord,
	operatorSource,
	presetVideoTemplateId,
	seedableFrom,
	type ContentPreset,
	type ElementSource,
	type MaterialGroup,
	type MaterialGroupValue,
	type MaterialRecord,
	type ProjectMaterials,
} from "@maleo/shared";
import { withSource, type ElementSourceMap } from "@models/presets/element-sources.ts";

/** What a preset seeds, and what recorded it. */
export interface MaterialsSeed {
	materials: ProjectMaterials;
	/** "" when the preset selects no Video Template. */
	videoTemplateId: string;
	sources: ElementSourceMap;
}

export interface SeedOptions {
	/** Replace groups the operator already owns. Off by default: preserving
	 *  project-local edits is what makes changing a preset safe. */
	overwriteOperatorEdits?: boolean;
}

/** The material id a preset names for a group, if any.
 *
 *  `bundle.materials` carries a schema default, so a PARSED preset always has it.
 *  A preset that reached the client as raw JSON need not: the bundle is explicitly
 *  backward-compatible with "rows written before materials existed", and indexing
 *  through the absent object threw during render rather than reading as "this
 *  preset names nothing". Absent is a legitimate shape here, so it answers
 *  undefined instead of crashing. */
function presetMaterialId(
	preset: ContentPreset | null,
	group: MaterialGroup,
): string | null | undefined {
	return preset?.bundle?.materials?.[group];
}

/* Resolve one preset group to a value, or null when the preset names nothing for it or
 * names a material that has since been deleted. A missing material seeds NOTHING rather
 * than an empty group: blanking a group because a library row was removed would look
 * like the preset supplied emptiness on purpose.
 *
 * There is one path now. Shipped presets used to fall back to material text inlined in
 * the preset definition, because their materials were not records; they name real
 * fixture Material rows today, so they resolve exactly like an operator's preset. */
function resolveGroup(
	preset: ContentPreset,
	group: MaterialGroup,
	byId: ReadonlyMap<string, MaterialRecord>,
): MaterialGroupValue | null {
	const materialId = presetMaterialId(preset, group);
	if (!materialId) return null;
	const record = byId.get(materialId);
	return record ? materialValueFromRecord(record) : null;
}

/* May a preset fill this group?
 *
 * `seedableFrom` alone says no for a group with no recorded source, because an
 * ABSENT source reads as operator-owned — the right default for a project written
 * before provenance existed, where the alternative is wiping real work on the
 * strength of not knowing. But it is the wrong answer for a group that is simply
 * EMPTY: there is nothing there to protect, and refusing to seed it would mean a
 * brand-new project ignored the preset it was created from.
 *
 * So emptiness is the one thing checked by value. That is not the value comparison
 * provenance exists to remove: that bug was treating a POPULATED value as inherited
 * because it matched a default. An empty group has nothing to mistake. */
function seedable(current: MaterialGroupValue, source: ElementSource | undefined): boolean {
	if (!source) return isEmptyMaterialGroup(current);
	return seedableFrom(source, "project-preset");
}

/** Seed materials and the Video Template from a preset.
 *
 *  `current` and `sources` are the project's state so far, so a create form that
 *  has already been edited keeps those edits unless the caller opts in. */
export function seedMaterialsFromPreset(
	preset: ContentPreset,
	library: readonly MaterialRecord[],
	current: ProjectMaterials = EMPTY_PROJECT_MATERIALS,
	sources: ElementSourceMap = {},
	options: SeedOptions = {},
): MaterialsSeed {
	const byId = new Map(library.map((record) => [record.id, record]));
	const source = defaulterSource("project-preset", preset.id);
	let nextMaterials = { ...current };
	let nextSources = sources;

	for (const group of MATERIAL_GROUPS) {
		const value = resolveGroup(preset, group, byId);
		if (!value) continue;
		if (
			!options.overwriteOperatorEdits &&
			!seedable(current[group], sources[MATERIAL_ELEMENT_PATHS[group]])
		)
			continue;
		nextMaterials = { ...nextMaterials, [group]: value };
		nextSources = withSource(nextSources, MATERIAL_ELEMENT_PATHS[group], source);
	}

	return {
		materials: nextMaterials,
		videoTemplateId: presetVideoTemplateId(preset.bundle) ?? "",
		sources: nextSources,
	};
}

/** The state after the operator removes the selected preset: nothing supplies the
 *  materials any more, so both the values and their sources go. */
export function clearedMaterialsSeed(sources: ElementSourceMap = {}): MaterialsSeed {
	let nextSources = sources;
	for (const group of MATERIAL_GROUPS) {
		const { [MATERIAL_ELEMENT_PATHS[group]]: _dropped, ...rest } = nextSources;
		nextSources = rest;
	}
	return { materials: EMPTY_PROJECT_MATERIALS, videoTemplateId: "", sources: nextSources };
}

/* Two operator actions, two sources.
 *
 * SELECTING a reusable material and EDITING the text are both "the operator did
 * this", so both record the operator layer — but they are not the same claim. A
 * selected material is still faithful to the library row; an edited one has
 * diverged from it. The UI has to tell them apart or a badge reading "From
 * material" survives the edit that made it false.
 *
 * The distinction rides in `defaulterId`, which already means "which defaulter
 * supplied this": a selection names the material, an edit names nothing. The
 * alternative — comparing the value against the library row — would work, but it
 * needs the library at every render and gives the wrong answer while it loads,
 * which is exactly the window an operator is most likely to be looking. */

/** The operator picked a reusable material for this group. */
/** A materials edit: the groups after the change, and where each element now
 *  comes from. The two travel together — a group that changes owner has to move
 *  its source with it — which is why all three editors return the pair. */
export interface MaterialsEdit {
	materials: ProjectMaterials;
	sources: ElementSourceMap;
}

export function selectMaterialGroup(
	materials: ProjectMaterials,
	sources: ElementSourceMap,
	group: MaterialGroup,
	value: MaterialGroupValue,
): MaterialsEdit {
	return {
		materials: { ...materials, [group]: value },
		// `defaulterId` is null when the selection is "project only" (no material),
		// which is the same state a hand-typed value has, and correctly so.
		sources: withSource(
			sources,
			MATERIAL_ELEMENT_PATHS[group],
			defaulterSource(OPERATOR_LAYER, value.materialId),
		),
	};
}

/** The operator edited this group's content by hand.
 *
 *  `value.materialId` is deliberately PRESERVED. The group has diverged from the
 *  material but still came from it, and keeping the link is what lets the UI say
 *  so and offer a way back. What changes is the recorded source: nothing supplies
 *  this value any more. */
export function overrideMaterialGroup(
	materials: ProjectMaterials,
	sources: ElementSourceMap,
	group: MaterialGroup,
	value: MaterialGroupValue,
): MaterialsEdit {
	return {
		materials: { ...materials, [group]: value },
		sources: withSource(sources, MATERIAL_ELEMENT_PATHS[group], operatorSource()),
	};
}

/** True when the operator owns this group AND a preset could supply it — the exact
 *  condition under which "reset to preset" has something to restore. */
export function canResetToPreset(
	preset: ContentPreset | null,
	sources: ElementSourceMap,
	group: MaterialGroup,
): boolean {
	if (!preset || !presetMaterialId(preset, group)) return false;
	return sources[MATERIAL_ELEMENT_PATHS[group]]?.layer === "operator";
}

/** Restore one group to what the preset supplies. Returns the inputs unchanged
 *  when the preset names no material for the group or that material is gone —
 *  a reset that quietly blanked the group would be worse than no reset. */
export function resetMaterialGroupToPreset(
	preset: ContentPreset,
	library: readonly MaterialRecord[],
	materials: ProjectMaterials,
	sources: ElementSourceMap,
	group: MaterialGroup,
): MaterialsEdit {
	const byId = new Map(library.map((record) => [record.id, record]));
	const value = resolveGroup(preset, group, byId);
	if (!value) return { materials, sources };
	return {
		materials: { ...materials, [group]: value },
		sources: withSource(
			sources,
			MATERIAL_ELEMENT_PATHS[group],
			defaulterSource("project-preset", preset.id),
		),
	};
}

/** The source recorded for a group, or undefined when none is. */
export function materialSourceFor(
	sources: ElementSourceMap,
	group: MaterialGroup,
): ElementSource | undefined {
	return sources[MATERIAL_ELEMENT_PATHS[group]];
}

/** How a group's origin reads in the UI. Derived from the recorded source and the
 *  value's own `materialId`, so no surface has to infer it from the text. */
export type MaterialOrigin = "preset" | "material" | "modified-material" | "project" | "empty";

export function materialOrigin(
	value: MaterialGroupValue,
	source: ElementSource | undefined,
): MaterialOrigin {
	if (source?.layer === "project-preset") return "preset";
	/* A material still faithful to its library row: the operator selected it and
	 * the source records WHICH one. An edit clears `defaulterId` while keeping
	 * `materialId` on the value, so the two states are distinguishable and the
	 * badge cannot claim clean inheritance for a value that has diverged. */
	if (value.materialId)
		return source?.defaulterId === value.materialId ? "material" : "modified-material";
	if (value.body.trim() || value.assetIds.length > 0) return "project";
	return "empty";
}

/** The label a scan row shows for an origin. */
export function materialOriginLabel(origin: MaterialOrigin): string {
	switch (origin) {
		case "preset":
			return "From preset";
		case "material":
			return "From material";
		case "modified-material":
			return "Modified from material";
		case "project":
			return "Project only";
		case "empty":
			return "Not set";
	}
}

/** True when the group has diverged from the reusable material it came from —
 *  the condition under which "revert to material" has something to restore. */
export function isModifiedFromMaterial(
	value: MaterialGroupValue,
	source: ElementSource | undefined,
): boolean {
	return materialOrigin(value, source) === "modified-material";
}

export { EMPTY_MATERIAL_GROUP };
