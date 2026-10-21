/* Keyframe motion engine. One evaluator drives both the editor preview and the
 * Remotion render, so a motion looks identical on scrub and on export. Pure and
 * remotion-free: takes a normalized progress (0..1), returns a transform sample.
 *
 * Legacy from/to presets (motion-presets.ts) convert to a 2-keyframe form via
 * fromLegacy / presetKeyframes, so existing renders stay byte-identical. */
import {
	applyKeyframeEasing as applyEasing,
	evaluateColorTrack,
	evaluateValueTrack,
	type KeyframeEasing,
} from "@maleo/shared";
import {
	MOTION_PRESETS,
	resolveMotion,
	type MotionParams,
	type MotionPresetId,
} from "./motion-presets";

export type EasingId = "linear" | "in" | "out" | "in-out" | "bezier";

/** A single control point. `t` is normalized position in the clip (0..1).
 * `easing` is the curve applied on the segment ENTERING this keyframe. */
export type MotionKeyframe = {
	t: number;
	scale: number;
	x: number;
	y: number;
	rotate?: number;
	easing?: EasingId;
};

/** Full custom motion: two or more keyframes, sorted by ascending `t`. */
export type KeyframeMotion = {
	keyframes: MotionKeyframe[];
};

/** Resolved transform at a point in time. */
export type MotionSample = {
	scale: number;
	x: number;
	y: number;
	rotate: number;
};

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;

function sampleKeyframe(k: MotionKeyframe): MotionSample {
	return { scale: k.scale, x: k.x, y: k.y, rotate: k.rotate ?? 0 };
}

/** Evaluate a keyframe motion at normalized progress (0..1 across the clip).
 * Progress is clamped; before the first / after the last keyframe holds the
 * endpoint value (matches the old extrapolate:"clamp" behaviour). */
export function evalMotion(motion: KeyframeMotion, progress: number): MotionSample {
	const kfs = motion.keyframes;
	if (kfs.length === 0) return { scale: 1, x: 0, y: 0, rotate: 0 };
	if (kfs.length === 1) return sampleKeyframe(kfs[0]);

	const p = clamp01(progress);
	if (p <= kfs[0].t) return sampleKeyframe(kfs[0]);
	const last = kfs[kfs.length - 1];
	if (p >= last.t) return sampleKeyframe(last);

	let a = kfs[0];
	let b = kfs[1];
	for (let i = 0; i < kfs.length - 1; i += 1) {
		if (p >= kfs[i].t && p <= kfs[i + 1].t) {
			a = kfs[i];
			b = kfs[i + 1];
			break;
		}
	}

	const span = b.t - a.t;
	const localRaw = span > 0 ? (p - a.t) / span : 1;
	const eased = applyEasing(b.easing, localRaw);
	return {
		scale: lerp(a.scale, b.scale, eased),
		x: lerp(a.x, b.x, eased),
		y: lerp(a.y, b.y, eased),
		rotate: lerp(a.rotate ?? 0, b.rotate ?? 0, eased),
	};
}

/** One keyframe of a single animated value (overlay property track). */
export type ValueKeyframe = { t: number; v: number; easing?: KeyframeEasing };
export type AnimatableOverlayProp =
	| "x"
	| "y"
	| "scale"
	| "rotate"
	| "opacity"
	| "width"
	| "height"
	| "blur"
	| "bgOpacity"
	| "fontSize"
	| "letterSpacing"
	| "lineHeight";
export type ColorKeyframe = { t: number; v: string; easing?: KeyframeEasing };
export type ColorOverlayProp = "fill" | "bodyFill" | "accent" | "background";

/** Overlay animation: per-property value tracks, t normalized 0..1 across the
 * clip. Absent property = static. Same easing vocabulary as camera motion. */
export type OverlayAnim = {
	tracks: Partial<Record<AnimatableOverlayProp, ValueKeyframe[]>>;
	colorTracks?: Partial<Record<ColorOverlayProp, ColorKeyframe[]>>;
};

/** Evaluate a single-value keyframe track at normalized progress. Endpoints
 * clamp; `fallback` returned for empty tracks. Same bracketing + easing rules
 * as evalMotion, so overlay animation matches camera motion exactly. */
export function evalTrack(
	kfs: ValueKeyframe[] | undefined,
	progress: number,
	fallback: number,
): number {
	return evaluateValueTrack(kfs, clamp01(progress), fallback);
}

/** Evaluate a color keyframe track at normalized progress (shared evaluator). */
export function evalColorTrack(
	kfs: ColorKeyframe[] | undefined,
	progress: number,
	fallback: string,
): string {
	return evaluateColorTrack(kfs, clamp01(progress), fallback);
}

/** Convert a legacy {from,to} preset into a 2-keyframe motion (linear, matching
 * the old interpolate). rotate defaults to 0. */
export function fromLegacy(params: MotionParams): KeyframeMotion {
	return {
		keyframes: [
			{
				t: 0,
				scale: params.from.scale,
				x: params.from.x,
				y: params.from.y,
				rotate: 0,
				easing: "linear",
			},
			{ t: 1, scale: params.to.scale, x: params.to.x, y: params.to.y, rotate: 0, easing: "linear" },
		],
	};
}

/** Built-in preset id -> keyframe motion. */
export function presetKeyframes(id: MotionPresetId): KeyframeMotion {
	return fromLegacy(MOTION_PRESETS[id]);
}

/** Resolve a UI movement label (or preset id) to a keyframe motion. */
export function resolveMotionKeyframes(movement?: string): KeyframeMotion {
	return fromLegacy(resolveMotion(movement));
}
