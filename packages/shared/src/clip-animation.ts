import { clipCompositingBlockers } from "./clip-compositing.ts";
import { z } from "zod";
import { evaluateColorTrack, evaluateValueTrack } from "./keyframe-evaluation.ts";
import { entriesOfUnknown } from "./object-keys.ts";
import {
	COLOR_ANIMATION_PROPERTY_NAMES,
	KEYFRAME_EASINGS,
	NUMERIC_ANIMATION_PROPERTIES,
	NUMERIC_ANIMATION_PROPERTY_NAMES,
	colorPropertiesFor,
	numericPropertiesFor,
	type AnimationElementKind,
	type ColorAnimationProperty,
	type KeyframeEasing,
	type NumericAnimationProperty,
} from "./animation-properties.ts";
import type { ColorKeyframe, ValueKeyframe } from "./timeline-model.ts";

/** The box properties ordinary visual clips have always animated, plus gain. */
export const CLIP_ANIMATION_PROPERTIES = [
	"xPct",
	"yPct",
	"scale",
	"rotationDeg",
	"opacity",
	"volume",
] as const satisfies readonly NumericAnimationProperty[];
export type ClipAnimationProperty = NumericAnimationProperty;
/** Easings the editor offers; stored keys may also carry `bezier` from legacy text. */
export const CLIP_ANIMATION_EASINGS = ["linear", "in", "out", "in-out", "hold"] as const;

/** One animation value for any clip or overlay (keyframe-animation): per-property
 *  tracks in clip-local seconds. */
export interface Animation {
	tracks: Partial<Record<NumericAnimationProperty, ValueKeyframe[]>>;
	colorTracks?: Partial<Record<ColorAnimationProperty, ColorKeyframe[]>>;
}
export type ClipAnimation = Animation;
export type AudioAnimation = Animation;

const easing = z.enum(KEYFRAME_EASINGS).optional();
const increasing = (keys: readonly { t: number }[]) =>
	keys.every((k, i) => i === 0 || k.t > keys[i - 1]!.t);
const easingRange = z
	.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)])
	.refine(([a, b]) => b > a, "Easing range must increase")
	.optional();
const valueTrack = (min: number, max: number) =>
	z
		.array(
			z
				.object({
					t: z.number().finite().min(0),
					v: z.number().finite().min(min).max(max),
					easing,
					easingRange,
				})
				.strict(),
		)
		.refine(increasing, "Keyframe times must increase without duplicates");
const colorTrack = z
	.array(
		z
			.object({
				t: z.number().finite().min(0),
				v: z.string().trim().min(1).max(200),
				easing,
				easingRange,
			})
			.strict(),
	)
	.refine(increasing, "Keyframe times must increase without duplicates");

/** A zod shape with one entry per registry name; the keys stay literal. */
function recordShape<K extends string, V extends z.ZodTypeAny>(
	keys: readonly K[],
	make: (key: K) => V,
): { [P in K]: V } {
	// SAFETY: `Object.fromEntries` widens keys to `string`; every key here comes from
	// `keys`, so the result has exactly the entries `{ [P in K]: V }` declares.
	return Object.fromEntries(keys.map((key) => [key, make(key)])) as { [P in K]: V };
}

/** Every registry property, typed: the union of what any kind may carry. */
const anyKindAnimationSchema = z
	.object({
		tracks: z
			.object(
				recordShape(NUMERIC_ANIMATION_PROPERTY_NAMES, (p) =>
					valueTrack(
						NUMERIC_ANIMATION_PROPERTIES[p].min,
						NUMERIC_ANIMATION_PROPERTIES[p].max,
					).optional(),
				),
			)
			.strict(),
		colorTracks: z
			.object(recordShape(COLOR_ANIMATION_PROPERTY_NAMES, () => colorTrack.optional()))
			.strict()
			.optional(),
	})
	.strict();

/** Strict schema for one element kind: only the properties the registry allows it. */
export function animationSchemaFor(kind: AnimationElementKind): z.ZodType<Animation> {
	const numeric = new Set<string>(numericPropertiesFor(kind)),
		colors = new Set<string>(colorPropertiesFor(kind));
	return anyKindAnimationSchema.superRefine((animation, ctx) => {
		for (const [property, keys] of Object.entries(animation.tracks))
			if (keys && !numeric.has(property))
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["tracks", property],
					message: `${property} is not animatable on a ${kind} clip`,
				});
		for (const [property, keys] of Object.entries(animation.colorTracks ?? {}))
			if (keys && !colors.has(property))
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["colorTracks", property],
					message: `${property} is not animatable on a ${kind} clip`,
				});
	});
}

/** Visual clips (image/video): box properties and source gain. Image gain is rejected by the blockers. */
export const clipAnimationSchema = animationSchemaFor("video");
export const audioAnimationSchema = animationSchemaFor("audio");
export const textAnimationSchema = animationSchemaFor("text");

export function sampleClipProperty(
	animation: Animation | undefined,
	property: NumericAnimationProperty,
	seconds: number,
	fallback: number,
): number {
	return evaluateValueTrack(animation?.tracks[property], seconds, fallback);
}

export function sampleClipTransform(
	layout:
		| {
				animation?: ClipAnimation;
				xPct?: number;
				yPct?: number;
				rotationDeg?: number;
				opacity?: number;
		  }
		| undefined,
	seconds: number,
) {
	return {
		xPct: sampleClipProperty(layout?.animation, "xPct", seconds, layout?.xPct ?? 0),
		yPct: sampleClipProperty(layout?.animation, "yPct", seconds, layout?.yPct ?? 0),
		scale: sampleClipProperty(layout?.animation, "scale", seconds, 1),
		rotationDeg: sampleClipProperty(
			layout?.animation,
			"rotationDeg",
			seconds,
			layout?.rotationDeg ?? 0,
		),
		opacity: sampleClipProperty(layout?.animation, "opacity", seconds, layout?.opacity ?? 1),
	};
}

type RetainableKey<V> = {
	t: number;
	v: V;
	easing?: KeyframeEasing;
	easingRange?: [number, number];
};

/** Keys for one track inside [from, to], re-based to `from`. Boundary values keep
 *  the original easing subcurve rather than restarting it. */
function retainTrack<V>(
	keys: readonly RetainableKey<V>[],
	from: number,
	to: number,
	sample: (time: number) => V,
): RetainableKey<V>[] {
	const times = [from, ...keys.filter((k) => k.t > from && k.t < to).map((k) => k.t), to];
	return times.map((time, i) => {
		const point: RetainableKey<V> = { t: time - from, v: sample(time) };
		if (i === 0) return point;
		const end = keys.findIndex((k) => k.t >= time),
			b = keys[end],
			a = keys[end - 1];
		if (!a || !b) return point;
		// A step has no subcurve: the retained boundary values already carry it.
		if (b.easing === "hold") return { ...point, easing: b.easing };
		const [low, high] = b.easingRange ?? [0, 1],
			span = b.t - a.t;
		const left = Math.max(0, Math.min(1, (times[i - 1]! - a.t) / span)),
			right = Math.max(0, Math.min(1, (time - a.t) / span));
		const easingRange: [number, number] = [low + (high - low) * left, low + (high - low) * right];
		return { ...point, easing: b.easing, ...(left === 0 && right === 1 ? {} : { easingRange }) };
	});
}

/** The window [from, to] of an animation, in the window's own local seconds. */
export function retainClipAnimation<T extends Animation>(
	animation: T | undefined,
	from: number,
	to: number,
): T | undefined {
	if (!animation) return undefined;
	if (![from, to].every(Number.isFinite) || to <= from) throw new Error("Invalid animation window");
	const tracks: Animation["tracks"] = {};
	for (const property of NUMERIC_ANIMATION_PROPERTY_NAMES) {
		const keys = animation.tracks[property];
		if (keys?.length)
			tracks[property] = retainTrack(keys, from, to, (time) =>
				evaluateValueTrack(keys, time, keys[0]!.v),
			);
	}
	const colorTracks: NonNullable<Animation["colorTracks"]> = {};
	for (const property of COLOR_ANIMATION_PROPERTY_NAMES) {
		const keys = animation.colorTracks?.[property];
		if (keys?.length)
			colorTracks[property] = retainTrack(keys, from, to, (time) =>
				evaluateColorTrack(keys, time, keys[0]!.v),
			);
	}
	return { ...animation, tracks, ...(animation.colorTracks ? { colorTracks } : {}) };
}

/** Constant retime scales local key time; values/easing remain authored. */
export function retimeClipAnimation<T extends Animation>(
	animation: T | undefined,
	ratio: number,
): T | undefined {
	if (!animation) return undefined;
	if (!Number.isFinite(ratio) || ratio <= 0) throw new Error("Invalid animation rate");
	const scale = <K extends { t: number }>(keys: readonly K[]) =>
		keys.map((k) => ({ ...k, t: k.t * ratio }));
	const tracks: Animation["tracks"] = {};
	for (const property of NUMERIC_ANIMATION_PROPERTY_NAMES) {
		const keys = animation.tracks[property];
		if (keys) tracks[property] = scale(keys);
	}
	const colorTracks: NonNullable<Animation["colorTracks"]> = {};
	for (const property of COLOR_ANIMATION_PROPERTY_NAMES) {
		const keys = animation.colorTracks?.[property];
		if (keys) colorTracks[property] = scale(keys);
	}
	return { ...animation, tracks, ...(animation.colorTracks ? { colorTracks } : {}) };
}

/** The element kind an animation belongs to, from the row itself or the clip payload key it sits under. */
function animationKindOf(
	row: ReadonlyMap<string, unknown>,
	hint: AnimationElementKind | undefined,
): AnimationElementKind {
	const kind = row.get("kind");
	if (AUDIO_KINDS.includes(String(kind))) return "audio";
	if (kind === "image" || kind === "video") return kind;
	return hint ?? "video";
}
const AUDIO_KINDS = ["voiceover", "music", "sfx", "ambient", "accent_hit"];
const PAYLOAD_KINDS = new Map<string, AnimationElementKind>([
	["text", "text"],
	["textOverlays", "text"],
	["audio", "audio"],
	["audioOverlays", "audio"],
]);

/** Reject malformed authored tracks before render projection can hide them. */
export function clipAnimationBlockers(input: unknown): string[] {
	const blockers: string[] = [];
	const visit = (value: unknown, hint?: AnimationElementKind): void => {
		if (Array.isArray(value)) {
			value.forEach((v) => visit(v, hint));
			return;
		}
		const row = new Map(entriesOfUnknown(value));
		if (!row.size) return;
		const kind = animationKindOf(row, hint);
		const animation =
			kind === "audio"
				? row.get("animation")
				: new Map(entriesOfUnknown(row.get("layout"))).get("animation");
		if (animation !== undefined) {
			const checked = animationSchemaFor(kind).safeParse(animation);
			const durationSec = row.get("durationSec"),
				dur = row.get("dur");
			const duration =
				typeof durationSec === "number" ? durationSec : typeof dur === "number" ? dur : undefined;
			const keyTimes = checked.success
				? [
						...Object.values(checked.data.tracks),
						...Object.values(checked.data.colorTracks ?? {}),
					].flatMap((keys) => keys?.map((k) => k.t) ?? [])
				: [];
			if (
				!checked.success ||
				(duration !== undefined && keyTimes.some((t) => t > duration + 1e-6))
			) {
				const label = row.get("label");
				blockers.push(
					`${typeof label === "string" ? label : "Clip"}: keyframes are invalid or outside the clip. Repair keys before export.`,
				);
			}
		}
		for (const [key, child] of row)
			if (key !== "layout" && key !== "animation") visit(child, PAYLOAD_KINDS.get(key));
	};
	visit(input);
	return [...new Set(blockers)];
}

/** All ordinary visual/audio authored controls share the existing trust boundaries. */
export function clipControlBlockers(input: unknown): string[] {
	return [...clipAnimationBlockers(input), ...clipCompositingBlockers(input)];
}
