/* Closed-form springs and curve-to-key reduction (motion-design-generation).
 *
 * A spring here is the step response of a damped oscillator, evaluated directly
 * at a time, never simulated frame by frame, so any frame can be computed alone.
 * The compiler samples curves densely and keeps only the keys linear
 * interpolation needs, so springs travel through the existing `linear` easing and
 * no runtime learns a new easing. */
import type { MotionSpring } from "./motion-tokens.ts";

export interface MotionSample {
	t: number;
	v: number;
}

/** Raw step response from 0 toward 1 at `t` seconds. */
function stepResponse(spring: MotionSpring, t: number): number {
	const zeta = Math.min(1, Math.max(0.05, spring.zeta));
	if (zeta >= 0.999) {
		// Critically damped: settles within 2 % at about 5.83 / omega.
		const omega = 5.834 / spring.settleSec;
		return 1 - Math.exp(-omega * t) * (1 + omega * t);
	}
	// Underdamped: the envelope e^(-zeta omega t) falls to 2 % at 4 / (zeta omega).
	const omega = 4 / (zeta * spring.settleSec);
	const root = Math.sqrt(1 - zeta * zeta);
	const damped = omega * root;
	return (
		1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + (zeta / root) * Math.sin(damped * t))
	);
}

/** Spring progress at `t`: 0 at the start, exactly 1 from `settleSec` on. The
 *  residual left at the settle time is removed by a linear correction over the
 *  move, so the curve lands on its target with no jump. */
export function springProgress(spring: MotionSpring, t: number): number {
	if (t <= 0) return 0;
	if (t >= spring.settleSec) return 1;
	const residual = 1 - stepResponse(spring, spring.settleSec);
	return stepResponse(spring, t) + residual * (t / spring.settleSec);
}

/** Samples `fn` from `start` to `end` at `hz`, both ends included exactly. */
export function sampleCurve(
	fn: (t: number) => number,
	start: number,
	end: number,
	hz: number,
): MotionSample[] {
	if (end <= start) return [{ t: start, v: fn(start) }];
	const steps = Math.max(1, Math.ceil((end - start) * hz));
	return Array.from({ length: steps + 1 }, (_, i) => {
		const t = i === steps ? end : start + i / hz;
		return { t, v: fn(t) };
	});
}

/** The fewest samples whose linear interpolation stays within `tolerance` of every
 *  input sample (Ramer-Douglas-Peucker on vertical error). Ends are always kept. */
export function reduceSamples(samples: readonly MotionSample[], tolerance: number): MotionSample[] {
	if (samples.length <= 2) return [...samples];
	const keep = new Set<number>([0, samples.length - 1]);
	const spans: Array<[number, number]> = [[0, samples.length - 1]];
	while (spans.length) {
		const [from, to] = spans.pop()!;
		const a = samples[from]!,
			b = samples[to]!;
		let worst = -1,
			worstError = tolerance;
		for (let i = from + 1; i < to; i++) {
			const s = samples[i]!;
			const line = a.v + ((b.v - a.v) * (s.t - a.t)) / (b.t - a.t);
			const error = Math.abs(s.v - line);
			if (error > worstError) {
				worst = i;
				worstError = error;
			}
		}
		if (worst >= 0) {
			keep.add(worst);
			spans.push([from, worst], [worst, to]);
		}
	}
	return [...keep].sort((x, y) => x - y).map((i) => samples[i]!);
}
