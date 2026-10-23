import { describe, expect, test } from "vite-plus/test";
import { ALL_ELEMENT_PATHS, AXIS_ELEMENT_PATHS, SETTINGS_ELEMENT_PATHS } from "./element-paths.ts";
import { DEFAULT_SETTINGS } from "./creative-settings.ts";

/* The `satisfies` clauses in element-paths.ts already fail typecheck when a field is
 * renamed or added without a path. These tests cover what a type cannot: that the
 * runtime values are unique, non-empty, and that the settings map matches the shape
 * actually shipped in DEFAULT_SETTINGS rather than a stale idea of it.
 *
 * A sidecar keyed by strings fails silently when a key stops matching anything, so
 * the guards are worth more here than the usual coverage argument. */
describe("element paths address every seedable element exactly once", () => {
	test("every GlobalSettings field has a path", () => {
		expect(Object.keys(SETTINGS_ELEMENT_PATHS).sort()).toEqual(
			Object.keys(DEFAULT_SETTINGS).sort(),
		);
	});

	test("no path is duplicated", () => {
		expect(new Set(ALL_ELEMENT_PATHS).size).toBe(ALL_ELEMENT_PATHS.length);
	});

	test("no path is empty or whitespace", () => {
		for (const path of ALL_ELEMENT_PATHS) expect(path.trim()).toBe(path);
		for (const path of ALL_ELEMENT_PATHS) expect(path.length).toBeGreaterThan(0);
	});

	test("every settings path is namespaced under its axis", () => {
		for (const [field, path] of Object.entries(SETTINGS_ELEMENT_PATHS)) {
			expect(path as string).toBe(`settings.${field}`);
		}
	});

	/* The settings AXIS path and its per-field paths coexist on purpose: a preset
	 * bundle records one source for the axis it seeded, while an operator editing one
	 * field records a source for that field. A reader has to be able to tell them
	 * apart, so the axis path must not collide with any field path. */
	test("the settings axis path is not also a field path", () => {
		expect(Object.values(SETTINGS_ELEMENT_PATHS) as string[]).not.toContain(
			AXIS_ELEMENT_PATHS.settings as string,
		);
	});

	test("every PresetTargets axis has a path", () => {
		expect(Object.keys(AXIS_ELEMENT_PATHS).sort()).toEqual([
			"config",
			"pacingDevices",
			"projectReferences",
			"settings",
		]);
	});

	/* `config` addresses the style knobs, not the whole Config object — the axis a
	 * preset seeds is the style. Naming it "style" keeps the stored key meaningful to
	 * anyone reading a persisted blob. */
	test("the config axis is addressed as style", () => {
		expect(AXIS_ELEMENT_PATHS.config).toBe("style");
	});
});
