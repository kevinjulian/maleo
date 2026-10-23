import { describe, expect, test } from "vite-plus/test";
import { PRESET_FIXTURES, isOverridden } from "@maleo/shared";
import { parseElementSources, parseRenderOverrides } from "./element-sources.ts";
import { AXIS_ELEMENT_PATHS, SETTINGS_ELEMENT_PATHS } from "./element-paths.ts";
type GlobalSettingsLike = Record<string, unknown>;
type PacingLike = Record<string, unknown>;
import {
	clearRenderOverride,
	foldPresentationOverSettings,
	resetSectionToDefaults,
	recordAxisEdit,
	recordSettingsEdits,
	overwriteElementValue,
	revertElementValue,
	seedElementValue,
	supplierSuppliesPath,
	writeOperatorValue,
	writeRenderOverride,
} from "./element-writes.ts";

describe("an operator edit always lands and always claims the element", () => {
	test("it takes the value and marks the element the operator's", () => {
		const out = writeOperatorValue("settings.voice", "aria", {});

		expect(out.value).toBe("aria");
		expect(out.sources["settings.voice"]).toEqual({ layer: "operator", defaulterId: null });
	});

	test("it lands over any supplying layer", () => {
		const sources = parseElementSources({
			"settings.voice": { layer: "render-template", defaulterId: "tt_1" },
		});
		expect(
			writeOperatorValue("settings.voice", "aria", sources).sources["settings.voice"]?.layer,
		).toBe("operator");
	});
});

describe("seeding fills only what the operator does not own", () => {
	test("an element at a weaker layer takes the incoming value and records the defaulter", () => {
		const sources = parseElementSources({ style: { layer: "code-default", defaulterId: null } });
		const out = seedElementValue("style", "old", "new", sources, "project-preset", "cp_1");

		expect(out.value).toBe("new");
		expect(out.sources.style).toEqual({ layer: "project-preset", defaulterId: "cp_1" });
	});

	test("an operator-owned element keeps its value and its source", () => {
		const sources = parseElementSources({ style: { layer: "operator", defaulterId: null } });
		const out = seedElementValue("style", "mine", "theirs", sources, "project-preset", "cp_1");

		expect(out.value).toBe("mine");
		expect(out.sources.style).toEqual({ layer: "operator", defaulterId: null });
	});

	/* The safety property, stated as a write: an element nobody recorded is treated as
	 * the operator's, so seeding a project that predates provenance cannot overwrite
	 * work already done. */
	test("an unrecorded element is not seeded", () => {
		const out = seedElementValue("style", "existing", "incoming", {}, "project-preset", "cp_1");

		expect(out.value).toBe("existing");
		expect(out.sources.style).toBeUndefined();
	});

	/* The other half of the bug being replaced: seeding used to compare a whole axis
	 * object, so one touched field froze every field beside it. Per-element sources
	 * mean neighbours are independent. */
	test("one owned element does not block its neighbours", () => {
		const sources = parseElementSources({
			"settings.voice": { layer: "operator", defaulterId: null },
			"settings.language": { layer: "code-default", defaulterId: null },
		});

		expect(
			seedElementValue("settings.voice", "mine", "theirs", sources, "project-preset", "cp_1").value,
		).toBe("mine");
		expect(
			seedElementValue("settings.language", "en", "fr", sources, "project-preset", "cp_1").value,
		).toBe("fr");
	});

	test("re-seeding from the same layer refreshes rather than doing nothing", () => {
		const sources = parseElementSources({
			style: { layer: "project-preset", defaulterId: "cp_1" },
		});
		const out = seedElementValue("style", "old", "new", sources, "project-preset", "cp_2");

		expect(out.value).toBe("new");
		expect(out.sources.style?.defaulterId).toBe("cp_2");
	});
});

describe("overwrite is a separate act from seeding", () => {
	test("it lands over an operator-owned element", () => {
		const sources = parseElementSources({ style: { layer: "operator", defaulterId: null } });
		const out = overwriteElementValue("style", "theirs", sources, "project-preset", "cp_1");

		expect(out.value).toBe("theirs");
		expect(out.sources.style).toEqual({ layer: "project-preset", defaulterId: "cp_1" });
	});
});

describe("revert hands the element back to whatever supplies it", () => {
	const SUPPLIER = { layer: "project-preset", defaulterId: "cp_1" } as const;

	test("it takes the supplied value and records the supplier", () => {
		const sources = parseElementSources({ style: { layer: "operator", defaulterId: null } });
		const out = revertElementValue("style", "supplied", SUPPLIER, sources);

		expect(out.value).toBe("supplied");
		expect(out.sources.style).toEqual(SUPPLIER);
	});

	/* The source is RECORDED, not removed. Removing it looks tidier — let resolution
	 * decide who supplies it next — but an absent source reads as operator-owned, so a
	 * removed source leaves the element UNSEEDABLE: the opposite of reverting. A test
	 * asserting the reason for the feature is what caught this. */
	test("the reverted element is inherited, and seedable again", () => {
		const out = revertElementValue(
			"style",
			"supplied",
			SUPPLIER,
			parseElementSources({ style: { layer: "operator", defaulterId: null } }),
		);

		expect(isOverridden(out.sources.style)).toBe(false);
		expect(
			seedElementValue("style", out.value, "next", out.sources, "project-preset", "cp_2").value,
		).toBe("next");
	});

	test("reverting one element leaves the others alone", () => {
		const sources = parseElementSources({
			style: { layer: "operator", defaulterId: null },
			pacingDevices: { layer: "operator", defaulterId: null },
		});
		const out = revertElementValue("style", "supplied", SUPPLIER, sources);

		expect(out.sources.pacingDevices).toEqual({ layer: "operator", defaulterId: null });
	});
});

describe("render overrides are per-field and never touch the shared template", () => {
	test("writing an override records only that field", () => {
		const out = writeRenderOverride(
			"maxVisualBeatSec",
			6,
			parseRenderOverrides({ sceneTransition: "cut" }),
		);

		expect(out.overrides).toEqual({ sceneTransition: "cut", maxVisualBeatSec: 6 });
	});

	test("a falsy override is stored, not skipped", () => {
		expect(writeRenderOverride("staticSceneMovement", false, {}).overrides).toEqual({
			staticSceneMovement: false,
		});
	});

	test("clearing an override drops just that field", () => {
		const out = clearRenderOverride(
			"maxVisualBeatSec",
			parseRenderOverrides({ maxVisualBeatSec: 6, staticSceneMovement: false }),
		);

		expect(out.overrides).toEqual({ staticSceneMovement: false });
	});

	test("clearing an absent override changes nothing", () => {
		const overrides = parseRenderOverrides({ staticSceneMovement: false });
		expect(clearRenderOverride("nope", overrides).overrides).toEqual(overrides);
	});

	test("writing never mutates the map it was given", () => {
		const overrides = parseRenderOverrides({ staticSceneMovement: false });
		writeRenderOverride("maxVisualBeatSec", 6, overrides);
		expect(overrides).toEqual({ staticSceneMovement: false });
	});
});

/* An operator edit has to claim its element, or the next apply overwrites it — after a
 * confirmation that promised to keep it. These cover the diff-at-one-place approach the
 * panels use, whose whole point is that no individual control can forget. */
describe("recording operator edits claims only what changed", () => {
	const PATHS = { aspectRatio: "settings.aspectRatio", voice: "settings.voice" } as const;

	test("a changed field is claimed", () => {
		const out = recordSettingsEdits(
			{ aspectRatio: "9:16", voice: "" },
			{ aspectRatio: "16:9", voice: "" },
			PATHS,
			{},
		);
		expect(out["settings.aspectRatio"]).toEqual({ layer: "operator", defaulterId: null });
	});

	test("an unchanged field beside it is left alone", () => {
		const sources = parseElementSources({
			"settings.voice": { layer: "project-preset", defaulterId: "cp_1" },
		});
		const out = recordSettingsEdits(
			{ aspectRatio: "9:16", voice: "aria" },
			{ aspectRatio: "16:9", voice: "aria" },
			PATHS,
			sources,
		);
		expect(out["settings.voice"]).toEqual({ layer: "project-preset", defaulterId: "cp_1" });
	});

	/* A re-render, or setting a field to the value it already had, is not an edit. If it
	 * claimed everything the panel touches, opening the Style rail would quietly make the
	 * whole project operator-owned and presets would stop applying to it. */
	test("no change claims nothing", () => {
		const sources = parseElementSources({
			"settings.voice": { layer: "project-preset", defaulterId: "cp_1" },
		});
		const same = { aspectRatio: "9:16", voice: "aria" };
		expect(recordSettingsEdits(same, { ...same }, PATHS, sources)).toEqual(sources);
	});

	test("an axis edit claims the axis", () => {
		expect(recordAxisEdit("pacingDevices", {})["pacingDevices"]).toEqual({
			layer: "operator",
			defaulterId: null,
		});
	});
});

/* Resetting a section. The target is the code default because there is no recorded
 * preset to go back to — an operator source carries no defaulterId and the project does
 * not store an active preset. The point is less "undo" than making the element seedable
 * again, so the assertions are as much about the dropped source as the restored value. */
describe("resetting a section clears the claim and restores defaults", () => {
	const DEFAULTS = {
		settings: { aspectRatio: "9:16", voice: "" } as unknown as GlobalSettingsLike,
		pacingDevices: {
			chapterPills: false,
			progressBar: false,
			variant: "pill",
		} as unknown as PacingLike,
	};
	const SETTINGS_PATHS = {
		aspectRatio: "settings.aspectRatio",
		voice: "settings.voice",
	} as unknown as Readonly<Record<string, string>>;
	const AXIS_PATHS = { pacingDevices: "pacingDevices" };

	const run = (paths: string[], over: Partial<Parameters<typeof resetSectionToDefaults>[0]> = {}) =>
		resetSectionToDefaults({
			paths,
			settings: { aspectRatio: "16:9", voice: "Kore" } as unknown as GlobalSettingsLike,
			pacingDevices: {
				chapterPills: true,
				progressBar: true,
				variant: "minimal",
			} as unknown as PacingLike,
			sources: parseElementSources({
				"settings.aspectRatio": { layer: "operator", defaulterId: null },
				"settings.voice": { layer: "operator", defaulterId: null },
				pacingDevices: { layer: "operator", defaulterId: null },
			}),
			settingsPaths: SETTINGS_PATHS as never,
			axisPaths: AXIS_PATHS,
			defaults: DEFAULTS as never,
			...over,
		} as never);

	test("a settings field goes back to its default and records code-default", () => {
		const out = run(["settings.aspectRatio"]);
		expect(out.settings.aspectRatio).toBe("9:16");
		expect(out.sources["settings.aspectRatio"]).toEqual({
			layer: "code-default",
			defaulterId: null,
		});
	});

	test("a sibling in the same section is untouched when not named", () => {
		const out = run(["settings.aspectRatio"]);
		expect(out.settings.voice).toBe("Kore");
		expect(out.sources["settings.voice"]).toEqual({ layer: "operator", defaulterId: null });
	});

	test("an object-valued axis goes back to its default", () => {
		const out = run(["pacingDevices"]);
		expect(out.pacingDevices).toEqual(DEFAULTS.pacingDevices);
		expect(out.sources.pacingDevices).toEqual({ layer: "code-default", defaulterId: null });
	});

	/* The reset's real effect: with the claim gone the element is seedable again, so the
	 * next preset fills it. Asserting that directly, because it is the reason to reset. */
	test("the element becomes seedable again", () => {
		const out = run(["settings.aspectRatio"]);
		expect(
			seedElementValue(
				"settings.aspectRatio",
				out.settings.aspectRatio,
				"1:1",
				out.sources,
				"project-preset",
				"cp_1",
			).value,
		).toBe("1:1");
	});

	/* A path it cannot restore must not have its source dropped: clearing the claim while
	 * keeping the operator's value would leave a value nobody is recorded as owning. */
	test("an unknown path keeps its source rather than being half-reset", () => {
		const out = run(["style"]);
		expect(out.sources.pacingDevices).toEqual({ layer: "operator", defaulterId: null });
		expect(out.sources.style).toBeUndefined();
	});

	/* A supplier only supplies what its bundle CARRIES. A preset that says nothing about
	 * an element resets it to shipped code and records code-default — so a panel that
	 * offered "Use default" naming that preset would have promised a value it never had.
	 * That is the bug `supplierSuppliesPath` exists to prevent. */
	test("a supplier that carries the field is reverted to, and named", () => {
		const out = run(["settings.aspectRatio"], {
			supplier: { id: "cp_1", settings: { aspectRatio: "1:1" } },
		});
		expect(out.settings.aspectRatio).toBe("1:1");
		expect(out.sources["settings.aspectRatio"]).toEqual({
			layer: "project-preset",
			defaulterId: "cp_1",
		});
	});

	test("a supplier silent about the field falls back to shipped code, and says so", () => {
		const out = run(["settings.voice"], {
			supplier: { id: "cp_1", settings: { aspectRatio: "1:1" } },
		});
		expect(out.settings.voice).toBe(DEFAULTS.settings.voice as string);
		expect(out.sources["settings.voice"]).toEqual({ layer: "code-default", defaulterId: null });
	});

	/* The predicate the panel's action label reads. It has to agree with the reset above on
	 * every element, because the two together are the promise: the word the operator read and
	 * the write they got. They used to decide separately, and a built-in preset — which ships
	 * two settings fields — made most elements offer "Use default" against a bundle with no
	 * opinion, resetting to shipped code instead. */
	describe("what a supplier actually supplies", () => {
		const ask = (path: string, supplier: Parameters<typeof supplierSuppliesPath>[0]["supplier"]) =>
			supplierSuppliesPath({
				path,
				settingsPaths: SETTINGS_PATHS as never,
				axisPaths: AXIS_PATHS,
				supplier,
			});

		test("a settings field the bundle carries", () => {
			expect(ask("settings.aspectRatio", { id: "cp_1", settings: { aspectRatio: "1:1" } })).toBe(
				true,
			);
		});

		test("a settings field the bundle omits", () => {
			expect(ask("settings.voice", { id: "cp_1", settings: { aspectRatio: "1:1" } })).toBe(false);
		});

		/* Undefined is the shape a partial bundle actually uses for an absent field, and it
		 * has to read as "no opinion" rather than as "supplies undefined". */
		test("a settings field explicitly undefined counts as absent", () => {
			expect(ask("settings.voice", { id: "cp_1", settings: { voice: undefined } })).toBe(false);
		});

		test("an object axis with content, and one without", () => {
			expect(ask("pacingDevices", { id: "cp_1", pacingDevices: { chapterPills: true } })).toBe(
				true,
			);
			expect(ask("pacingDevices", { id: "cp_1", pacingDevices: {} })).toBe(false);
		});

		test("no supplier at all supplies nothing", () => {
			expect(ask("settings.aspectRatio", null)).toBe(false);
		});

		test("a path the reset cannot restore is not claimed as supplied", () => {
			expect(ask("style", { id: "cp_1", settings: { aspectRatio: "1:1" } })).toBe(false);
		});

		/* Against the ACTUAL shipped bundles, not a fixture. This is the case that produced
		 * the bug: a project on a built-in offered "Use default" for every element, while
		 * the bundles carry `aspectRatio` and `language` and nothing else. A fixture of the
		 * same shape would keep passing if the builtins later changed what they carry. */
		test("the shipped built-ins supply only what they actually carry", () => {
			// The REAL path map, not the two-field fixture above: this test is about what
			// the shipped bundles cover across every addressable settings element.
			const askReal = (
				path: string,
				supplier: Parameters<typeof supplierSuppliesPath>[0]["supplier"],
			) =>
				supplierSuppliesPath({
					path,
					settingsPaths: SETTINGS_ELEMENT_PATHS,
					axisPaths: {
						pacingDevices: AXIS_ELEMENT_PATHS.pacingDevices,
					},
					supplier,
				});

			expect(PRESET_FIXTURES.length).toBeGreaterThan(0);
			for (const preset of PRESET_FIXTURES) {
				const supplier = {
					id: preset.slug,
					settings: preset.bundle.settings,
					pacingDevices: preset.bundle.pacingDevices,
				} as never;
				expect(askReal(SETTINGS_ELEMENT_PATHS.aspectRatio, supplier)).toBe(true);
				expect(askReal(SETTINGS_ELEMENT_PATHS.language, supplier)).toBe(true);
				// The ones that used to offer "Use default" against a bundle with no opinion.
				expect(askReal(SETTINGS_ELEMENT_PATHS.renderBackend, supplier)).toBe(false);
				expect(askReal(SETTINGS_ELEMENT_PATHS.voiceProvider, supplier)).toBe(false);
				expect(askReal(SETTINGS_ELEMENT_PATHS.brandLogoUrl, supplier)).toBe(false);
			}
		});

		/* The agreement itself: for every path, the predicate and the reset's recorded layer
		 * must say the same thing. This is the invariant, not the individual cases above. */
		test("the predicate agrees with what the reset records, path by path", () => {
			const supplier = {
				id: "cp_1",
				settings: { aspectRatio: "1:1" },
				pacingDevices: {},
			};
			for (const path of ["settings.aspectRatio", "settings.voice", "pacingDevices"]) {
				const out = run([path], { supplier });
				const recordedAsSupplied = out.sources[path]?.layer === "project-preset";
				expect(ask(path, supplier)).toBe(recordedAsSupplied);
			}
		});
	});
});

/* Folding a restored presentation over settings. The property that matters is that
 * nothing is recorded when nothing changed — this runs on every load, so a fold that
 * claimed elements unconditionally would make every project operator-owned after one
 * open, and presets would stop applying to anything. */
describe("a restored presentation claims only what it actually replaced", () => {
	const PATHS = {
		aspectRatio: "settings.aspectRatio",
		backgroundFill: "settings.backgroundFill",
	} as unknown as Readonly<Record<string, string>>;
	const base = { aspectRatio: "9:16", backgroundFill: "#0B0B0F" } as unknown as GlobalSettingsLike;

	test("an unchanged fold records nothing", () => {
		const sources = parseElementSources({
			"settings.aspectRatio": { layer: "project-preset", defaulterId: "cp_1" },
		});
		const out = foldPresentationOverSettings({
			settings: base as never,
			fold: (s) => s,
			sources,
			settingsPaths: PATHS as never,
		});
		expect(out.sources).toEqual(sources);
	});

	/* Leaving the old source would be worse than claiming it: the map would describe a
	 * value the fold just replaced, so a later preset apply would overwrite what the
	 * restore brought back, and the tag would name a defaulter that did not supply what
	 * is on screen. */
	test("a replaced field becomes the operator's", () => {
		const sources = parseElementSources({
			"settings.aspectRatio": { layer: "project-preset", defaulterId: "cp_1" },
		});
		const out = foldPresentationOverSettings({
			settings: base as never,
			fold: (s) => ({ ...s, aspectRatio: "16:9" }) as never,
			sources,
			settingsPaths: PATHS as never,
		});
		expect(out.settings.aspectRatio).toBe("16:9");
		expect(out.sources["settings.aspectRatio"]).toEqual({ layer: "operator", defaulterId: null });
	});

	test("a field the fold left alone keeps its source", () => {
		const sources = parseElementSources({
			"settings.backgroundFill": { layer: "project-preset", defaulterId: "cp_1" },
		});
		const out = foldPresentationOverSettings({
			settings: base as never,
			fold: (s) => ({ ...s, aspectRatio: "16:9" }) as never,
			sources,
			settingsPaths: PATHS as never,
		});
		expect(out.sources["settings.backgroundFill"]).toEqual({
			layer: "project-preset",
			defaulterId: "cp_1",
		});
	});
});

/* With an active preset recorded, handing an element back is a real revert: it goes to
 * the preset's value, attributed to the preset. Without one it falls back to the shipped
 * default. The distinction is the whole reason to store the project's active preset. */
describe("handing a section back to an active preset", () => {
	const DEFAULTS = {
		settings: { aspectRatio: "9:16", voice: "" } as unknown as GlobalSettingsLike,
		pacingDevices: {
			chapterPills: false,
			progressBar: false,
			variant: "pill",
		} as unknown as PacingLike,
	};
	const PATHS = {
		aspectRatio: "settings.aspectRatio",
		voice: "settings.voice",
	} as unknown as Readonly<Record<string, string>>;

	const run = (paths: string[], supplier: unknown) =>
		resetSectionToDefaults({
			paths,
			settings: { aspectRatio: "1:1", voice: "Mine" } as unknown as GlobalSettingsLike,
			pacingDevices: {
				chapterPills: true,
				progressBar: true,
				variant: "minimal",
			} as unknown as PacingLike,
			sources: parseElementSources({
				"settings.aspectRatio": { layer: "operator", defaulterId: null },
				"settings.voice": { layer: "operator", defaulterId: null },
				pacingDevices: { layer: "operator", defaulterId: null },
			}),
			settingsPaths: PATHS as never,
			axisPaths: { pacingDevices: "pacingDevices" },
			defaults: DEFAULTS as never,
			supplier,
		} as never);

	test("it takes the preset's value and names the preset", () => {
		const out = run(["settings.aspectRatio"], { id: "cp_1", settings: { aspectRatio: "16:9" } });
		expect(out.settings.aspectRatio).toBe("16:9");
		expect(out.sources["settings.aspectRatio"]).toEqual({
			layer: "project-preset",
			defaulterId: "cp_1",
		});
	});

	/* A preset only supplies what its bundle carries. Where it has no opinion the shipped
	 * default is the honest answer, and the source must say code-default rather than name
	 * a preset that said nothing about this element. */
	test("an element the preset says nothing about falls back to the default", () => {
		const out = run(["settings.voice"], { id: "cp_1", settings: { aspectRatio: "16:9" } });
		expect(out.settings.voice).toBe("");
		expect(out.sources["settings.voice"]).toEqual({ layer: "code-default", defaulterId: null });
	});

	test("an object-valued axis merges the preset over the default", () => {
		const out = run(["pacingDevices"], { id: "cp_1", pacingDevices: { chapterPills: true } });
		expect(out.pacingDevices).toEqual({ ...DEFAULTS.pacingDevices, chapterPills: true });
		expect(out.sources.pacingDevices).toEqual({ layer: "project-preset", defaulterId: "cp_1" });
	});

	test("with no active preset it still resets to the shipped default", () => {
		const out = run(["settings.aspectRatio"], null);
		expect(out.settings.aspectRatio).toBe("9:16");
		expect(out.sources["settings.aspectRatio"]).toEqual({
			layer: "code-default",
			defaulterId: null,
		});
	});

	test("either way the element is seedable again", () => {
		for (const supplier of [{ id: "cp_1", settings: { aspectRatio: "16:9" } }, null]) {
			const out = run(["settings.aspectRatio"], supplier);
			expect(
				seedElementValue(
					"settings.aspectRatio",
					out.settings.aspectRatio,
					"4:5",
					out.sources,
					"project-preset",
					"cp_2",
				).value,
			).toBe("4:5");
		}
	});
});
