import type { KeyframeEasing } from "./animation-properties.ts";
import type { ColorKeyframe, ValueKeyframe } from "./timeline-model.ts";

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

// cubic-bezier(0.16, 1, 0.3, 1) — the ease-out-expo curve used across the UI.
const BEZIER_P1X = 0.16;
const BEZIER_P1Y = 1;
const BEZIER_P2X = 0.3;
const BEZIER_P2Y = 1;

function cubicBezierAxis(t: number, a1: number, a2: number): number {
	const u = 1 - t;
	// control points p0=0, p3=1
	return 3 * u * u * t * a1 + 3 * u * t * t * a2 + t * t * t;
}

// Solve x(t)=target for t via bisection (curve is monotonic in x for these ctrls).
function bezierEase(p: number): number {
	if (p <= 0) return 0;
	if (p >= 1) return 1;
	let lo = 0;
	let hi = 1;
	let t = p;
	for (let i = 0; i < 24; i += 1) {
		const x = cubicBezierAxis(t, BEZIER_P1X, BEZIER_P2X);
		if (Math.abs(x - p) < 1e-5) break;
		if (x < p) lo = t;
		else hi = t;
		t = (lo + hi) / 2;
	}
	return cubicBezierAxis(t, BEZIER_P1Y, BEZIER_P2Y);
}

const EASING: Record<KeyframeEasing, (p: number) => number> = {
	linear: (p) => p,
	in: (p) => p * p,
	out: (p) => 1 - (1 - p) * (1 - p),
	"in-out": (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
	bezier: bezierEase,
	// A step: the previous value holds until the segment ends.
	hold: (p) => (p >= 1 ? 1 : 0),
};

export function applyKeyframeEasing(id: KeyframeEasing | undefined, p: number): number {
	return (EASING[id ?? "linear"] ?? EASING.linear)(clamp01(p));
}

type TimedKey = { t: number; easing?: KeyframeEasing; easingRange?: [number, number] };

/** Eased progress (0..1) of `time` through the segment entering `b`, honouring a
 *  retained `easingRange` so a cut segment keeps its original subcurve. */
function segmentProgress(a: TimedKey, b: TimedKey, time: number): number {
	if (b.easing === "hold") return time < b.t ? 0 : 1;
	const progress = b.t > a.t ? (time - a.t) / (b.t - a.t) : 1;
	const [from, to] = b.easingRange ?? [0, 1];
	const low = applyKeyframeEasing(b.easing, from),
		high = applyKeyframeEasing(b.easing, to);
	return high > low
		? (applyKeyframeEasing(b.easing, from + (to - from) * progress) - low) / (high - low)
		: progress;
}

/** Samples sorted scalar keys; time may be normalized or clip-local seconds. */
export function evaluateValueTrack(
	keys: readonly ValueKeyframe[] | undefined,
	time: number,
	fallback: number,
): number {
	if (!keys?.length) return fallback;
	if (time <= keys[0]!.t) return keys[0]!.v;
	const last = keys[keys.length - 1]!;
	if (time >= last.t) return last.v;
	for (let i = 1; i < keys.length; i++) {
		const a = keys[i - 1]!,
			b = keys[i]!;
		if (time <= b.t) {
			if (b.easing === "hold") return time < b.t ? a.v : b.v;
			return a.v + (b.v - a.v) * segmentProgress(a, b, time);
		}
	}
	return last.v;
}

const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;

function parseColor(input: string): { r: number; g: number; b: number } | null {
	const raw = input.trim();
	const short = raw.match(/^#([0-9a-f]{3})$/i);
	if (short) {
		const [r, g, b] = short[1]!.split("").map((x) => Number.parseInt(`${x}${x}`, 16));
		return { r: r!, g: g!, b: b! };
	}
	const rgb = raw.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
	if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
	const full = raw.match(/^#([0-9a-f]{6})$/i);
	if (!full) return null;
	const hex = full[1]!;
	return {
		r: Number.parseInt(hex.slice(0, 2), 16),
		g: Number.parseInt(hex.slice(2, 4), 16),
		b: Number.parseInt(hex.slice(4, 6), 16),
	};
}

/** Hex or rgb() endpoints mix to concrete rgb (trim boundaries sample to rgb()); other CSS colours fall back to color-mix. */
function colorMix(a: string, b: string, p: number): string {
	const ca = parseColor(a);
	const cb = parseColor(b);
	if (!ca || !cb) return p < 1 ? `color-mix(in srgb, ${b} ${Math.round(p * 100)}%, ${a})` : b;
	return `rgb(${Math.round(lerp(ca.r, cb.r, p))}, ${Math.round(lerp(ca.g, cb.g, p))}, ${Math.round(lerp(ca.b, cb.b, p))})`;
}

/** Samples sorted colour keys with the same bracketing and easing as value tracks. */
export function evaluateColorTrack(
	keys: readonly ColorKeyframe[] | undefined,
	time: number,
	fallback: string,
): string {
	if (!keys?.length) return fallback;
	if (keys.length === 1 || time <= keys[0]!.t) return keys[0]!.v;
	const last = keys[keys.length - 1]!;
	if (time >= last.t) return last.v;
	for (let i = 1; i < keys.length; i++) {
		const a = keys[i - 1]!,
			b = keys[i]!;
		if (time <= b.t)
			return b.easing === "hold"
				? time < b.t
					? a.v
					: b.v
				: colorMix(a.v, b.v, segmentProgress(a, b, time));
	}
	return last.v;
}
