/* Motion channels (motion-design-generation): one animated value of one layer —
 * an edge, scale, rotation or opacity — as an initial value plus timed moves.
 * Every move starts from the value the channel holds at its start, so moves can
 * interrupt each other without a jump. Pure: `valueAt` reads only its inputs. */
import { springProgress } from "./motion-spring.ts";
import { MOTION_RULES, type MotionSpring } from "./motion-tokens.ts";

/** Progress 0..1 (a spring may pass 1) of a move `dt` seconds after it starts. */
export interface MotionCurve {
	durationSec: number;
	at(dt: number): number;
}

export const springCurve = (spring: MotionSpring): MotionCurve => ({
	durationSec: spring.settleSec,
	at: (dt) => springProgress(spring, dt),
});

const clampProgress = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : p);

/** Eased curves for opacity and colour: never overshoot. */
export const easedCurve = (durationSec: number, kind: "out" | "in" | "in-out"): MotionCurve => ({
	durationSec,
	at: (dt) => {
		const p = clampProgress(durationSec > 0 ? dt / durationSec : 1);
		if (kind === "out") return 1 - (1 - p) * (1 - p);
		if (kind === "in") return p * p;
		return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
	},
});

interface Move {
	startSec: number;
	from: number;
	to: number;
	curve: MotionCurve;
}

export class MotionChannel {
	private readonly moves: Move[] = [];

	constructor(private readonly initial: number) {}

	valueAt(t: number): number {
		let move: Move | undefined;
		for (const m of this.moves) if (m.startSec <= t) move = m;
		if (!move) return this.initial;
		return move.from + (move.to - move.from) * move.curve.at(t - move.startSec);
	}

	/** Adds a move toward `to`. A move that would start before the previous one is
	 *  pushed one frame after it, so moves stay ordered. Returns its end time. */
	moveTo(startSec: number, to: number, curve: MotionCurve): number {
		const previous = this.moves[this.moves.length - 1];
		const start =
			previous && startSec <= previous.startSec
				? previous.startSec + 1 / MOTION_RULES.sampleHz
				: startSec;
		this.moves.push({ startSec: start, from: this.valueAt(start), to, curve });
		return start + curve.durationSec;
	}

	/** True when the channel has any move at all. */
	get animated(): boolean {
		return this.moves.length > 0;
	}
}

export type EdgeName = "left" | "right" | "top" | "bottom";
export const CHANNEL_NAMES = [
	"left",
	"right",
	"top",
	"bottom",
	"scale",
	"rotate",
	"opacity",
] as const;
export type ChannelName = (typeof CHANNEL_NAMES)[number];
export type LayerChannels = Record<ChannelName, MotionChannel>;

/** Absolute geometry of a layer at a time, in frame percent. */
export interface LayerGeometry {
	left: number;
	top: number;
	width: number;
	height: number;
	scale: number;
	rotate: number;
	opacity: number;
}

export function geometryAt(channels: LayerChannels, t: number, driftPct = 0): LayerGeometry {
	const left = channels.left.valueAt(t),
		top = channels.top.valueAt(t) + driftPct;
	return {
		left,
		top,
		width: Math.max(0, channels.right.valueAt(t) - left),
		height: Math.max(0, channels.bottom.valueAt(t) + driftPct - top),
		scale: Math.max(0, channels.scale.valueAt(t)),
		rotate: channels.rotate.valueAt(t),
		opacity: Math.min(1, Math.max(0, channels.opacity.valueAt(t))),
	};
}
