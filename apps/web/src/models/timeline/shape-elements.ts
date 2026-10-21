import type { TemplateParams } from "@maleo/shared";
export const SHAPE_ELEMENTS = [
	{ preset: "shape-rect", label: "Rectangle", kind: "Shape" },
	{ preset: "shape-circle", label: "Circle", kind: "Shape" },
] as const;
export function shapeElement(preset: string | undefined) {
	return SHAPE_ELEMENTS.find((item) => item.preset === preset);
}
/** Numeric shape edits are finite and non-negative, including valid zero. */
export function patchShapeNumber(
	params: TemplateParams | undefined,
	key: "strokeWidth" | "radius",
	value: number,
): TemplateParams | undefined {
	if (!Number.isFinite(value) || value < 0) return undefined;
	return { ...params, [key]: value };
}
