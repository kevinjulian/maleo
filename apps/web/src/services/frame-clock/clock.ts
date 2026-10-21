/* The frame clock, as an injected dependency rather than a global call.
 *
 * Edge auto-scroll advances the view per frame, and a test that has to wait for
 * real frames to prove "the pending frame was cancelled permanently" is a test
 * that can only prove it slowly and flakily. So the clock is supplied, and the
 * tests supply one they drive by hand.
 */

/** Somewhere to ask for the next frame, and what time it is. */
export interface FrameClock {
	/** Milliseconds, monotonic. */
	now(): number;
	/** Request one frame. Returns a handle for `cancel`. */
	request(callback: (timeMs: number) => void): number;
	cancel(handle: number): void;
}

/**
 * The browser's own clock.
 *
 * Falls back to a timer where `requestAnimationFrame` is absent — a worker, a
 * server render, a test runner with no document — so a surface constructed in
 * one of those still runs rather than throwing at construction.
 */
export function browserFrameClock(): FrameClock {
	const raf = globalThis.requestAnimationFrame;
	const caf = globalThis.cancelAnimationFrame;
	if (typeof raf === "function" && typeof caf === "function") {
		return {
			now: () =>
				typeof globalThis.performance?.now === "function"
					? globalThis.performance.now()
					: Date.now(),
			request: (callback) => raf.call(globalThis, callback),
			cancel: (handle) => {
				caf.call(globalThis, handle);
			},
		};
	}
	return {
		now: () => Date.now(),
		/* 16ms rather than 0: a zero-delay timer in a hidden tab runs as fast as
		 * the runtime will let it, which turns an idle auto-scroll into a busy
		 * loop. */
		request: (callback) => Number(setTimeout(() => callback(Date.now()), 16)),
		cancel: (handle) => {
			clearTimeout(handle);
		},
	};
}
