import type { ClipLayout, TemplateParams } from "@maleo/shared";
export { SHAPE_PRIMITIVES as SHAPE_ELEMENTS } from "@maleo/shared";
import { SHAPE_PRIMITIVES } from "@maleo/shared";
export function shapeElement(preset: string | undefined) {
	return SHAPE_PRIMITIVES.find((item) => item.preset === preset);
}
/** Keep a new primitive's visible proportions across canvas aspect ratios. */
export function initialShapeLayout(preset: string, aspect: number): ClipLayout | undefined {
	if (!shapeElement(preset)) return undefined;
	const frameAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
	const ratio = preset === "shape-rect" ? 4 : 1;
	const maxHeightPct = preset === "shape-rect" ? 16 : 32;
	const widthPct = Math.min(40, (maxHeightPct * ratio) / frameAspect);
	const heightPct = (widthPct * frameAspect) / ratio;
	return {
		xPct: (100 - widthPct) / 2,
		yPct: (100 - heightPct) / 2,
		widthPct,
		heightPct,
		fit: "contain",
	};
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
