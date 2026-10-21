/* Positions and durations, as integer ticks in a declared domain.
 *
 * Two domains exist and they are not interchangeable. A **project** time is a
 * position on the timeline, counted in the project's timebase. A **source**
 * time is a position within a piece of media, counted in that media's own
 * native rate. 25 fps media on a 29.97 fps timeline has both, and adding one to
 * the other produces a plausible wrong number — so the type system rejects it
 * rather than the reviewer having to catch it.
 */
import type { Timebase } from "./timebase.ts";

/** A position or duration on the timeline, in project ticks. */
export interface ProjectTime {
	readonly ticks: number;
	readonly domain: "project";
}

/** A position or duration within a piece of media, in that media's ticks. */
export interface SourceTime {
	readonly ticks: number;
	readonly domain: "source";
}

/** Either domain, where a function genuinely does not care which. */
export type Time = ProjectTime | SourceTime;

/**
 * A conversion's result, together with what the conversion had to do to it.
 *
 * The rounding is returned rather than logged, because a consumer who supplied
 * float seconds has to be able to tell whether the position they got back is
 * the position they asked for. A conversion that silently rounds is how a
 * timeline drifts one frame at a time with nobody able to say when.
 */
export interface Rounded<T> {
	readonly value: T;
	/** True when no rounding was needed. */
	readonly exact: boolean;
	/** Which way the value moved. `"exact"` when it did not move. */
	readonly direction: "exact" | "up" | "down";
}

/**
 * The one rounding rule: half away from zero.
 *
 * Chosen and documented rather than inherited from whatever `Math.round` does
 * at a negative half — `Math.round(-0.5)` is `-0`, which rounds *towards* zero
 * and makes trimming symmetric around the origin behave differently on the two
 * sides of it. Half away from zero is symmetric, which is the property an
 * editor needs.
 */
export function roundHalfAwayFromZero(value: number): number {
	return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Wrap a rounded tick count, recording what the rounding had to do. */
function rounded<T>(
	exactValue: number,
	roundedValue: number,
	wrap: (ticks: number) => T,
): Rounded<T> {
	if (roundedValue === exactValue)
		return { value: wrap(roundedValue), exact: true, direction: "exact" };
	return {
		value: wrap(roundedValue),
		exact: false,
		direction: roundedValue > exactValue ? "up" : "down",
	};
}

/** A project position or duration. */
export function projectTime(ticks: number): ProjectTime {
	if (!Number.isInteger(ticks))
		throw new RangeError(`@maleo/vui: project ticks must be an integer, received ${ticks}`);
	return { ticks, domain: "project" };
}

/** A source position or duration. */
export function sourceTime(ticks: number): SourceTime {
	if (!Number.isInteger(ticks))
		throw new RangeError(`@maleo/vui: source ticks must be an integer, received ${ticks}`);
	return { ticks, domain: "source" };
}

/* Addition and subtraction are per domain rather than generic over `Time`, and
 * deliberately so: a single `add(a: Time, b: Time)` would accept a source
 * duration added to a project position, which is exactly the mistake the two
 * domains exist to prevent. */

/** Add two project times. */
export function addProject(a: ProjectTime, b: ProjectTime): ProjectTime {
	return { ticks: a.ticks + b.ticks, domain: "project" };
}

/** Subtract one project time from another. */
export function subtractProject(a: ProjectTime, b: ProjectTime): ProjectTime {
	return { ticks: a.ticks - b.ticks, domain: "project" };
}

/** Add two source times. */
export function addSource(a: SourceTime, b: SourceTime): SourceTime {
	return { ticks: a.ticks + b.ticks, domain: "source" };
}

/** Compare two times in the same domain: negative, zero, or positive. */
export function compareTime<T extends Time>(a: T, b: T): number {
	return a.ticks === b.ticks ? 0 : a.ticks < b.ticks ? -1 : 1;
}

/** Clamp a time into a range, in one domain. */
export function clampTime<T extends Time>(value: T, low: T, high: T): T {
	if (value.ticks < low.ticks) return low;
	if (value.ticks > high.ticks) return high;
	return value;
}

/* ---- Frames ------------------------------------------------------------- */

/** A whole frame count as an exact project time. Never rounds. */
export function framesToProject(frames: number, base: Timebase): ProjectTime {
	if (!Number.isInteger(frames))
		throw new RangeError(`@maleo/vui: frame numbers are integers, received ${frames}`);
	return projectTime(frames * base.ticksPerFrame);
}

/** A whole frame count as an exact source time, at that media's own timebase. */
export function framesToSource(frames: number, base: Timebase): SourceTime {
	if (!Number.isInteger(frames))
		throw new RangeError(`@maleo/vui: frame numbers are integers, received ${frames}`);
	return sourceTime(frames * base.ticksPerFrame);
}

/**
 * A time as a frame number, reporting whether the position was frame-aligned.
 *
 * A position between two frames is a real state — a sub-frame audio offset, a
 * motion sample — so this reports the rounding rather than pretending the
 * position was on a frame all along.
 */
export function timeToFrames(time: Time, base: Timebase): Rounded<number> {
	const exact = time.ticks / base.ticksPerFrame;
	const whole = roundHalfAwayFromZero(exact);
	return rounded(exact, whole, (value) => value);
}
