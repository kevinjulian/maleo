/* Old seeding vs new, on the same fixtures.
 *
 * This is the gate in front of switching the callers. Rewriting seeding is the one
 * change in this plan that can silently overwrite somebody's work, so the two
 * implementations run side by side and every disagreement has to be explainable as one
 * of the two bugs being fixed:
 *
 *   BUG A  a value deliberately set to something equal to the code default reads as
 *          "untouched" and gets overwritten.
 *   BUG B  one touched field in an object-valued axis makes the whole axis read as
 *          touched, so its untouched siblings never get seeded.
 *
 * Anything else the two disagree about is a regression, and the last test in this file
 * is the one that would catch it: it enumerates the disagreements rather than asserting
 * one at a time, so a NEW difference fails even though nobody wrote a test for it.
 */
import {
	keysOf,
	EMPTY_PROJECT_SELECTION,
	findPresetFixture,
	type ContentPresetBundle,
	type StyleKnobs,
	presetBundle,
} from "@maleo/shared";
import { describe, expect, test } from "vite-plus/test";
import type { Config } from "@maleo/shared";
import { DEFAULT_PACING_DEVICES } from "./generation-defaults.ts";
import { DEFAULT_SETTINGS } from "./creative-settings.ts";
import { seedFromPreset, type PresetTargets } from "./preset-apply.ts";
import { seedFromPresetSourced } from "./preset-apply-sourced.ts";
import { parseElementSources, type ElementSourceMap } from "./element-sources.ts";
import { SETTINGS_ELEMENT_PATHS } from "./element-paths.ts";

const DOC: StyleKnobs = findPresetFixture("dark-documentary")!.bundle.style!;
const PRESET = { id: "cp_diff", name: "Diff", description: "for the harness" };

const bundle: ContentPresetBundle = presetBundle({
	style: DOC,
	projectRefs: { prompt: "warm", entityIds: ["ent-1"] },
	// aspectRatio is in DEFAULT_SETTINGS as "9:16"; the preset offers something else,
	// so "did the operator choose 9:16 on purpose?" becomes answerable.
	settings: { aspectRatio: "16:9", voice: "Kore", language: "en" },
	pacingDevices: { chapterPills: true, progressBar: true, variant: "pill" },
	direction: undefined,
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

/* A real project records a source for every element, so a fixture that leaves most of
 * them absent is not testing what it claims — absent reads as operator-owned, which
 * suppresses seeding everywhere and drowns the one difference under test. These
 * fixtures start from "everything is code-default" and change only what they are about. */
function allCodeDefault(): ElementSourceMap {
	return parseElementSources(
		Object.fromEntries([
			["style", { layer: "code-default", defaulterId: null }],
			["projectReferences", { layer: "code-default", defaulterId: null }],
			["pacingDevices", { layer: "code-default", defaulterId: null }],
			...Object.values(SETTINGS_ELEMENT_PATHS).map((path) => [
				path,
				{ layer: "code-default", defaulterId: null },
			]),
		]),
	);
}

function allFrom(defaulterId: string): ElementSourceMap {
	return parseElementSources(
		Object.fromEntries(
			Object.keys(allCodeDefault()).map((path) => [path, { layer: "project-preset", defaulterId }]),
		),
	);
}

/* The fixtures 3.1 calls for. Each names the project shape it stands in for, because
 * "fixture 3" tells a later reader nothing about why it exists. */
interface Fixture {
	name: string;
	targets: PresetTargets;
	sources: ElementSourceMap;
	/** null when the two implementations are expected to agree. */
	knownBug: "A" | "B" | null;
}

const FIXTURES: Fixture[] = [
	{
		name: "a fresh project, nothing set",
		targets: targets(),
		// A brand-new project records its defaults as code-default, so seeding may fill
		// everything. This is the case both implementations should handle identically.
		sources: allCodeDefault(),
		knownBug: null,
	},
	{
		name: "a project already seeded from this preset",
		targets: targets({
			config: { style: DOC } as Config,
			projectReferences: { prompt: "warm", entityIds: ["ent-1"] },
			settings: { ...DEFAULT_SETTINGS, aspectRatio: "16:9", voice: "Kore", language: "en" },
			pacingDevices: { chapterPills: true, progressBar: true, variant: "pill" },
		}),
		sources: allFrom("cp_diff"),
		knownBug: null,
	},
	{
		name: "BUG A — the operator chose a value that equals the code default",
		targets: targets({
			settings: { ...DEFAULT_SETTINGS, aspectRatio: DEFAULT_SETTINGS.aspectRatio },
		}),
		// Everything else stays code-default so the ONLY difference is the one field the
		// operator chose deliberately.
		sources: {
			...allCodeDefault(),
			[SETTINGS_ELEMENT_PATHS.aspectRatio]: { layer: "operator", defaulterId: null },
		},
		knownBug: "A",
	},
	{
		/* The real whole-axis freeze. A project seeded from an EARLIER preset now has
		 * pacing that differs from the shipped default, so the old rule's
		 * `JSON.stringify(current) === JSON.stringify(DEFAULT)` check says "touched" and
		 * refuses to seed — even though nobody touched it, a previous preset did. Applying
		 * a new preset silently leaves the old preset's pacing in place.
		 *
		 * The new rule reads the recorded layer: project-preset is seedable from
		 * project-preset, so the incoming preset supplies it as it should. */
		name: "BUG B — an axis a previous preset supplied is frozen by value comparison",
		targets: targets({
			pacingDevices: { chapterPills: false, progressBar: true, variant: "minimal" },
		}),
		sources: {
			...allCodeDefault(),
			pacingDevices: { layer: "project-preset", defaulterId: "cp_earlier" },
		},
		knownBug: "B",
	},
	{
		name: "a project with no recorded sources at all",
		targets: targets(),
		sources: {},
		knownBug: "A",
	},
];

/** Which axes the two implementations produced different values for. */
function disagreements(fixture: Fixture): string[] {
	const old = seedFromPreset(fixture.targets, bundle, {
		name: PRESET.name,
		description: PRESET.description,
	});
	const next = seedFromPresetSourced(fixture.targets, fixture.sources, bundle, PRESET).targets;

	const out: string[] = [];
	if (JSON.stringify(old.config.style ?? null) !== JSON.stringify(next.config.style ?? null))
		out.push("style");
	if (JSON.stringify(old.projectReferences) !== JSON.stringify(next.projectReferences))
		out.push("projectReferences");
	if (JSON.stringify(old.pacingDevices) !== JSON.stringify(next.pacingDevices))
		out.push("pacingDevices");
	for (const field of keysOf(SETTINGS_ELEMENT_PATHS)) {
		if (old.settings[field] !== next.settings[field]) out.push(`settings.${field}`);
	}
	return out;
}

describe("the two implementations agree wherever neither bug applies", () => {
	for (const fixture of FIXTURES.filter((f) => f.knownBug === null)) {
		test(fixture.name, () => {
			expect(disagreements(fixture)).toEqual([]);
		});
	}
});

describe("where they disagree, the new rules are the correct ones", () => {
	/* BUG A: the operator deliberately set 9:16, which happens to equal the shipped
	 * default. The old rule compares value-to-default, sees equality, calls it untouched
	 * and overwrites it with the preset's 16:9. The new rule reads the recorded operator
	 * layer and leaves it alone. */
	test("BUG A — a deliberate choice equal to the default survives", () => {
		const fixture = FIXTURES.find((f) => f.name.startsWith("BUG A"))!;
		const old = seedFromPreset(fixture.targets, bundle, PRESET);
		const next = seedFromPresetSourced(fixture.targets, fixture.sources, bundle, PRESET).targets;

		expect(old.settings.aspectRatio).toBe("16:9");
		expect(next.settings.aspectRatio).toBe(DEFAULT_SETTINGS.aspectRatio);
		expect(disagreements(fixture)).toContain("settings.aspectRatio");
	});

	/* BUG B: the operator touched `pacingDevices.variant`. The old rule stringifies the
	 * whole object, so pacing is frozen — correctly, as it happens — but it uses the
	 * same all-or-nothing reasoning for every other axis. The difference this fixture pins is that the
	 * new rule can express "this axis is theirs, that one is not" per axis rather than
	 * per comparison. */
	test("BUG B — an axis a previous preset supplied is re-seeded, not frozen", () => {
		const fixture = FIXTURES.find((f) => f.name.startsWith("BUG B"))!;
		const old = seedFromPreset(fixture.targets, bundle, PRESET);
		const next = seedFromPresetSourced(fixture.targets, fixture.sources, bundle, PRESET).targets;

		// Old: value differs from the shipped default, so it reads as touched and the
		// earlier preset's pacing survives a preset change.
		expect(old.pacingDevices.variant).toBe("minimal");
		// New: the layer says a preset supplied it, so the incoming preset supplies it now.
		expect(next.pacingDevices.chapterPills).toBe(true);
	});

	/* A project persisted before provenance existed has no sources, so every element
	 * reads as the operator's and nothing is seeded. The old rule happily overwrites its
	 * defaults. This is the asymmetry decision 4 chose deliberately: re-inheriting less
	 * is recoverable, overwriting work is not. */
	test("a project with no sources is not seeded at all", () => {
		const fixture = FIXTURES.find((f) => f.name.includes("no recorded sources"))!;
		const next = seedFromPresetSourced(fixture.targets, fixture.sources, bundle, PRESET);

		expect(next.targets.settings.aspectRatio).toBe(DEFAULT_SETTINGS.aspectRatio);
		expect(next.targets.config.style ?? null).toBeNull();
		expect(next.sources).toEqual({});
	});
});

/* The regression net. Every disagreement is enumerated against an expected set, so a
 * NEW difference between the implementations fails here even though no test was
 * written for it — which is the only way this harness catches what I did not think of. */
describe("no unexplained disagreement exists", () => {
	const EXPECTED: Record<string, string[]> = {
		"a fresh project, nothing set": [],
		"a project already seeded from this preset": [],
		"BUG A — the operator chose a value that equals the code default": ["settings.aspectRatio"],
		"BUG B — an axis a previous preset supplied is frozen by value comparison": ["pacingDevices"],
		"a project with no recorded sources at all": [
			"style",
			"projectReferences",
			"pacingDevices",
			"settings.aspectRatio",
			"settings.voice",
			"settings.language",
		],
	};

	for (const fixture of FIXTURES) {
		test(fixture.name, () => {
			expect([...disagreements(fixture)].sort()).toEqual(
				[...(EXPECTED[fixture.name] ?? [])].sort(),
			);
		});
	}
});
