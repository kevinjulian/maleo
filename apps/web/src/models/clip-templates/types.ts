import type { TextPreset, TemplateParams } from "@maleo/shared";

export type TemplateCategory = "all" | "text" | "shape" | "motion";

// Which style controls the edit popover should show for a template. A template
// only advertises the knobs its renderer actually honors, so the popover never
// shows a dead control (e.g. Background on a transparent overlay, or Body on a
// single-line template).
export type StyleKnob = "fg" | "bg" | "accent" | "body" | "scale" | "font";

export const TEMPLATE_CATEGORIES: Array<{ id: TemplateCategory; label: string }> = [
	{ id: "all", label: "All" },
	{ id: "text", label: "Text" },
	{ id: "shape", label: "Shapes" },
	{ id: "motion", label: "Motion" },
];

// Describes one editable content field on a text template. The edit panel
// renders a form from this list instead of one freeform textarea — each
// template declares the exact fields its render actually consumes.
export type TemplateField =
	| { key: string; type: "text"; label: string; placeholder?: string }
	| { key: string; type: "textarea"; label: string; placeholder?: string }
	| { key: string; type: "number"; label: string; min?: number; max?: number; step?: number }
	| { key: string; type: "image"; label: string }
	| { key: string; type: "list"; label: string; itemLabel: string; itemFields: TemplateField[] };

// One clip template = one placeable timeline item. `kind: "text"` routes it
// through the text preset system on drop/click.
// Text templates carry a `fields` schema + `defaultParams` — the structured
// content the edit panel and the renderer read from `TextOverlay.params`,
// distinct from the generic `style` (color/font/align) editor.
export type TemplateItem = {
	kind: "text";
	preset: TextPreset;
	label: string;
	category: TemplateCategory;
	intent: string;
	fields: TemplateField[];
	defaultParams: TemplateParams;
};
