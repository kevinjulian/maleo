/* The one registry of animatable clip and overlay properties (keyframe-animation).
 * Schemas, inspector labels and limits, canvas auto-key, and key-command
 * validation all derive from this table, so adding a property is one entry here.
 * Scene camera motion (`CustomMotion`) is a separate model and is not listed. */
import { keysOf } from "./object-keys.ts";

/** Interpolation of the segment entering a key. `hold` steps at the key; `bezier` survives from legacy text keys. */
export const KEYFRAME_EASINGS = ["linear", "in", "out", "in-out", "bezier", "hold"] as const;
export type KeyframeEasing = (typeof KEYFRAME_EASINGS)[number];

export const ANIMATION_ELEMENT_KINDS = ["image", "video", "audio", "text"] as const;
export type AnimationElementKind = (typeof ANIMATION_ELEMENT_KINDS)[number];

export interface NumericPropertySpec {
	label: string;
	/** Display unit; `percent` values are stored as fractions and shown ×100. */
	unit: "%" | "percent" | "deg" | "px" | "gain" | "x" | "em" | "";
	min: number;
	max: number;
	/** Value when neither a key nor a static layout/style value exists. */
	neutral: number;
	kinds: readonly AnimationElementKind[];
}

export interface ColorPropertySpec {
	label: string;
	neutral: string;
	kinds: readonly AnimationElementKind[];
}

const BOX: readonly AnimationElementKind[] = ["image", "video", "text"];
const TEXT: readonly AnimationElementKind[] = ["text"];

export const NUMERIC_ANIMATION_PROPERTIES = {
	xPct: { label: "Position X", unit: "%", min: -50, max: 150, neutral: 0, kinds: BOX },
	yPct: { label: "Position Y", unit: "%", min: -50, max: 150, neutral: 0, kinds: BOX },
	scale: { label: "Scale", unit: "percent", min: 0.01, max: 10, neutral: 1, kinds: BOX },
	rotationDeg: { label: "Rotation", unit: "deg", min: -360, max: 360, neutral: 0, kinds: BOX },
	opacity: { label: "Opacity", unit: "percent", min: 0, max: 1, neutral: 1, kinds: BOX },
	volume: { label: "Gain", unit: "gain", min: 0, max: 1, neutral: 1, kinds: ["video", "audio"] },
	widthPct: { label: "Width", unit: "%", min: 0, max: 400, neutral: 100, kinds: TEXT },
	heightPct: { label: "Height", unit: "%", min: 0, max: 400, neutral: 100, kinds: TEXT },
	blur: { label: "Blur", unit: "px", min: 0, max: 200, neutral: 0, kinds: TEXT },
	bgOpacity: {
		label: "Background opacity",
		unit: "percent",
		min: 0,
		max: 1,
		neutral: 0,
		kinds: TEXT,
	},
	fontSize: { label: "Font size", unit: "px", min: 1, max: 1000, neutral: 64, kinds: TEXT },
	letterSpacing: {
		label: "Letter spacing",
		unit: "px",
		min: -100,
		max: 100,
		neutral: 0,
		kinds: TEXT,
	},
	lineHeight: { label: "Line height", unit: "x", min: 0.1, max: 10, neutral: 1.1, kinds: TEXT },
} as const satisfies Record<string, NumericPropertySpec>;

export const COLOR_ANIMATION_PROPERTIES = {
	fill: { label: "Fill", neutral: "#ffffff", kinds: TEXT },
	bodyFill: { label: "Body fill", neutral: "#ffffff", kinds: TEXT },
	accent: { label: "Accent", neutral: "#7C66FF", kinds: TEXT },
	background: { label: "Background", neutral: "#000000", kinds: TEXT },
} as const satisfies Record<string, ColorPropertySpec>;

export type NumericAnimationProperty = keyof typeof NUMERIC_ANIMATION_PROPERTIES;
export type ColorAnimationProperty = keyof typeof COLOR_ANIMATION_PROPERTIES;
export type AnimationProperty = NumericAnimationProperty | ColorAnimationProperty;

export const NUMERIC_ANIMATION_PROPERTY_NAMES: NumericAnimationProperty[] = keysOf(
	NUMERIC_ANIMATION_PROPERTIES,
);
export const COLOR_ANIMATION_PROPERTY_NAMES: ColorAnimationProperty[] = keysOf(
	COLOR_ANIMATION_PROPERTIES,
);

export function isNumericAnimationProperty(name: string): name is NumericAnimationProperty {
	return Object.hasOwn(NUMERIC_ANIMATION_PROPERTIES, name);
}

export function isColorAnimationProperty(name: string): name is ColorAnimationProperty {
	return Object.hasOwn(COLOR_ANIMATION_PROPERTIES, name);
}

/** Numeric properties a given element kind may animate, in registry order. */
export function numericPropertiesFor(kind: AnimationElementKind): NumericAnimationProperty[] {
	return NUMERIC_ANIMATION_PROPERTY_NAMES.filter((p) =>
		NUMERIC_ANIMATION_PROPERTIES[p].kinds.some((k) => k === kind),
	);
}

export function colorPropertiesFor(kind: AnimationElementKind): ColorAnimationProperty[] {
	return COLOR_ANIMATION_PROPERTY_NAMES.filter((p) =>
		COLOR_ANIMATION_PROPERTIES[p].kinds.some((k) => k === kind),
	);
}
