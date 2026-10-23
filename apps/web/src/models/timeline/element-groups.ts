/* Maleo — element grouping for the unified Elements menu. Text and Motion
 * draw from different source lists; this module owns the one place that
 * decides which group a text preset belongs to so the picker and any dedupe
 * agree. Motion templates (rve-* and animated cards) win over the
 * plain Text presets, so a preset present in both shows only under Motion. */
import { shapeElement } from "./shape-elements.ts";
import { TEMPLATE_ITEMS } from "@models/clip-templates/registry.ts";
import type { TextPreset } from "@maleo/shared";

export type ElementKind = "basic" | "shapes" | "text" | "motion";

export const BASIC_TEXT_PRESETS: ReadonlySet<string> = new Set([
	"plain",
	"shape-rect",
	"shape-circle",
]);

/** Preset ids backed by a motion template (the Motion group's built-ins). */
export const MOTION_TEXT_PRESETS: ReadonlySet<string> = new Set(
	TEMPLATE_ITEMS.filter(
		(i): i is Extract<typeof i, { kind: "text" }> =>
			i.kind === "text" && !BASIC_TEXT_PRESETS.has(i.preset),
	).map((i) => i.preset),
);

/** Filter the plain Text presets down to those NOT also owned by Motion, so
 * `explainer-card` / `section-card` (present in both) appear only under Motion. */
export function textOnlyPresets(all: readonly TextPreset[]): TextPreset[] {
	return all.filter(
		(preset) => !MOTION_TEXT_PRESETS.has(preset) && !BASIC_TEXT_PRESETS.has(preset),
	);
}

/** Group a text preset: motion when a motion template backs it, else text. */
export function elementKindOfPreset(preset: TextPreset): ElementKind {
	return shapeElement(preset)
		? "shapes"
		: BASIC_TEXT_PRESETS.has(preset)
			? "basic"
			: MOTION_TEXT_PRESETS.has(preset)
				? "motion"
				: "text";
}
