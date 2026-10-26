import { SHAPE_PRIMITIVES } from "@maleo/shared";
import type { TemplateItem, TemplateField } from "./types.ts";

const fields: TemplateField[] = [
	{ key: "fill", type: "text", label: "Fill", placeholder: "Empty uses brand accent" },
	{ key: "stroke", type: "text", label: "Stroke", placeholder: "#FFFFFF" },
	{ key: "strokeWidth", type: "number", label: "Stroke width", min: 0, max: 40, step: 1 },
	{ key: "opacity", type: "number", label: "Opacity", min: 0, max: 1, step: 0.05 },
];
export const SHAPE_TEMPLATE_ITEMS: TemplateItem[] = SHAPE_PRIMITIVES.map((shape) => ({
	kind: "text",
	preset: shape.preset,
	label: shape.label,
	category: "shape",
	intent: "Shape primitive",
	fields:
		shape.preset === "shape-rect"
			? [
					...fields,
					{ key: "radius", type: "number", label: "Corner radius", min: 0, max: 200, step: 1 },
				]
			: fields,
	defaultParams: { ...shape.defaultParams },
}));
