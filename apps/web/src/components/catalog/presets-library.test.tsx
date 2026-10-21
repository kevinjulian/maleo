import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { PresetsLibrary } from "./presets-library.tsx";

const source = (): string => readFileSync(`${import.meta.dirname}/presets-library.tsx`, "utf8");

// Static render + source assertions (harness has no DOM/event layer).
describe("PresetsLibrary", () => {
	test("renders the list header and a create affordance", () => {
		const html = renderToStaticMarkup(<PresetsLibrary />);
		expect(html).toContain("Project Presets");
		expect(html).toContain("New preset");
	});

	test("wires CRUD + default to the API helpers", () => {
		const src = source();
		expect(src).toContain("createContentPreset(");
		expect(src).toContain("updateContentPreset(");
		expect(src).toContain("getContentPresetUsage(");
		expect(src).toContain("affects ${usage.using} projects");
		expect(src).toContain("deleteContentPreset(");
		expect(src).toContain("setDefaultContentPreset(");
		// Default toggle clears when re-selecting the current default.
		expect(src).toContain("defaultId === id ? null : id");
	});

	/* A Project Preset is Materials + Video Template. The editor showing a third
	 * creative surface is the regression this change exists to prevent, so the
	 * absence of one is asserted rather than left to review. */
	test("the editor offers Materials and Video Template", () => {
		const src = source();
		expect(src).toContain('<h2 className="pl-h2">Materials</h2>');
		expect(src).toContain('<h2 className="pl-h2">Video Template</h2>');
		expect(src).toContain("PresetMaterialPicker");
		expect(src).toContain("setVideoTemplateId");
	});

	test("the editor has no top-level Style surface", () => {
		const src = source();
		expect(src).not.toContain('<h2 className="pl-h2">Style</h2>');
		expect(src).not.toContain("StyleKnobEditor");
		expect(src).not.toContain("<StylePanel");
		expect(src).not.toContain("<SettingsPanel");
		expect(src).not.toContain("ProjectReferencesPopover");
	});

	/* Dropping the fields from the UI must not drop them from the row: projects
	 * seeded from a pre-materials preset still read what it supplies. */
	test("saving carries the retired bundle fields through untouched", () => {
		const src = source();
		expect(src).toContain("const legacy = initial?.bundle;");
		for (const field of [
			"style: legacy?.style",
			"projectRefs: legacy?.projectRefs",
			"pacingDevices: legacy?.pacingDevices",
			"infographicStyle: legacy?.infographicStyle",
			"direction: legacy?.direction",
		]) {
			expect(src).toContain(field);
		}
	});

	/* Two fields for one choice is how they disagree: `videoTemplateId` owns the
	 * selection now, so the settings blob must not keep a second copy. */
	test("saving drops the legacy template id from the settings blob", () => {
		expect(source()).toContain("delete legacySettings.timelineTemplateId;");
	});
});
