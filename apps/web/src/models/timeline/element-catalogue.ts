/* Shared editor/Library vocabulary; previews belong to their component owner. */
import { SHAPE_PRIMITIVES, type TextPreset } from "@maleo/shared";
export const TEXT_PRESET_OPTIONS: TextPreset[] = ["plain"];
export type TextPresetCopy = Partial<Record<TextPreset, string>>;
export const TEXT_PRESET_LABELS: TextPresetCopy = Object.fromEntries([
	["plain", "Text"],
	...SHAPE_PRIMITIVES.map((shape) => [shape.preset, shape.label]),
]);
export const BUILT_IN_TEXT_PRESETS: readonly TextPreset[] = TEXT_PRESET_OPTIONS;
export function textPresetLabel(preset: TextPreset): string {
	return TEXT_PRESET_LABELS[preset] ?? preset;
}
export function textPresetSample(preset: TextPreset): string {
	return textPresetLabel(preset);
}
