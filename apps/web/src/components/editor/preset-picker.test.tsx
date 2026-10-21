import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { PresetOverrideWarning } from "./preset-picker.tsx";

// Static render + source assertions (harness has no DOM/event layer).
describe("preset picker + apply confirmation", () => {
	test("it reports what will be replaced and what will be kept", () => {
		const html = renderToStaticMarkup(
			<PresetOverrideWarning
				presetName="Studio look"
				replaced={["style", "settings.voice"]}
				kept={["settings.aspectRatio"]}
				onConfirm={() => {}}
				onCancel={() => {}}
			/>,
		);
		expect(html).toContain("Studio look");
		expect(html).toContain("Replaces 2 inherited values");
		// Paths are addresses, not copy — the dialog names elements in human terms.
		expect(html).toContain("Style");
		expect(html).toContain("Voice");
		expect(html).toContain("Keeps your 1 edit");
		expect(html).toContain("Aspect ratio");
		expect(html).toContain("Cancel");
		expect(html).toContain("Apply");
	});

	/* The case decision 11 makes unavoidable: every project that predates provenance
	 * reads as operator-owned throughout, so an apply legitimately replaces nothing. A
	 * dialog that did not say so would look broken, so it says it and offers the opt-in
	 * that makes the apply do something. */
	test("it says so plainly when there is nothing inherited to fill", () => {
		const html = renderToStaticMarkup(
			<PresetOverrideWarning
				presetName="Studio look"
				replaced={[]}
				kept={["style", "settings.voice"]}
				onConfirm={() => {}}
				onCancel={() => {}}
			/>,
		);
		expect(html).toContain("Nothing here is inherited");
		expect(html).toContain("Keeps your 2 edits");
		expect(html).toContain("Overwrite my edits too");
		// Apply would be a no-op without the opt-in, so it is disabled until ticked.
		expect(html).toContain("disabled");
	});

	test("with nothing kept there is no opt-in to offer", () => {
		const html = renderToStaticMarkup(
			<PresetOverrideWarning
				presetName="Studio look"
				replaced={["style"]}
				kept={[]}
				onConfirm={() => {}}
				onCancel={() => {}}
			/>,
		);
		expect(html).not.toContain("Overwrite my edits too");
		const applyAttrs = html.match(/<button([^>]*)>Apply<\/button>/)?.[1] ?? "";
		expect(applyAttrs).not.toMatch(/\bdisabled(?:=|\s|$)/);
	});

	test("picker lists presets and the confirmation gates confirm vs cancel", () => {
		const source = readFileSync(`${import.meta.dirname}/preset-picker.tsx`, "utf8");
		expect(source).toContain("listContentPresets(");
		expect(source).toContain("onConfirm");
		expect(source).toContain("onCancel");
	});

	test("the editor apply goes through the sourced rules behind the confirmation", () => {
		const style = readFileSync(`${import.meta.dirname}/editor-settings.tsx`, "utf8");
		// Picker selection stages a pending preset; only the confirmation's confirm calls
		// onApplyPreset — cancel clears it without applying.
		expect(style).toContain("setPendingPreset(preset)");
		expect(style).toContain("onApplyPreset(pendingPreset.bundle, meta, options)");
		expect(style).toContain("onCancel={() => setPendingPreset(null)}");
		// The dialog's report comes from the caller, computed by the same rule the apply
		// uses, so the two cannot describe different outcomes.
		expect(style).toContain("describeApply?.(pendingPreset.bundle, meta)");

		const editor = readFileSync(
			`${import.meta.dirname}/../timeline/timeline-panel-host.tsx`,
			"utf8",
		);
		expect(editor).toContain("applyPresetSourced(");
		expect(editor).toContain("describePresetApply(");
		expect(editor).toContain("setElementSources(next.sources)");
		// The unconditional replace is gone.
		expect(editor).not.toContain("applyPresetOverride(");
	});
});
