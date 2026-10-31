/* Motion tokens (motion-design-generation): every number the motion compiler and
 * the motion lint apply, in one table, so both read the same source and a test
 * can pin the spec ranges. Values follow the published motion grammar: one hero
 * move, secondary moves delayed and shortened, quiet ambient motion, exits shorter
 * than entrances, containers before their text. */

export const MOTION_ROLES = ["hero", "secondary", "ambient"] as const;
export type MotionRole = (typeof MOTION_ROLES)[number];

export const MOTION_CLASSES = [
	"headline",
	"body",
	"label",
	"container",
	"accent",
	"indicator",
] as const;
export type MotionClass = (typeof MOTION_CLASSES)[number];

/** A damped spring: `zeta` 1 is critically damped (no overshoot); below 1 bounces.
 *  `settleSec` is the time to settle within 2 % of the target. */
export interface MotionSpring {
	zeta: number;
	settleSec: number;
}

export const MOTION_SPRINGS: Readonly<Record<MotionClass, MotionSpring>> = {
	headline: { zeta: 1, settleSec: 0.45 },
	body: { zeta: 1, settleSec: 0.4 },
	label: { zeta: 0.85, settleSec: 0.35 },
	container: { zeta: 0.9, settleSec: 0.6 },
	accent: { zeta: 0.6, settleSec: 0.5 },
	indicator: { zeta: 0.75, settleSec: 0.4 },
};

/** The trailing edge of an indicator: later and calmer than its leading edge. */
export const INDICATOR_TRAILING: MotionSpring & { delaySec: number } = {
	zeta: 0.9,
	settleSec: 0.45,
	delaySec: 0.06,
};

export const MOTION_RULES = {
	/** Each layer after the leader starts this long after the layer before it,
	 *  so a state with many movers cascades instead of landing on one frame. */
	cascadeGapSec: 0.15,
	/** A secondary entrance or exit offset, as a share of the hero's offset. */
	secondaryOffsetRatio: 0.6,
	/** The hero's entrance or exit offset, in percent of the frame. */
	heroOffsetPct: 8,
	/** Ambient drift amplitude, in percent of the frame, and its period. */
	ambientAmplitudePct: 3,
	ambientPeriodSec: 4,
	/** An exit lasts this share of the same layer's entrance. */
	exitFactor: 0.7,
	/** Text following a container starts once the container is this far through its move. */
	textAfterContainer: 0.5,
	/** Opacity and colour moves: fixed durations, eased, never sprung. */
	fadeInSec: 0.35,
	/** Reading speed for the hold a text layer needs, and the minimum hold. */
	readingWordsPerSec: 3,
	minReadingSec: 1,
	/** Sample rate and tolerance the compiler uses to turn curves into keys. */
	sampleHz: 60,
	keyTolerance: 0.005,
} as const;

/** The seconds a text layer must hold still to be read. */
export function readingTimeSec(text: string): number {
	const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
	return Math.max(MOTION_RULES.minReadingSec, words / MOTION_RULES.readingWordsPerSec);
}
