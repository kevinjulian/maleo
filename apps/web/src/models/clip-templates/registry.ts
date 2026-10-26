import { shapePrimitiveOf, type TextPreset } from "@maleo/shared";
import type { StyleKnob, TemplateItem } from "./types.ts";
import { SHAPE_TEMPLATE_ITEMS } from "./shape-templates.ts";
export type { TemplateCategory, TemplateItem, TemplateField, StyleKnob } from "./types.ts";
export { TEMPLATE_CATEGORIES } from "./types.ts";

export function styleKnobsFor(preset: string): StyleKnob[] {
	return shapePrimitiveOf(preset) ? ["scale"] : ["fg", "bg", "scale", "font"];
}
export const TEMPLATE_ITEMS: TemplateItem[] = [
	{
		kind: "text",
		preset: "plain",
		label: "Text",
		category: "text",
		intent: "Plain text",
		fields: [],
		defaultParams: {},
	},
	...SHAPE_TEMPLATE_ITEMS,
];
export function findTextTemplate(preset: TextPreset): TemplateItem | undefined {
	return TEMPLATE_ITEMS.find((item) => item.preset === preset);
}
