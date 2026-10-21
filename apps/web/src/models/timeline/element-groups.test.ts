import { describe, expect, it } from "vite-plus/test";
import type { TextPreset } from "@maleo/shared";
import {
	BASIC_TEXT_PRESETS,
	MOTION_TEXT_PRESETS,
	elementKindOfPreset,
	textOnlyPresets,
} from "./element-groups.ts";

// The plain Text presets the old Text panel showed.
const TEXT_PRESET_OPTIONS: TextPreset[] = [
	"title",
	"subtitle",
	"lower-third",
	"stat",
	"quote",
	"location",
	"timeline",
	"chapter",
	"explainer-card",
	"section-card",
];

describe("element-groups", () => {
	it("keeps static primitives out of styled text and motion", () => {
		for (const preset of ["plain", "shape-rect", "shape-circle"] as const) {
			expect(elementKindOfPreset(preset)).toBe(preset === "plain" ? "basic" : "shapes");
			expect(MOTION_TEXT_PRESETS.has(preset)).toBe(false);
		}
		expect(textOnlyPresets(["plain", "shape-rect", "shape-circle", "title"])).toEqual(["title"]);
	});

	it("classifies motion-backed presets as motion", () => {
		expect(elementKindOfPreset("explainer-card")).toBe("motion");
		expect(elementKindOfPreset("section-card")).toBe("motion");
	});

	it("classifies plain presets as text", () => {
		expect(elementKindOfPreset("title")).toBe("text");
		expect(elementKindOfPreset("subtitle")).toBe("text");
		expect(elementKindOfPreset("stat")).toBe("text");
	});

	it("dedupes shared presets out of the Text group", () => {
		const textOnly = textOnlyPresets(TEXT_PRESET_OPTIONS);
		expect(textOnly).not.toContain("explainer-card");
		expect(textOnly).not.toContain("section-card");
		expect(textOnly).toContain("title");
	});

	it("keeps every non-motion text preset reachable", () => {
		const textOnly = textOnlyPresets(TEXT_PRESET_OPTIONS);
		for (const preset of TEXT_PRESET_OPTIONS) {
			if (MOTION_TEXT_PRESETS.has(preset) || BASIC_TEXT_PRESETS.has(preset)) continue;
			expect(textOnly).toContain(preset);
		}
	});
});
