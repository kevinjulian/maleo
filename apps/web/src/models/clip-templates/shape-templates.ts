/* Plain shapes. Colour and size live in their own params, so the style
 * popover offers only `scale` (see STYLE_KNOB_OVERRIDES in registry.ts). */
import type { TemplateItem } from "./types.ts";

export const shapeRect: TemplateItem = {
	kind: "text",
	preset: "shape-rect",
	label: "Rectangle",
	category: "shape",
	intent: "Solid block, banner bar, backdrop",
	fields: [
		{ key: "fill", type: "text", label: "Fill", placeholder: "#4361EE (empty = brand accent)" },
		{ key: "stroke", type: "text", label: "Stroke", placeholder: "#FFFFFF" },
		{ key: "strokeWidth", type: "number", label: "Stroke width", min: 0, max: 40, step: 1 },
		{ key: "radius", type: "number", label: "Corner radius", min: 0, max: 200, step: 1 },
		{ key: "opacity", type: "number", label: "Opacity", min: 0, max: 1, step: 0.05 },
	],
	defaultParams: { fill: "", stroke: "", strokeWidth: 0, radius: 12, opacity: 1 },
};

export const shapeCircle: TemplateItem = {
	kind: "text",
	preset: "shape-circle",
	label: "Circle",
	category: "shape",
	intent: "Dot, badge backdrop, pulse target",
	fields: [
		{ key: "fill", type: "text", label: "Fill", placeholder: "#4361EE (empty = brand accent)" },
		{ key: "stroke", type: "text", label: "Stroke", placeholder: "#FFFFFF" },
		{ key: "strokeWidth", type: "number", label: "Stroke width", min: 0, max: 40, step: 1 },
		{ key: "opacity", type: "number", label: "Opacity", min: 0, max: 1, step: 0.05 },
	],
	defaultParams: { fill: "", stroke: "", strokeWidth: 0, opacity: 1 },
};
