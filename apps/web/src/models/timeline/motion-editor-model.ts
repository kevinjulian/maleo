/* Immutable state operations for the keyframe motion editor. Every op returns a
 * new CustomMotion; nothing mutates in place. Endpoints are pinned at t=0 and
 * t=1; interior keyframes stay strictly between their neighbours. */
import { resolveMotionKeyframes, type KeyframeMotion } from "@maleo/video/composition";
import type { CustomMotion, MotionEasing, MotionKeyframe } from "@maleo/shared";

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);
const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;

/** Sort keyframes by ascending t (stable copy). */
export function sortKeyframes(kfs: ReadonlyArray<MotionKeyframe>): MotionKeyframe[] {
	return [...kfs].sort((a, b) => a.t - b.t);
}

/** Seed a custom motion from the currently selected movement preset, so opening
 * the editor starts from what the clip already looks like. */
export function seedMotion(move: string): CustomMotion {
	const resolved: KeyframeMotion = resolveMotionKeyframes(move);
	return { keyframes: resolved.keyframes.map((k) => ({ ...k })) };
}

/** Sample the motion at t (0..1) by linear interpolation between the bracketing
 * keyframes — used to seed a newly inserted keyframe's values. */
function sampleAt(
	kfs: ReadonlyArray<MotionKeyframe>,
	t: number,
): Omit<MotionKeyframe, "t" | "easing"> {
	const sorted = sortKeyframes(kfs);
	if (t <= sorted[0].t)
		return {
			scale: sorted[0].scale,
			x: sorted[0].x,
			y: sorted[0].y,
			rotate: sorted[0].rotate ?? 0,
		};
	const last = sorted[sorted.length - 1];
	if (t >= last.t) return { scale: last.scale, x: last.x, y: last.y, rotate: last.rotate ?? 0 };
	for (let i = 0; i < sorted.length - 1; i += 1) {
		const a = sorted[i];
		const b = sorted[i + 1];
		if (t >= a.t && t <= b.t) {
			const span = b.t - a.t;
			const p = span > 0 ? (t - a.t) / span : 0;
			return {
				scale: lerp(a.scale, b.scale, p),
				x: lerp(a.x, b.x, p),
				y: lerp(a.y, b.y, p),
				rotate: lerp(a.rotate ?? 0, b.rotate ?? 0, p),
			};
		}
	}
	return { scale: last.scale, x: last.x, y: last.y, rotate: last.rotate ?? 0 };
}

/** Insert a keyframe at t (clamped inside the timeline). Returns the new motion
 * and the index of the inserted keyframe. */
/** A keyframe edit: the motion after the change, and which keyframe to select.
 *  Both editors return it, so the shape is named rather than spelled twice. */
export interface KeyframeEdit {
	motion: CustomMotion;
	index: number;
}

export function addKeyframe(motion: CustomMotion, t: number): KeyframeEdit {
	const ct = clamp(t, 0.01, 0.99);
	const sampled = sampleAt(motion.keyframes, ct);
	const inserted: MotionKeyframe = { t: ct, ...sampled, easing: "linear" };
	const next = sortKeyframes([...motion.keyframes, inserted]);
	return { motion: { keyframes: next }, index: next.findIndex((k) => k === inserted) };
}

/** Remove the keyframe at index. No-op when it would leave fewer than 2. */
export function removeKeyframe(motion: CustomMotion, index: number): CustomMotion {
	if (motion.keyframes.length <= 2) return motion;
	if (index < 0 || index >= motion.keyframes.length) return motion;
	return { keyframes: motion.keyframes.filter((_, i) => i !== index) };
}

type KeyframePatch = Partial<Pick<MotionKeyframe, "scale" | "x" | "y" | "rotate" | "easing">>;

/** Patch a keyframe's transform/easing fields (never its t). */
export function updateKeyframe(
	motion: CustomMotion,
	index: number,
	patch: KeyframePatch,
): CustomMotion {
	if (index < 0 || index >= motion.keyframes.length) return motion;
	return {
		keyframes: motion.keyframes.map((k, i) => (i === index ? { ...k, ...patch } : k)),
	};
}

/** Move a keyframe along t. Endpoints (first/last) are pinned. Interior frames
 * are constrained strictly between their neighbours so ordering never breaks.
 * Returns the new motion and the keyframe's (possibly unchanged) index. */
export function moveKeyframe(motion: CustomMotion, index: number, t: number): KeyframeEdit {
	const kfs = motion.keyframes;
	if (index < 0 || index >= kfs.length) return { motion, index };
	if (index === 0 || index === kfs.length - 1) return { motion, index }; // endpoints pinned
	const lo = kfs[index - 1].t + 0.001;
	const hi = kfs[index + 1].t - 0.001;
	const ct = clamp(t, lo, hi);
	return {
		motion: { keyframes: kfs.map((k, i) => (i === index ? { ...k, t: ct } : k)) },
		index,
	};
}

export const MOTION_EASINGS: ReadonlyArray<MotionEasing> = [
	"linear",
	"in",
	"out",
	"in-out",
	"bezier",
];
