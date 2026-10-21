/* Render counting, off unless a harness turns it on.
 *
 * The render-budget work is about work that is invisible in the output: the
 * editor looks identical whether a click commits once or four times. A
 * screenshot cannot see it, the type checker cannot see it, and reading the
 * diff cannot prove it — so the change needs an instrument, and the spec's
 * acceptance ("no clip re-renders", "the lane container does not re-render")
 * is per component rather than per commit.
 *
 * React's own <Profiler> counts commits but does not say which component
 * re-rendered inside one, which is the question here. So components call
 * `countRender` with a stable label and a harness reads the tallies.
 *
 * Free when off — one property read on a global that nothing sets in a normal
 * session — so the calls stay in the tree rather than being added and removed
 * around each measurement, and a later change can notice a regression with the
 * same harness that recorded the baseline. */

/** Renders per label since counting started. */
export interface RenderCounts {
	[label: string]: number;
}

declare global {
	/* The tally the render-budget suite reads through `page.evaluate`. */
	var __maleoRenderCounts: RenderCounts | undefined;
}

const host = globalThis;

/** Record one render of `label`. A no-op until `startRenderCounting` runs. */
export function countRender(label: string): void {
	const counts = host.__maleoRenderCounts;
	if (!counts) return;
	counts[label] = (counts[label] ?? 0) + 1;
}

/** Turn counting on and clear any previous tally. */
export function startRenderCounting(): void {
	host.__maleoRenderCounts = {};
}

/** Clear the tally, leaving counting on. Called between measured interactions. */
export function resetRenderCounts(): void {
	if (host.__maleoRenderCounts) host.__maleoRenderCounts = {};
}

/** A snapshot of the tally. Empty when counting is off. */
export function readRenderCounts(): RenderCounts {
	return { ...host.__maleoRenderCounts };
}

/** Whether a harness has turned counting on. */
export function isRenderCounting(): boolean {
	return host.__maleoRenderCounts != null;
}
