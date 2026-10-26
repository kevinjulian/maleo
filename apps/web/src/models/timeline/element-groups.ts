import { shapePrimitiveOf, type ClipTemplate, type TextPreset } from "@maleo/shared";

export type ElementKind = "shapes" | "text" | "motion";
export function textOnlyPresets(all: readonly TextPreset[]): TextPreset[] {
	return all.filter((preset) => preset === "plain");
}
export function elementKindOfPreset(preset: TextPreset): ElementKind {
	return shapePrimitiveOf(preset) ? "shapes" : preset === "motion-comp" ? "motion" : "text";
}

export function templateElementGroup(template: Pick<ClipTemplate, "kind" | "base">): ElementKind {
	return template.kind === "composition"
		? "motion"
		: shapePrimitiveOf(template.base)
			? "shapes"
			: "text";
}
