/* When a press has become a drag — decided by policy, not by a constant.
 *
 * The previous contract could express only "threshold OR hold". The one
 * consumer that needed "threshold AND hold" therefore ran a second dead zone of
 * its own in front of the library's, and two gates decided one question — a
 * state in which neither can be reasoned about alone.
 *
 * So engagement is a predicate over the observed samples, supplied by the
 * consumer, with useful defaults here. The library applies the consumer's rule;
 * it does not apply its own in front of it.
 *
 * One rule is not negotiable: **pixel distance is never inferred from a time
 * delta.** A sample carrying no pixel evidence contributes zero distance. The
 * alternative makes engagement vary with the current zoom, so the same finger
 * movement engages at one magnification and not at another.
 */

/** One observation of a pointer, as the host saw it. */
export interface GestureSample {
	/** Milliseconds since the gesture began. Monotonic. */
	readonly elapsedMs: number;
	/** Pixels moved from the press point, or `undefined` when the host has no pixel evidence. */
	readonly distancePx?: number;
	/** Whether the pointer is coarse, so a policy can ask for more of it. */
	readonly coarse?: boolean;
}

/** Everything a recognizer sees. */
export interface GestureObservation {
	readonly samples: readonly GestureSample[];
	/** The largest distance seen so far, in pixels. Zero when no sample carried any. */
	readonly maxDistancePx: number;
	/** Milliseconds since the press. */
	readonly elapsedMs: number;
	readonly coarse: boolean;
}

/** Whether the gesture has engaged. Pure, and called on every sample. */
export type GestureRecognizer = (observation: GestureObservation) => boolean;

/**
 * Fold samples into an observation.
 *
 * A sample with no `distancePx` contributes **zero**, not an estimate. That is
 * the rule about not inferring pixels from time, implemented in the one place
 * every recognizer reads from, so no recognizer can get it wrong individually.
 */
export function observe(samples: readonly GestureSample[]): GestureObservation {
	let maxDistancePx = 0;
	let elapsedMs = 0;
	let coarse = false;
	for (const sample of samples) {
		if (sample.distancePx !== undefined && sample.distancePx > maxDistancePx)
			maxDistancePx = sample.distancePx;
		if (sample.elapsedMs > elapsedMs) elapsedMs = sample.elapsedMs;
		if (sample.coarse === true) coarse = true;
	}
	return { samples, maxDistancePx, elapsedMs, coarse };
}

/** How far and how long a threshold recognizer asks for. */
export interface EngagementThresholds {
	readonly distancePx: number;
	readonly holdMs: number;
}

/** A fine-pointer default: a few pixels, no hold. A mouse means it. */
export const DEFAULT_FINE_THRESHOLDS: EngagementThresholds = { distancePx: 4, holdMs: 0 };

/** A coarse-pointer default: further, and held. */
export const DEFAULT_COARSE_THRESHOLDS: EngagementThresholds = { distancePx: 10, holdMs: 180 };

/** Engage when the pointer has moved far enough, whatever the elapsed time. */
export function distanceRecognizer(thresholds: EngagementThresholds): GestureRecognizer {
	return (observation) => observation.maxDistancePx >= thresholds.distancePx;
}

/** Engage when either far enough or held long enough. The previous contract's only shape. */
export function distanceOrHoldRecognizer(thresholds: EngagementThresholds): GestureRecognizer {
	return (observation) =>
		observation.maxDistancePx >= thresholds.distancePx ||
		observation.elapsedMs >= thresholds.holdMs;
}

/**
 * Engage only when the pointer has moved far enough AND been down long enough.
 *
 * The one a touch timeline wants. A press that crosses the distance before the
 * hold has elapsed is a flick, and a flick on a timeline means throw the view —
 * not move this clip by a frame.
 */
export function distanceAndHoldRecognizer(thresholds: EngagementThresholds): GestureRecognizer {
	return (observation) =>
		observation.maxDistancePx >= thresholds.distancePx &&
		observation.elapsedMs >= thresholds.holdMs;
}

/**
 * The default: distance-and-hold on a coarse pointer, distance alone otherwise.
 *
 * Coarse pointers get the stricter rule because that is where the flick problem
 * lives; a mouse that moves four pixels while held down meant to.
 */
export function defaultRecognizer(
	fine: EngagementThresholds = DEFAULT_FINE_THRESHOLDS,
	coarse: EngagementThresholds = DEFAULT_COARSE_THRESHOLDS,
): GestureRecognizer {
	const fineRule = distanceRecognizer(fine);
	const coarseRule = distanceAndHoldRecognizer(coarse);
	return (observation) => (observation.coarse ? coarseRule(observation) : fineRule(observation));
}

/* ---- Snapping ------------------------------------------------------------ */

/** Somewhere an edit may prefer to land. */
export interface SnapCandidate {
	/** Position in project ticks. */
	readonly ticks: number;
	/** What it is — a neighbour's edge, the playhead, a marker. The consumer's word. */
	readonly kind: string;
	/** The item it belongs to, when it belongs to one. */
	readonly itemId?: string;
}
