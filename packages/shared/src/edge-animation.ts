import {
	NUMERIC_ANIMATION_PROPERTIES,
	type NumericAnimationProperty,
} from "./animation-properties.ts";
import type { Animation } from "./clip-animation.ts";
import type { ValueKeyframe } from "./timeline-model.ts";

export type AnimationEdge = "in" | "out";
export type EdgePreset = "none" | "fade" | "slide" | "zoom";
const properties = ["opacity", "volume", "xPct", "scale"] as const;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const baseValue = (
	property: NumericAnimationProperty,
	values: Partial<Record<NumericAnimationProperty, number>>,
) => values[property] ?? NUMERIC_ANIMATION_PROPERTIES[property].neutral;
const hiddenValue = (property: NumericAnimationProperty, base: number) =>
	property === "xPct"
		? Math.max(NUMERIC_ANIMATION_PROPERTIES.xPct.min, base - 50)
		: property === "scale"
			? Math.max(NUMERIC_ANIMATION_PROPERTIES.scale.min, base * 0.8)
			: 0;

/** Exact edge ramps remain ordinary keys; editing keys naturally turns a preset into Custom. */
export function edgeAnimation(
	animation: Animation | undefined,
	edge: AnimationEdge,
	duration: number,
	values: Partial<Record<NumericAnimationProperty, number>>,
	audio = false,
) {
	for (const property of properties) {
		if (audio ? property !== "volume" : property === "volume") continue;
		const keys = animation?.tracks[property] ?? [];
		if (keys.length < 2) continue;
		const pair = edge === "in" ? keys.slice(0, 2) : keys.slice(-2);
		const a = pair[0]!,
			b = pair[1]!;
		const base = baseValue(property, values),
			hidden = hiddenValue(property, base);
		if (near(base, hidden)) continue;
		if (
			edge === "in"
				? !near(a.t, 0) || b.t > duration / 2 + 1e-6 || !near(a.v, hidden) || !near(b.v, base)
				: !near(b.t, duration) ||
					a.t < duration / 2 - 1e-6 ||
					!near(a.v, base) ||
					!near(b.v, hidden)
		)
			continue;
		if (b.easing !== "in-out" || b.t <= a.t) continue;
		const preset: EdgePreset =
			property === "xPct" ? "slide" : property === "scale" ? "zoom" : "fade";
		return { preset, property, duration: b.t - a.t, pair };
	}
	return undefined;
}

/** Distinguish unrecognized authored edge keys from an empty edge. */
export function edgeAnimationState(
	animation: Animation | undefined,
	edge: AnimationEdge,
	duration: number,
	values: Partial<Record<NumericAnimationProperty, number>>,
	audio = false,
): EdgePreset | "custom" {
	const ramp = edgeAnimation(animation, edge, duration, values, audio);
	if (ramp) return ramp.preset;
	const opposite = edgeAnimation(animation, edge === "in" ? "out" : "in", duration, values, audio);
	const onEdge = (time: number) => (edge === "in" ? time <= duration / 2 : time >= duration / 2);
	const custom =
		Object.entries(animation?.tracks ?? {}).some(([property, keys]) =>
			keys?.some(
				(key) => onEdge(key.t) && !(property === opposite?.property && opposite.pair.includes(key)),
			),
		) ||
		Object.values(animation?.colorTracks ?? {}).some((keys) => keys?.some((key) => onEdge(key.t)));
	return custom ? "custom" : "none";
}

type EdgeTrackPatches = Partial<Record<NumericAnimationProperty, ValueKeyframe[]>>;

/** Track patches for one edge. Other properties and keys outside its old/new window survive. */
export function edgeAnimationTracks(
	animation: Animation | undefined,
	edge: AnimationEdge,
	preset: EdgePreset,
	seconds: number,
	duration: number,
	values: Partial<Record<NumericAnimationProperty, number>>,
	audio = false,
) {
	if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(duration) || duration <= 0)
		throw new Error("Animation duration must be positive");
	if (audio && preset !== "none" && preset !== "fade") throw new Error("Audio supports Fade only");
	const previous = edgeAnimation(animation, edge, duration, values, audio),
		opposite = edgeAnimation(animation, edge === "in" ? "out" : "in", duration, values, audio),
		tracks: EdgeTrackPatches = {};
	if (previous)
		tracks[previous.property] = (animation?.tracks[previous.property] ?? []).filter(
			(k) => !previous.pair.includes(k) || opposite?.pair.includes(k),
		);
	if (preset === "none") return tracks;
	const property =
		preset === "fade" ? (audio ? "volume" : "opacity") : preset === "slide" ? "xPct" : "scale";
	const span = Math.min(seconds, duration / 2),
		start = edge === "in" ? 0 : duration - span,
		end = edge === "in" ? span : duration;
	const base = baseValue(property, values),
		hidden = hiddenValue(property, base);
	const startEasing = animation?.tracks[property]?.find((k) => near(k.t, start))?.easing;
	const retained = (tracks[property] ?? animation?.tracks[property] ?? []).filter(
		(k) => k.t < start - 1e-6 || k.t > end + 1e-6,
	);
	tracks[property] = [
		...retained,
		{ t: start, v: edge === "in" ? hidden : base, ...(startEasing ? { easing: startEasing } : {}) },
		{ t: end, v: edge === "in" ? base : hidden, easing: "in-out" as const },
	].sort((a, b) => a.t - b.t);
	return tracks;
}
