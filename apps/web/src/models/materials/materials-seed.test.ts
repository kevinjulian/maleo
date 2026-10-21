/* Seeding materials and the Video Template from a Project Preset.
 *
 * The assertions that matter are the negative ones: what seeding does NOT touch.
 * Eligibility is decided by the recorded source, never by comparing values, so a
 * group whose text happens to equal the preset's is still the operator's. */
import { describe, expect, test } from "vite-plus/test";
import {
	EMPTY_PROJECT_MATERIALS,
	MATERIAL_ELEMENT_PATHS,
	MATERIAL_FIXTURES,
	MATERIAL_GROUPS,
	defaulterSource,
	findPresetFixture,
	operatorSource,
	materialValueFromRecord,
	presetBundle,
	type ContentPreset,
	type MaterialGroup,
	type MaterialRecord,
	type PresetMaterialSelection,
} from "@maleo/shared";
import {
	canResetToPreset,
	clearedMaterialsSeed,
	materialOrigin,
	materialOriginLabel,
	isModifiedFromMaterial,
	overrideMaterialGroup,
	resetMaterialGroupToPreset,
	selectMaterialGroup,
	seedMaterialsFromPreset,
} from "./materials-seed.ts";

function material(id: string, group: MaterialRecord["group"], body: string): MaterialRecord {
	return {
		id,
		workspace: "default",
		name: `${group} ${id}`,
		description: "",
		group,
		body,
		assetIds: [`asset-${id}`],
		slug: id,
		source: "user",
		retired: false,
		createdAt: 0,
		updatedAt: 0,
	};
}

/* A shipped preset seeds through the SAME id-based path as an operator's, because its
 * materials are fixture Material rows now. They used to be text inlined in the preset
 * definition, resolved by a fallback that no longer exists — which is what made a
 * built-in look like it contained nothing when inspected in the library. */
const FIXTURE = findPresetFixture("animated-systems-explainer")!;

/** The fixture Materials as the rows bootstrap turns them into. Ids are local, so the
 *  test assigns its own — exactly as a database would. */
const FIXTURE_LIBRARY: MaterialRecord[] = MATERIAL_FIXTURES.filter((fixture) =>
	Object.values(FIXTURE.materialSlugs).includes(fixture.slug),
).map((fixture) => ({
	id: `local-${fixture.slug}`,
	workspace: "",
	name: fixture.name,
	description: fixture.description,
	group: fixture.group,
	body: fixture.body,
	assetIds: [],
	slug: fixture.slug,
	source: "fixture" as const,
	retired: false,
	createdAt: 0,
	updatedAt: 0,
}));

/** The material ids a bootstrapped fixture preset names, per group. */
function fixtureMaterialIds(
	overrides: Partial<Record<MaterialGroup, string | null>> = {},
): PresetMaterialSelection {
	const base = { story: null, visual: null, voice: null, rules: null } as PresetMaterialSelection;
	for (const group of MATERIAL_GROUPS) {
		const slug = FIXTURE.materialSlugs[group];
		base[group] = slug ? `local-${slug}` : null;
	}
	return { ...base, ...overrides };
}

/** The fixture preset as bootstrap stores it: slugs resolved to local ids. */
function fixturePreset(materials: PresetMaterialSelection = fixtureMaterialIds()): ContentPreset {
	return preset({ ...FIXTURE.bundle, materials, videoTemplateId: "local-template" });
}

const LIBRARY: MaterialRecord[] = [
	material("m-story", "story", "hopeful finance drama"),
	material("m-visual", "visual", "stickman on white"),
	material("m-voice", "voice", "slow female narrator"),
	material("m-rules", "rules", "no captions"),
];

function preset(overrides: Partial<ContentPreset["bundle"]> = {}, id = "cp-1"): ContentPreset {
	return {
		id,
		name: "House",
		description: "",
		slug: id,
		source: "user",
		retired: false,
		createdAt: 0,
		updatedAt: 0,
		bundle: presetBundle({
			materials: { story: "m-story", visual: "m-visual", voice: "m-voice", rules: "m-rules" },
			videoTemplateId: "tpl-1",
			...overrides,
		}),
	};
}

describe("seedMaterialsFromPreset", () => {
	test("auto-selects every group the preset names, and its video template", () => {
		const seed = seedMaterialsFromPreset(preset(), LIBRARY);
		expect(seed.materials.story.body).toBe("hopeful finance drama");
		expect(seed.materials.visual.body).toBe("stickman on white");
		expect(seed.materials.voice.body).toBe("slow female narrator");
		expect(seed.materials.rules.body).toBe("no captions");
		expect(seed.videoTemplateId).toBe("tpl-1");
	});

	test("each seeded group records the preset that supplied it", () => {
		const seed = seedMaterialsFromPreset(preset(), LIBRARY);
		expect(seed.sources[MATERIAL_ELEMENT_PATHS.visual]).toEqual(
			defaulterSource("project-preset", "cp-1"),
		);
	});

	test("a seeded value carries the material id it resolved to", () => {
		const seed = seedMaterialsFromPreset(preset(), LIBRARY);
		expect(seed.materials.visual.materialId).toBe("m-visual");
		expect(seed.materials.visual.assetIds).toEqual(["asset-m-visual"]);
	});

	test("a group the preset names nothing for is left alone", () => {
		const seed = seedMaterialsFromPreset(
			preset({ materials: { story: "m-story", visual: null, voice: null, rules: null } }),
			LIBRARY,
		);
		expect(seed.materials.visual.body).toBe("");
		expect(seed.sources[MATERIAL_ELEMENT_PATHS.visual]).toBeUndefined();
	});

	/* A deleted library row must not read as "the preset supplies emptiness". */
	test("a named material that no longer exists seeds nothing rather than blanking", () => {
		const current = {
			...EMPTY_PROJECT_MATERIALS,
			visual: { body: "mine", assetIds: [], materialId: null },
		};
		const seed = seedMaterialsFromPreset(
			preset({ materials: { story: null, visual: "gone", voice: null, rules: null } }),
			LIBRARY,
			current,
		);
		expect(seed.materials.visual.body).toBe("mine");
	});

	test("a preset selecting no video template seeds an empty selection", () => {
		expect(
			seedMaterialsFromPreset(preset({ videoTemplateId: null }), LIBRARY).videoTemplateId,
		).toBe("");
	});

	test("it reads the legacy settings template id when no explicit one is set", () => {
		const legacy = preset({
			videoTemplateId: null,
			settings: { timelineTemplateId: "tpl-legacy" },
		});
		expect(seedMaterialsFromPreset(legacy, LIBRARY).videoTemplateId).toBe("tpl-legacy");
	});

	test("a fixture preset seeds every group from the fixture Materials it names", () => {
		const seed = seedMaterialsFromPreset(fixturePreset(), FIXTURE_LIBRARY);
		expect(seed.materials.story.body).toContain("systems-explainer");
		expect(seed.materials.visual.body).toContain("flat editorial animation");
		expect(seed.materials.voice.body).toContain("calm, precise");
		expect(seed.materials.rules.body).toContain("Do not imitate");
		// The seeded group carries the material record's identity, which the virtual
		// path could never supply.
		expect(seed.materials.visual.materialId).toBe(`local-${FIXTURE.materialSlugs.visual}`);
		expect(seed.videoTemplateId).toBe("local-template");
		expect(seed.sources[MATERIAL_ELEMENT_PATHS.rules]).toEqual(
			defaulterSource("project-preset", "cp-1"),
		);
	});

	test("a fixture preset seeds nothing for a group whose material is gone", () => {
		// A missing record seeds NOTHING rather than an empty group: there is no inline
		// fallback behind it any more, and blanking the group would look deliberate.
		const seed = seedMaterialsFromPreset(
			fixturePreset(),
			FIXTURE_LIBRARY.filter((m) => m.group !== "rules"),
		);
		expect(seed.materials.rules.body).toBe("");
		expect(seed.materials.story.body).toContain("systems-explainer");
	});

	test("overriding one group leaves the other fixture materials alone", () => {
		const seed = seedMaterialsFromPreset(
			fixturePreset(fixtureMaterialIds({ visual: "m-visual" })),
			[...FIXTURE_LIBRARY, ...LIBRARY],
		);
		expect(seed.materials.visual.body).toBe("stickman on white");
		expect(seed.materials.visual.materialId).toBe("m-visual");
		expect(seed.materials.story.body).toContain("systems-explainer");
	});
});

describe("seeding respects recorded provenance", () => {
	test("an operator-owned group is preserved by default", () => {
		const current = {
			...EMPTY_PROJECT_MATERIALS,
			visual: { body: "mine", assetIds: [], materialId: null },
		};
		const sources = { [MATERIAL_ELEMENT_PATHS.visual]: operatorSource() };
		const seed = seedMaterialsFromPreset(preset(), LIBRARY, current, sources);
		expect(seed.materials.visual.body).toBe("mine");
		expect(seed.materials.story.body).toBe("hopeful finance drama");
	});

	test("opting in replaces the operator's group and records the preset", () => {
		const current = {
			...EMPTY_PROJECT_MATERIALS,
			visual: { body: "mine", assetIds: [], materialId: null },
		};
		const sources = { [MATERIAL_ELEMENT_PATHS.visual]: operatorSource() };
		const seed = seedMaterialsFromPreset(preset(), LIBRARY, current, sources, {
			overwriteOperatorEdits: true,
		});
		expect(seed.materials.visual.body).toBe("stickman on white");
		expect(seed.sources[MATERIAL_ELEMENT_PATHS.visual]).toEqual(
			defaulterSource("project-preset", "cp-1"),
		);
	});

	/* The bug provenance exists to remove: a value that happens to match must not
	 * be treated as inherited. */
	test("eligibility is not decided by value comparison", () => {
		const current = {
			...EMPTY_PROJECT_MATERIALS,
			visual: { body: "stickman on white", assetIds: [], materialId: null },
		};
		const sources = { [MATERIAL_ELEMENT_PATHS.visual]: operatorSource() };
		const seed = seedMaterialsFromPreset(preset(), LIBRARY, current, sources);
		expect(seed.materials.visual.materialId).toBeNull();
		expect(seed.sources[MATERIAL_ELEMENT_PATHS.visual]).toEqual(operatorSource());
	});

	test("a group a preset already supplied is refreshed by re-applying the preset", () => {
		const sources = { [MATERIAL_ELEMENT_PATHS.visual]: defaulterSource("project-preset", "cp-1") };
		const seed = seedMaterialsFromPreset(preset(), LIBRARY, EMPTY_PROJECT_MATERIALS, sources);
		expect(seed.materials.visual.body).toBe("stickman on white");
	});

	test("operator-owned groups are preserved over a fixture preset's materials", () => {
		const current = {
			...EMPTY_PROJECT_MATERIALS,
			visual: { body: "mine", assetIds: [], materialId: null },
		};
		const sources = { [MATERIAL_ELEMENT_PATHS.visual]: operatorSource() };
		const seed = seedMaterialsFromPreset(fixturePreset(), FIXTURE_LIBRARY, current, sources);
		expect(seed.materials.visual.body).toBe("mine");
		expect(seed.materials.story.body).toContain("systems-explainer");
	});
});

describe("overriding and resetting", () => {
	test("an override records the operator, not the preset", () => {
		const seed = seedMaterialsFromPreset(preset(), LIBRARY);
		const next = overrideMaterialGroup(seed.materials, seed.sources, "visual", {
			body: "mine",
			assetIds: [],
			materialId: null,
		});
		expect(next.sources[MATERIAL_ELEMENT_PATHS.visual]).toEqual(operatorSource());
		expect(next.materials.visual.body).toBe("mine");
	});

	test("overriding one group leaves the others on the preset", () => {
		const seed = seedMaterialsFromPreset(preset(), LIBRARY);
		const next = overrideMaterialGroup(seed.materials, seed.sources, "visual", {
			body: "mine",
			assetIds: [],
			materialId: null,
		});
		expect(next.materials.story.body).toBe("hopeful finance drama");
		expect(next.sources[MATERIAL_ELEMENT_PATHS.story]).toEqual(
			defaulterSource("project-preset", "cp-1"),
		);
	});

	test("reset is offered only for an overridden group the preset can supply", () => {
		const seed = seedMaterialsFromPreset(preset(), LIBRARY);
		expect(canResetToPreset(preset(), seed.sources, "visual")).toBe(false);
		const next = overrideMaterialGroup(seed.materials, seed.sources, "visual", {
			body: "mine",
			assetIds: [],
			materialId: null,
		});
		expect(canResetToPreset(preset(), next.sources, "visual")).toBe(true);
	});

	test("reset is offered for an overridden fixture material group", () => {
		const fixture = fixturePreset();
		const seed = seedMaterialsFromPreset(fixture, FIXTURE_LIBRARY);
		const next = overrideMaterialGroup(seed.materials, seed.sources, "rules", {
			body: "mine",
			assetIds: [],
			materialId: null,
		});
		expect(canResetToPreset(fixture, next.sources, "rules")).toBe(true);
		const reset = resetMaterialGroupToPreset(
			fixture,
			FIXTURE_LIBRARY,
			next.materials,
			next.sources,
			"rules",
		);
		expect(reset.materials.rules.body).toContain("Each scene must");
		expect(reset.sources[MATERIAL_ELEMENT_PATHS.rules]).toEqual(
			defaulterSource("project-preset", fixture.id),
		);
	});

	test("reset is not offered when no preset is selected", () => {
		const sources = { [MATERIAL_ELEMENT_PATHS.visual]: operatorSource() };
		expect(canResetToPreset(null, sources, "visual")).toBe(false);
	});

	/* A preset that reached the client as raw JSON need not carry `bundle.materials`:
	 * the bundle is deliberately backward-compatible with rows written before
	 * materials existed. Indexing through the absent object used to throw during
	 * render — "Cannot read properties of undefined (reading 'story')" — which took
	 * the whole create form down rather than reading as "names nothing". */
	test("a preset with no materials selection names nothing, rather than throwing", () => {
		const legacy = {
			...preset(),
			bundle: { ...preset().bundle, materials: undefined },
		} as unknown as ContentPreset;
		const sources = { [MATERIAL_ELEMENT_PATHS.story]: operatorSource() };
		expect(() => canResetToPreset(legacy, sources, "story")).not.toThrow();
		expect(canResetToPreset(legacy, sources, "story")).toBe(false);
	});

	test("seeding from a preset with no materials selection seeds nothing", () => {
		const legacy = {
			...preset(),
			bundle: { ...preset().bundle, materials: undefined },
		} as unknown as ContentPreset;
		expect(() => seedMaterialsFromPreset(legacy, LIBRARY)).not.toThrow();
		expect(seedMaterialsFromPreset(legacy, LIBRARY).materials).toEqual(EMPTY_PROJECT_MATERIALS);
	});

	test("reset restores the preset value and its source", () => {
		const seed = seedMaterialsFromPreset(preset(), LIBRARY);
		const overridden = overrideMaterialGroup(seed.materials, seed.sources, "visual", {
			body: "mine",
			assetIds: [],
			materialId: null,
		});
		const reset = resetMaterialGroupToPreset(
			preset(),
			LIBRARY,
			overridden.materials,
			overridden.sources,
			"visual",
		);
		expect(reset.materials.visual.body).toBe("stickman on white");
		expect(reset.sources[MATERIAL_ELEMENT_PATHS.visual]).toEqual(
			defaulterSource("project-preset", "cp-1"),
		);
	});

	test("reset with nothing to restore is a no-op rather than a blank", () => {
		const bare = preset({ materials: { story: null, visual: null, voice: null, rules: null } });
		const materials = {
			...EMPTY_PROJECT_MATERIALS,
			visual: { body: "mine", assetIds: [], materialId: null },
		};
		const reset = resetMaterialGroupToPreset(bare, LIBRARY, materials, {}, "visual");
		expect(reset.materials.visual.body).toBe("mine");
	});
});

describe("clearing the preset", () => {
	test("removing the preset drops the values and their sources", () => {
		const seed = seedMaterialsFromPreset(preset(), LIBRARY);
		const cleared = clearedMaterialsSeed(seed.sources);
		expect(cleared.materials).toEqual(EMPTY_PROJECT_MATERIALS);
		expect(cleared.videoTemplateId).toBe("");
		expect(cleared.sources[MATERIAL_ELEMENT_PATHS.visual]).toBeUndefined();
	});

	test("it leaves unrelated element sources alone", () => {
		const cleared = clearedMaterialsSeed({ "settings.aspectRatio": operatorSource() });
		expect(cleared.sources["settings.aspectRatio"]).toEqual(operatorSource());
	});
});

describe("origin labels", () => {
	test("a preset-supplied group reads as from the preset", () => {
		const seed = seedMaterialsFromPreset(preset(), LIBRARY);
		const origin = materialOrigin(
			seed.materials.visual,
			seed.sources[MATERIAL_ELEMENT_PATHS.visual],
		);
		expect(origin).toBe("preset");
		expect(materialOriginLabel(origin)).toBe("From preset");
	});

	test("an operator's pick of a library material reads as from a material", () => {
		const picked = selectMaterialGroup(
			EMPTY_PROJECT_MATERIALS,
			{},
			"visual",
			materialValueFromRecord(LIBRARY[1]!),
		);
		expect(
			materialOrigin(picked.materials.visual, picked.sources[MATERIAL_ELEMENT_PATHS.visual]),
		).toBe("material");
	});

	test("hand-typed text with no material behind it reads as project only", () => {
		expect(materialOrigin({ body: "x", assetIds: [], materialId: null }, operatorSource())).toBe(
			"project",
		);
	});

	test("an untouched empty group reads as not set", () => {
		expect(materialOrigin({ body: "", assetIds: [], materialId: null }, undefined)).toBe("empty");
	});
});

/* A badge that reads "From material" after the operator has rewritten the text
 * claims an inheritance that no longer holds. Selecting and editing are both
 * operator actions, so the layer alone cannot separate them — the selection
 * records WHICH material in `defaulterId`, and an edit clears it. */
describe("a material-backed group that has been edited", () => {
	const record = LIBRARY[1]!; // m-visual
	const picked = () =>
		selectMaterialGroup(EMPTY_PROJECT_MATERIALS, {}, "visual", materialValueFromRecord(record));
	const originOf = (state: ReturnType<typeof picked>) =>
		materialOrigin(state.materials.visual, state.sources[MATERIAL_ELEMENT_PATHS.visual]);

	test("a freshly selected material reads as faithful to it", () => {
		expect(originOf(picked())).toBe("material");
		expect(materialOriginLabel(originOf(picked()))).toBe("From material");
	});

	test("editing the body stops it claiming clean inheritance", () => {
		const p = picked();
		const edited = overrideMaterialGroup(p.materials, p.sources, "visual", {
			...p.materials.visual,
			body: "my own words",
		});
		expect(originOf(edited)).toBe("modified-material");
		expect(materialOriginLabel(originOf(edited))).toBe("Modified from material");
	});

	test("editing only the references also counts as diverged", () => {
		const p = picked();
		const edited = overrideMaterialGroup(p.materials, p.sources, "visual", {
			...p.materials.visual,
			assetIds: ["e9"],
		});
		expect(originOf(edited)).toBe("modified-material");
	});

	/* The link is KEPT across the edit. It is what lets the UI say where the value
	 * came from and offer a way back; dropping it would strand the operator. */
	test("the edited group still remembers which material it came from", () => {
		const p = picked();
		const edited = overrideMaterialGroup(p.materials, p.sources, "visual", {
			...p.materials.visual,
			body: "changed",
		});
		expect(edited.materials.visual.materialId).toBe(record.id);
		expect(
			isModifiedFromMaterial(
				edited.materials.visual,
				edited.sources[MATERIAL_ELEMENT_PATHS.visual],
			),
		).toBe(true);
	});

	test("re-selecting the same material makes it faithful again", () => {
		const p = picked();
		const edited = overrideMaterialGroup(p.materials, p.sources, "visual", {
			...p.materials.visual,
			body: "changed",
		});
		const reverted = selectMaterialGroup(
			edited.materials,
			edited.sources,
			"visual",
			materialValueFromRecord(record),
		);
		expect(originOf(reverted)).toBe("material");
		expect(reverted.materials.visual.body).toBe(record.body);
	});

	test("selecting a DIFFERENT material does not read as modified", () => {
		const p = picked();
		const other = selectMaterialGroup(
			p.materials,
			p.sources,
			"visual",
			materialValueFromRecord(LIBRARY[0]!),
		);
		expect(originOf(other)).toBe("material");
	});

	test("clearing the source leaves a hand-typed value, not a material one", () => {
		const p = picked();
		const cleared = selectMaterialGroup(p.materials, p.sources, "visual", {
			body: "typed",
			assetIds: [],
			materialId: null,
		});
		expect(originOf(cleared)).toBe("project");
	});

	/* A preset-seeded group names a material too. Preset provenance outranks the
	 * material link, because "reset to preset" is the action that applies. */
	test("a preset-seeded group still reads as from the preset", () => {
		const seeded = seedMaterialsFromPreset(preset(), LIBRARY);
		expect(
			materialOrigin(seeded.materials.visual, seeded.sources[MATERIAL_ELEMENT_PATHS.visual]),
		).toBe("preset");
	});

	test("editing a preset-seeded group that names a material reads as modified", () => {
		const seeded = seedMaterialsFromPreset(preset(), LIBRARY);
		const edited = overrideMaterialGroup(seeded.materials, seeded.sources, "visual", {
			...seeded.materials.visual,
			body: "mine",
		});
		expect(originOf(edited)).toBe("modified-material");
	});
});
