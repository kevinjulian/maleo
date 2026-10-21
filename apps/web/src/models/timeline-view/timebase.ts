/* A project's timebase: what one tick is worth.
 *
 * A timeline declares exactly one of these. Every position and duration on it
 * is an integer count of its ticks, so ordinary arithmetic — add two
 * durations, nudge by a frame ten thousand times — is integer arithmetic and
 * accumulates no error at all.
 */
import { formatRational, rational, rationalMultiply, type Rational } from "./rational.ts";

/**
 * Ticks in one frame, when the caller does not say.
 *
 * Not 1. A timebase where a tick IS a frame is the integer-frame-number model,
 * and it cannot express an audio sample offset or a sub-frame motion sample —
 * the reason that model was rejected. A thousand subdivisions makes every
 * sub-frame position anyone has asked for representable while leaving a
 * 24-hour timeline at 30 fps around 2.6e9 ticks, four orders of magnitude
 * inside `Number.MAX_SAFE_INTEGER`.
 *
 * A project that wants a different subdivision passes one; nothing above the
 * timebase reads this constant.
 */
export const DEFAULT_TICKS_PER_FRAME = 1000;

/** The rate a timeline counts in, and the frame rate it presents. */
export interface Timebase {
	/** Exact ticks per second. */
	readonly ticksPerSecond: Rational;
	/** Exact frames per second, as declared. */
	readonly frameRate: Rational;
	/** Integer ticks in one frame. Always a whole number, which is what makes a frame exact. */
	readonly ticksPerFrame: number;
}

/**
 * Build a timebase from a frame rate.
 *
 * The tick rate is the frame rate times an integer subdivision, so one frame is
 * always a whole number of ticks at any rate — including 30000/1001, where a
 * tick rate chosen independently of the frame rate would not be.
 */
export function timebase(
	frameRate: Rational,
	ticksPerFrame: number = DEFAULT_TICKS_PER_FRAME,
): Timebase {
	if (!Number.isInteger(ticksPerFrame) || ticksPerFrame < 1) {
		throw new RangeError(
			`@maleo/vui: ticksPerFrame must be a positive integer, received ${ticksPerFrame}`,
		);
	}
	if (frameRate.numerator <= 0) {
		throw new RangeError(
			`@maleo/vui: a frame rate must be positive, received ${formatRational(frameRate)}`,
		);
	}
	return {
		ticksPerSecond: rationalMultiply(frameRate, rational(ticksPerFrame, 1)),
		frameRate,
		ticksPerFrame,
	};
}
