import { describe, expect, test } from "vite-plus/test";
import {
	EMPTY_PROJECT_SELECTION,
	type ContentPresetBundle,
	type ProjectSelection,
	presetBundle,
	findPresetFixture,
	type StyleKnobs,
} from "@maleo/shared";
import type { Config } from "@maleo/shared";
import { DEFAULT_PACING_DEVICES } from "./generation-defaults.ts";
import { DEFAULT_SETTINGS, type GlobalSettings } from "./creative-settings.ts";
import {
	seedConfigStyle,
	seedProjectRefs,
	seedSettings,
	seedFromPreset,
	applyPresetOverride,
	type PresetTargets,
} from "./preset-apply.ts";
import { seedFromPresetSourced, applyPresetSourced } from "./preset-apply-sourced.ts";
import { parseElementSources, type ElementSourceMap } from "./element-sources.ts";
import { AXIS_ELEMENT_PATHS, SETTINGS_ELEMENT_PATHS } from "./element-paths.ts";

const knobs = (styleId: string): StyleKnobs => findPresetFixture(styleId)!.bundle.style!;

// Knobs are data now: the bundle carries the style itself, with nothing to
// resolve it against. DOC is a real shipped knob set, used so the assertions read.
const DOC = knobs("dark-documentary");

const bundle: ContentPresetBundle = presetBundle({
	style: DOC,
	// A bundle saved before the flattening: the four-bucket shape is what most
	// stored presets still carry, so seeding reads it through the normaliser.
	projectRefs: {
		prompt: "warm",
		mediaAssetIds: ["refmedia:img-1"],
		imageIds: ["img-1"],
		noteIds: [],
		productIds: [],
	},
	settings: { aspectRatio: "16:9", voice: "Kore" },
	pacingDevices: { chapterPills: true, progressBar: false, variant: "pill" },
});

function targets(over: Partial<PresetTargets> = {}): PresetTargets {
	return {
		config: {} as Config,
		projectReferences: { ...EMPTY_PROJECT_SELECTION },
		settings: { ...DEFAULT_SETTINGS },
		pacingDevices: { ...DEFAULT_PACING_DEVICES },
		...over,
	};
}

const PRESET_META = { id: "cp_test", name: "Documentary", description: "Slow and ominous." };

function allCodeDefault(): ElementSourceMap {
	return parseElementSources(
		Object.fromEntries([
			[AXIS_ELEMENT_PATHS.config, { layer: "code-default", defaulterId: null }],
			[AXIS_ELEMENT_PATHS.projectReferences, { layer: "code-default", defaulterId: null }],
			[AXIS_ELEMENT_PATHS.pacingDevices, { layer: "code-default", defaulterId: null }],
			...Object.values(SETTINGS_ELEMENT_PATHS).map((path) => [
				path,
				{ layer: "code-default", defaulterId: null },
			]),
		]),
	);
}

describe("seedConfigStyle", () => {
	test("seeds knobs when the project has none", () => {
		expect(seedConfigStyle({}, bundle).style).toEqual(DOC);
	});
	test("carries the preset's identity alongside the knobs", () => {
		const out = seedConfigStyle({}, bundle, {
			name: "Dark Documentary",
			description: "Slow and ominous.",
		});
		expect(out.styleName).toBe("Dark Documentary");
		expect(out.styleDescription).toBe("Slow and ominous.");
	});
	test("does not overwrite a style the project already has", () => {
		const mine = { ...DOC, pacing: "fast" as const };
		expect(seedConfigStyle({ style: mine }, bundle).style).toEqual(mine);
	});
	test("seeds nothing when the bundle carries no style", () => {
		expect(seedConfigStyle({}, { ...bundle, style: null }).style).toBeUndefined();
	});
});

describe("seedProjectRefs", () => {
	test("seeds refs when the lock is empty", () => {
		const out = seedProjectRefs({ ...EMPTY_PROJECT_SELECTION }, bundle);
		expect(out.entityIds).toEqual(["img-1"]);
		expect(out.prompt).toBe("warm");
	});
	test("does not overwrite an existing selection", () => {
		const current: ProjectSelection = { ...EMPTY_PROJECT_SELECTION, entityIds: ["mine"] };
		expect(seedProjectRefs(current, bundle).entityIds).toEqual(["mine"]);
	});
});

describe("seedSettings", () => {
	test("seeds only fields still at their default", () => {
		const current: GlobalSettings = { ...DEFAULT_SETTINGS, voice: "Explicit" };
		const seeded = seedSettings(current, bundle.settings as Partial<GlobalSettings>);
		expect(seeded.aspectRatio).toBe("16:9");
		expect(seeded.voice).toBe("Explicit");
	});
});

describe("seedFromPreset", () => {
	test("no-op when the bundle is empty", () => {
		const empty: ContentPresetBundle = presetBundle({
			style: null,
			projectRefs: {},
			settings: {},
			pacingDevices: {},
		});
		const out = seedFromPreset(targets(), empty);
		expect(out.config.style).toBeUndefined();
		expect(out.projectReferences).toEqual(EMPTY_PROJECT_SELECTION);
		expect(out.settings).toEqual(DEFAULT_SETTINGS);
		expect(out.pacingDevices).toEqual(DEFAULT_PACING_DEVICES);
	});
	test("seeds every unset axis", () => {
		const out = seedFromPreset(targets(), bundle);
		expect(out.config.style).toEqual(DOC);
		expect(out.projectReferences.entityIds).toEqual(["img-1"]);
		expect(out.settings.aspectRatio).toBe("16:9");
		expect(out.pacingDevices.chapterPills).toBe(true);
	});
});

describe("seedFromPresetSourced", () => {
	test("preserves an operator value even when it equals the code default", () => {
		const current = targets({
			settings: { ...DEFAULT_SETTINGS, aspectRatio: DEFAULT_SETTINGS.aspectRatio },
		});
		const sources = {
			...allCodeDefault(),
			[SETTINGS_ELEMENT_PATHS.aspectRatio]: { layer: "operator" as const, defaulterId: null },
		};
		const out = seedFromPresetSourced(current, sources, bundle, PRESET_META);

		expect(out.targets.settings.aspectRatio).toBe(DEFAULT_SETTINGS.aspectRatio);
		expect(out.targets.settings.voice).toBe("Kore");
		expect(out.sources[SETTINGS_ELEMENT_PATHS.aspectRatio]?.layer).toBe("operator");
		expect(out.sources[SETTINGS_ELEMENT_PATHS.voice]).toEqual({
			layer: "project-preset",
			defaulterId: PRESET_META.id,
		});
	});

	test("re-seeds an axis supplied by an earlier preset instead of freezing it by object comparison", () => {
		const current = targets({
			pacingDevices: { chapterPills: false, progressBar: true, variant: "minimal" },
		});
		const sources = {
			...allCodeDefault(),
			[AXIS_ELEMENT_PATHS.pacingDevices]: {
				layer: "project-preset" as const,
				defaulterId: "cp_earlier",
			},
		};
		const out = seedFromPresetSourced(current, sources, bundle, PRESET_META);

		expect(out.targets.pacingDevices).toEqual({
			chapterPills: true,
			progressBar: false,
			variant: "pill",
		});
		expect(out.sources[AXIS_ELEMENT_PATHS.pacingDevices]).toEqual({
			layer: "project-preset",
			defaulterId: PRESET_META.id,
		});
	});

	test("treats missing sources as operator-owned, so pre-provenance values are preserved", () => {
		const out = seedFromPresetSourced(targets(), {}, bundle, PRESET_META);

		expect(out.targets).toEqual(targets());
		expect(out.sources).toEqual({});
	});
});

describe("applyPresetOverride", () => {
	test("replaces all axes regardless of current values", () => {
		const current = targets({
			config: { style: { ...DOC, pacing: "fast" } } as Config,
			projectReferences: { ...EMPTY_PROJECT_SELECTION, entityIds: ["mine"] },
			settings: { ...DEFAULT_SETTINGS, voice: "Explicit" },
		});
		const out = applyPresetOverride(current, bundle);
		expect(out.config.style).toEqual(DOC);
		expect(out.projectReferences.entityIds).toEqual(["img-1"]);
		expect(out.settings.voice).toBe("Kore");
		expect(out.pacingDevices.chapterPills).toBe(true);
	});
	test("clears style when the preset carries none", () => {
		expect(
			applyPresetOverride(targets({ config: { style: DOC } as Config }), { ...bundle, style: null })
				.config.style,
		).toBeNull();
	});
});

describe("applyPresetSourced", () => {
	test("replaces inherited values while keeping operator-owned values by default", () => {
		const current = targets({
			settings: { ...DEFAULT_SETTINGS, aspectRatio: DEFAULT_SETTINGS.aspectRatio },
		});
		const sources = {
			...allCodeDefault(),
			[SETTINGS_ELEMENT_PATHS.aspectRatio]: { layer: "operator" as const, defaulterId: null },
		};
		const out = applyPresetSourced(current, sources, bundle, PRESET_META);

		expect(out.targets.settings.aspectRatio).toBe(DEFAULT_SETTINGS.aspectRatio);
		expect(out.targets.settings.voice).toBe("Kore");
	});

	test("overwrites operator-owned values only when explicitly requested", () => {
		const current = targets({
			settings: { ...DEFAULT_SETTINGS, aspectRatio: DEFAULT_SETTINGS.aspectRatio },
		});
		const sources = {
			...allCodeDefault(),
			[SETTINGS_ELEMENT_PATHS.aspectRatio]: { layer: "operator" as const, defaulterId: null },
		};
		const out = applyPresetSourced(current, sources, bundle, PRESET_META, {
			overwriteOperatorEdits: true,
		});

		expect(out.targets.settings.aspectRatio).toBe("16:9");
		expect(out.sources[SETTINGS_ELEMENT_PATHS.aspectRatio]).toEqual({
			layer: "project-preset",
			defaulterId: PRESET_META.id,
		});
	});
});

describe("seedProjectRefs reads either persisted shape", () => {
	test("flat bundle seeds its entity ids unchanged", () => {
		const flat: ContentPresetBundle = presetBundle({
			style: null,
			projectRefs: { prompt: "warm", entityIds: ["e1", "e2"] },
			settings: {},
			pacingDevices: {},
		});
		expect(seedProjectRefs({ ...EMPTY_PROJECT_SELECTION }, flat)).toEqual({
			prompt: "warm",
			entityIds: ["e1", "e2"],
		});
	});
	test("four-bucket bundle folds its buckets into one list", () => {
		const legacy: ContentPresetBundle = presetBundle({
			style: null,
			projectRefs: {
				prompt: "",
				mediaAssetIds: ["refmedia:e1"],
				imageIds: ["e1"],
				noteIds: ["n1"],
				productIds: ["p1"],
			},
			settings: {},
			pacingDevices: {},
		});
		expect(seedProjectRefs({ ...EMPTY_PROJECT_SELECTION }, legacy).entityIds).toEqual(["e1", "p1"]);
	});
});
