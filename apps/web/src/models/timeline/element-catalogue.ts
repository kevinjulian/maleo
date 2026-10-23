/* The built-in placeable elements, as data.
 *
 * These lists used to live inside the editor's own panel components — the text
 * presets and their labels in `timeline-editor-panels.tsx`. That was fine while the Elements rail was
 * the only thing that read them. Library > Elements is a second reader, and a
 * catalogue that had to import an editor panel to learn what a Title element is
 * would either drag the editor into the library or, far more likely, grow its
 * own copy of the list and drift.
 *
 * So the definitions live here and the panels re-export them from their old
 * paths. Nothing about a built-in element's identity needs React, a timeline, a
 * playhead or a project.
 *
 * What is NOT here: previews. `TextPresetPreview` already defaults `brand` to
 * `DEFAULT_BRAND`, so it renders outside a project without a stand-in — it is a
 * component, it stays in component files, and both readers call it directly.
 */
import { DEFAULT_TEXT_BY_PRESET } from "./timeline-editor-model.ts";
import { TEMPLATE_ITEMS } from "@models/clip-templates/registry.ts";
import type { TemplateItem } from "@models/clip-templates/registry.ts";
import type { TextPreset } from "@maleo/shared";
import { elementKindOfPreset, textOnlyPresets } from "./element-groups.ts";

/** Every text preset the editor offers, in the order it offers them. */
export const TEXT_PRESET_OPTIONS: TextPreset[] = [
	"plain",
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

/* Named, because both maps are deliberately partial: a preset without an entry
 * falls back to its own id, which is what `textPresetLabel` does. */
export type TextPresetCopy = Partial<Record<TextPreset, string>>;

export const TEXT_PRESET_LABELS = {
	plain: "Text",
	"shape-rect": "Rectangle",
	"shape-circle": "Circle",
	title: "Title",
	subtitle: "Subtitle",
	"lower-third": "Lower third",
	stat: "Stat",
	quote: "Quote",
	location: "Location",
	timeline: "Timeline",
	chapter: "Chapter",
	"explainer-card": "Explainer card",
	"section-card": "Section card",
} satisfies TextPresetCopy;

/** The words a preview renders, so a tile shows the shape rather than a name. */
export const TEXT_PRESET_SAMPLES = {
	...DEFAULT_TEXT_BY_PRESET,
	"shape-rect": "Rectangle",
	"shape-circle": "Circle",
	plain: "Text",
	title: "Launch Moment",
	subtitle: "Short supporting line",
	"lower-third": "Field note",
	stat: "42%",
	quote: "This changes the frame.",
	location: "Jakarta",
	timeline: "00:12",
	chapter: "Chapter One",
	"explainer-card": "A forbidden object instantly creates curiosity.\nIt is like a wet paint sign.",
	"section-card": "Can he resist?",
} satisfies TextPresetCopy;

/** Static primitives share normal text/shape clips and keyframe controls. */
export const BASIC_ELEMENTS: ReadonlyArray<{
	preset: TextPreset;
	label: string;
	kind: "Text" | "Shape";
}> = [{ preset: "plain", label: "Text", kind: "Text" }];

/** Animated text-kind entries; static shapes belong to Basic. */
export const MOTION_ITEMS: ReadonlyArray<Extract<TemplateItem, { kind: "text" }>> =
	TEMPLATE_ITEMS.filter(
		(item): item is Extract<TemplateItem, { kind: "text" }> =>
			item.kind === "text" && elementKindOfPreset(item.preset) === "motion",
	);

/** The plain Text presets — those not already owned by a motion template. */
export const BUILT_IN_TEXT_PRESETS: readonly TextPreset[] = textOnlyPresets(TEXT_PRESET_OPTIONS);

/* The maps are `satisfies`-checked so they keep their literal key evidence, which
 * also means they cannot be indexed by an arbitrary `TextPreset`: that type has
 * some forty members and these two cover the ten plain presets. Reading them goes
 * through here, where the open contract is a parameter rather than a binding and
 * a missing entry has a defined answer. */
function copyOf(map: TextPresetCopy, preset: TextPreset): string | undefined {
	return map[preset];
}

/** A preset's display name, falling back to its own id. */
export function textPresetLabel(preset: TextPreset): string {
	return copyOf(TEXT_PRESET_LABELS, preset) ?? preset;
}

/** The words a preview renders for a preset, falling back to its label. */
export function textPresetSample(preset: TextPreset): string {
	return copyOf(TEXT_PRESET_SAMPLES, preset) ?? textPresetLabel(preset);
}

/** Same, but for callers that already have a better fallback than the preset id
 *  — a motion template's own label, for instance. */
export function textPresetSampleOr(preset: TextPreset, fallback: string): string {
	return copyOf(TEXT_PRESET_SAMPLES, preset) ?? fallback;
}
