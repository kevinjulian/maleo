/* Keyframe and layer arithmetic for Motion Studio — the parts with no React in
 * them.
 *
 * Split out of `motion-studio-modal.tsx` because they never read a thing from
 * the component: every function here is a pure transform over a keyframe array
 * or a layer, which is why they sat above the component in the first place. The
 * modal owns the editing surface; this owns what an edit MEANS. */
import type {
	AnimatableProp,
	ColorKeyframe,
	CompositionLayer,
	TextPreset,
	ValueKeyframe,
} from "@maleo/shared";
import { findTextTemplate } from "@models/clip-templates/registry.ts";

/** The value each animatable property holds when nothing has keyframed it. */
export const PROP_BASE = {
	x: 0,
	y: 0,
	scale: 1,
	rotate: 0,
	opacity: 1,
	width: 100,
	height: 100,
	blur: 0,
	bgOpacity: 0,
	fontSize: 64,
	letterSpacing: 0,
	lineHeight: 1.1,
} satisfies Record<AnimatableProp, number>;

export const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
export const sortKfs = (kfs: ValueKeyframe[]): ValueKeyframe[] =>
	[...kfs].sort((a, b) => a.t - b.t);
export const sortColorKfs = (kfs: ColorKeyframe[]): ColorKeyframe[] =>
	[...kfs].sort((a, b) => a.t - b.t);

export const layoutOf = (layer: CompositionLayer): NonNullable<CompositionLayer["layout"]> =>
	layer.layout ?? { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100, fit: "contain" as const };

/* Keyframes within 20ms of each other are the same keyframe. Auto-key writes on
 * every input change, and without the tolerance a slider drag would leave a
 * cluster of near-identical marks the operator then has to delete one by one. */
const SAME_KEYFRAME_SEC = 0.02;

/** Insert or replace (within tolerance) a keyframe at t. */
export function writeKey(kfs: ValueKeyframe[], t: number, v: number): ValueKeyframe[] {
	const near = kfs.findIndex((k) => Math.abs(k.t - t) < SAME_KEYFRAME_SEC);
	if (near >= 0) return kfs.map((k, i) => (i === near ? { ...k, v } : k));
	return sortKfs([...kfs, { t, v, easing: "linear" }]);
}

export function writeColorKey(kfs: ColorKeyframe[], t: number, v: string): ColorKeyframe[] {
	const near = kfs.findIndex((k) => Math.abs(k.t - t) < SAME_KEYFRAME_SEC);
	if (near >= 0) return kfs.map((k, i) => (i === near ? { ...k, v } : k));
	return sortColorKfs([...kfs, { t, v, easing: "linear" }]);
}

/** A `<input type="color">` will not display anything but `#rrggbb`, so a short
 *  hex is expanded and anything else falls back rather than rendering blank. */
export function hexInput(color: string | undefined, fallback: string): string {
	const raw = (color || fallback).trim();
	if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
	const short = raw.match(/^#([0-9a-f]{3})$/i);
	if (short)
		return `#${short[1]!
			.split("")
			.map((x) => `${x}${x}`)
			.join("")}`;
	return fallback;
}

export function newLayer(preset: TextPreset, durationSec: number): CompositionLayer {
	const template = findTextTemplate(preset);
	const layout =
		preset === "shape-rect"
			? { xPct: 30, yPct: 42, widthPct: 40, heightPct: 16, fit: "contain" as const }
			: preset === "shape-circle"
				? { xPct: 40, yPct: 40, widthPct: 20, heightPct: 20, fit: "contain" as const }
				: { xPct: 8, yPct: 34, widthPct: 84, heightPct: 32, fit: "contain" as const };
	return {
		id: Date.now(),
		content: preset === "title" ? "Title" : "",
		start: 0,
		dur: durationSec,
		preset,
		track: 0,
		layout,
		...(template ? { params: { ...template.defaultParams } } : {}),
	};
}

export function layerLabel(o: CompositionLayer): string {
	if (o.preset === "shape-rect") return "Rectangle";
	if (o.preset === "shape-circle") return "Circle";
	const template = findTextTemplate(o.preset);
	return o.content?.trim() || template?.label || o.preset;
}
