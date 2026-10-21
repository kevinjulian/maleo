/* Samples a timeline text overlay's `layout.animation` (clip-local seconds) at one
 * moment. Pure, so the renderer and the parity test share it. Box properties move
 * the whole box (background included); blur applies to the text content. */
import {
	COLOR_ANIMATION_PROPERTIES,
	NUMERIC_ANIMATION_PROPERTIES,
	evaluateColorTrack,
	evaluateValueTrack,
	type Animation,
} from "@maleo/shared";

export type TextBoxLayout =
	| {
			xPct?: number;
			yPct?: number;
			widthPct?: number;
			heightPct?: number | null;
			rotationDeg?: number;
			opacity?: number;
	  }
	| null
	| undefined;
export type TextStyleBase =
	| {
			fontSize?: number;
			letterSpacing?: number;
			lineHeight?: number;
			bgOpacity?: number;
			fill?: string;
			bodyFill?: string;
			accent?: string;
			background?: string;
	  }
	| undefined;

export interface TextAnimationSample {
	box: {
		xPct: number;
		yPct: number;
		widthPct: number;
		heightPct?: number;
		rotationDeg: number;
		opacity: number;
		scale: number;
		bgOpacity: number;
	};
	blur: number;
	/** Only the style fields that have a track; the rest keep the static style. */
	style: Partial<{
		fontSize: number;
		letterSpacing: number;
		lineHeight: number;
		fill: string;
		bodyFill: string;
		accent: string;
		background: string;
	}>;
}

export function sampleTextAnimation(
	animation: Animation,
	layout: TextBoxLayout,
	style: TextStyleBase,
	seconds: number,
): TextAnimationSample {
	const value = (property: keyof typeof NUMERIC_ANIMATION_PROPERTIES, base: number | undefined) =>
		evaluateValueTrack(
			animation.tracks[property],
			seconds,
			base ?? NUMERIC_ANIMATION_PROPERTIES[property].neutral,
		);
	const heightBase = layout?.heightPct ?? undefined;
	const box = {
		xPct: value("xPct", layout?.xPct),
		yPct: value("yPct", layout?.yPct),
		widthPct: value("widthPct", layout?.widthPct),
		...(animation.tracks.heightPct || heightBase != null
			? { heightPct: value("heightPct", heightBase) }
			: {}),
		rotationDeg: value("rotationDeg", layout?.rotationDeg),
		opacity: value("opacity", layout?.opacity),
		scale: value("scale", undefined),
		bgOpacity: value("bgOpacity", style?.bgOpacity),
	};
	const out: TextAnimationSample["style"] = {};
	if (animation.tracks.fontSize) out.fontSize = value("fontSize", style?.fontSize);
	if (animation.tracks.letterSpacing)
		out.letterSpacing = value("letterSpacing", style?.letterSpacing);
	if (animation.tracks.lineHeight) out.lineHeight = value("lineHeight", style?.lineHeight);
	for (const property of ["fill", "bodyFill", "accent", "background"] as const) {
		const keys = animation.colorTracks?.[property];
		if (!keys) continue;
		const base = property === "bodyFill" ? (style?.bodyFill ?? style?.fill) : style?.[property];
		out[property] = evaluateColorTrack(
			keys,
			seconds,
			base ?? COLOR_ANIMATION_PROPERTIES[property].neutral,
		);
	}
	return { box, blur: value("blur", undefined), style: out };
}
