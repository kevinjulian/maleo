/* Reduced motion, read from the media feature rather than guessed.
 *
 * The rule is not "animate less". It is that the surface reaches the same final
 * geometry with motion off — a reduced-motion timeline that lands somewhere else
 * has replaced an animation with a bug, and the person who asked for less motion
 * is the one who finds it.
 *
 * So this resolves durations to zero and leaves every position alone. Nothing
 * here decides where anything goes.
 */

/** Whatever answers a media query. `window.matchMedia` in a browser. */
export interface MediaQuerySource {
	matchMedia(query: string): { matches: boolean };
}

/** The exact feature. Named once, so no caller writes it slightly differently. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Whether this environment asks for reduced motion. False where it cannot be asked. */
export function prefersReducedMotion(source?: MediaQuerySource): boolean {
	const query =
		source ??
		(typeof globalThis.matchMedia === "function"
			? { matchMedia: (text: string) => globalThis.matchMedia(text) }
			: undefined);
	if (!query) return false;
	return query.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** How long the surface's transitions run. */
export interface MotionPolicy {
	readonly reduced: boolean;
	/** Milliseconds. Zero under reduced motion, for every one of them. */
	readonly durationMs: number;
	/** Edge auto-scroll speed. Unchanged: it is travel, not decoration. */
	readonly autoScrollPixelsPerSecond: number;
	/** Whether a scroll into view animates or jumps. */
	readonly smoothScroll: boolean;
}

export interface MotionOptions {
	readonly durationMs?: number;
	readonly autoScrollPixelsPerSecond?: number;
	readonly source?: MediaQuerySource;
}

export function resolveMotion(options: MotionOptions = {}): MotionPolicy {
	const reduced = prefersReducedMotion(options.source);
	return {
		reduced,
		durationMs: reduced ? 0 : (options.durationMs ?? 180),
		/* Deliberately not reduced. Auto-scroll is how a drag reaches content off
		 * screen; switching it off under reduced motion would remove a capability
		 * rather than an animation. */
		autoScrollPixelsPerSecond: options.autoScrollPixelsPerSecond ?? 600,
		smoothScroll: !reduced,
	};
}
