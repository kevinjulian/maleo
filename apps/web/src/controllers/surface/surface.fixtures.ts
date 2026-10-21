/* Shared doubles for the surface suites: a hand-driven frame clock, structural
 * DOM targets, and a recording interpreter. Nothing here needs a browser. */
import { createStore } from "@models/timeline-view/store.ts";
import { type Effect } from "@models/timeline-view/effects.ts";
import { type FocusTarget, type TimelineState } from "@models/timeline-view/types.ts";
import { type TimelineEvent } from "@models/timeline-view/events.ts";
/* Straight from the fixture module, not the entry point: the fixtures are
 * test-facing and exporting them would put three fake timelines in the public
 * API. `tests/public-api` fails if that ever changes. */
import { magneticSingleRow } from "@models/timeline-view/fixtures.ts";
import type { FrameClock } from "@services/frame-clock/clock.ts";
import { type EffectInterpreter, type InterpreterHost } from "./interpreter.ts";
import { createScrollWriter } from "./scroll-writer.ts";
import { createTimelineSurface, type SurfaceEventTarget, type SurfaceRoot } from "./surface.ts";

/* ---- Doubles -------------------------------------------------------------- */

/** A clock nothing advances but the test. */
export function manualClock(): FrameClock & {
	advance(ms: number): void;
	pending(): number;
	requests(): number;
} {
	let nowMs = 0;
	let nextHandle = 1;
	let requests = 0;
	const frames = new Map<number, (timeMs: number) => void>();
	return {
		now: () => nowMs,
		request(callback) {
			requests += 1;
			const handle = nextHandle++;
			frames.set(handle, callback);
			return handle;
		},
		cancel(handle) {
			frames.delete(handle);
		},
		advance(ms) {
			nowMs += ms;
			/* One generation per advance: a callback that requests the next frame
			 * must not be run again within the same advance, or a single call would
			 * spin forever. */
			const due = [...frames.entries()];
			frames.clear();
			for (const [, callback] of due) callback(nowMs);
		},
		pending: () => frames.size,
		requests: () => requests,
	};
}

/** A capture target that remembers, so a leak is a number rather than a feeling. */
export function captureTarget(): SurfaceRoot & {
	captured(): number[];
	releases(): number[];
	listeners(): number;
} {
	const captured: number[] = [];
	const releases: number[] = [];
	const listeners = new Map<string, Set<(event: never) => void>>();
	return {
		setPointerCapture(pointerId) {
			captured.push(pointerId);
		},
		releasePointerCapture(pointerId) {
			releases.push(pointerId);
		},
		addEventListener(type, listener) {
			const set = listeners.get(type) ?? new Set();
			set.add(listener);
			listeners.set(type, set);
		},
		removeEventListener(type, listener) {
			listeners.get(type)?.delete(listener);
		},
		getBoundingClientRect: () => ({ left: 0, top: 0 }),
		captured: () => [...captured],
		releases: () => [...releases],
		listeners: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
	};
}

/** Dispatch into a fake target, the way a browser would. */
export function fire(
	target: SurfaceEventTarget & { listenersOf(type: string): Array<(event: unknown) => void> },
	type: string,
	event: unknown,
): void {
	for (const listener of target.listenersOf(type)) listener(event);
}

/** A fake root that can be fired at. */
export function fakeRoot(): ReturnType<typeof captureTarget> & {
	listenersOf(type: string): Array<(event: unknown) => void>;
} {
	const listeners = new Map<string, Set<(event: unknown) => void>>();
	const captured: number[] = [];
	const releases: number[] = [];
	return {
		setPointerCapture(pointerId: number) {
			captured.push(pointerId);
		},
		releasePointerCapture(pointerId: number) {
			releases.push(pointerId);
		},
		addEventListener(type: string, listener: (event: never) => void) {
			const set = listeners.get(type) ?? new Set();
			// SAFETY: a test double; fire() passes each listener the event shape it subscribed for.
			set.add(listener as (event: unknown) => void);
			listeners.set(type, set);
		},
		removeEventListener(type: string, listener: (event: never) => void) {
			// SAFETY: the same listener reference stored by addEventListener above.
			listeners.get(type)?.delete(listener as (event: unknown) => void);
		},
		getBoundingClientRect: () => ({ left: 0, top: 0 }),
		captured: () => [...captured],
		releases: () => [...releases],
		listeners: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
		listenersOf: (type: string) => [...(listeners.get(type) ?? [])],
	};
}

/** A scroller that can be fired at, and remembers what was written to it. */
export function fakeScroller(): SurfaceEventTarget & {
	scrollLeft: number;
	listenersOf(type: string): Array<(event: unknown) => void>;
	listeners(): number;
} {
	const listeners = new Map<string, Set<(event: unknown) => void>>();
	return {
		scrollLeft: 0,
		addEventListener(type: string, listener: (event: never) => void) {
			const set = listeners.get(type) ?? new Set();
			// SAFETY: a test double; fire() passes each listener the event shape it subscribed for.
			set.add(listener as (event: unknown) => void);
			listeners.set(type, set);
		},
		removeEventListener(type: string, listener: (event: never) => void) {
			// SAFETY: the same listener reference stored by addEventListener above.
			listeners.get(type)?.delete(listener as (event: unknown) => void);
		},
		listenersOf: (type: string) => [...(listeners.get(type) ?? [])],
		listeners: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
	};
}

/**
 * An interpreter that performs nothing and records everything.
 *
 * The proof that no component performs a side effect directly: run the whole
 * surface with this in place of the real one and nothing reaches the host, so
 * anything that DID happen came from somewhere it should not have.
 */
export function recordingInterpreter(): EffectInterpreter & { effects(): Effect[] } {
	const seen: Effect[] = [];
	return {
		perform(effects) {
			seen.push(...effects);
		},
		dispose() {},
		capturedPointers: () => [],
		hasPendingFrame: () => false,
		effects: () => [...seen],
	};
}

export function hostFixture(clock: FrameClock, dispatched: TimelineEvent[]) {
	const surface = captureTarget();
	const scroller = { scrollLeft: 0 };
	// SAFETY: widens the literal null so the host can write announcement text.
	const liveRegion = { textContent: null as string | null };
	const painted: Array<{ xPx: number; widthPx: number }> = [];
	const focused: FocusTarget[] = [];
	const host: InterpreterHost = {
		surface,
		scroll: createScrollWriter(scroller),
		liveRegion,
		paint: { invalidate: (region) => painted.push({ xPx: region.xPx, widthPx: region.widthPx }) },
		clock,
		focus: (target) => focused.push(target),
		dispatch: (event) => dispatched.push(event),
	};
	return { host, surface, scroller, liveRegion, painted, focused };
}

/* ---- 6.1 The interpreter -------------------------------------------------- */

export interface SurfaceFixture {
	readonly root: ReturnType<typeof fakeRoot>;
	readonly scroller: ReturnType<typeof fakeScroller>;
	readonly clock: ReturnType<typeof manualClock>;
	readonly store: ReturnType<typeof createStore>;
	readonly surface: ReturnType<typeof createTimelineSurface>;
	state(): TimelineState;
}

export function surfaceFixture(): SurfaceFixture {
	const root = fakeRoot();
	const scroller = fakeScroller();
	const clock = manualClock();
	const store = createStore(magneticSingleRow());
	const surface = createTimelineSurface({
		root,
		store,
		scroller,
		clock,
		/* Anything on the left half of the fixture viewport is `scene-1`; the rest
		 * is bare surface. Enough to prove identity travels as payload. */
		hitTest: (point) => (point.xPx < 400 ? { kind: "item", id: "scene-1" } : { kind: "surface" }),
	});
	return { root, scroller, clock, store, surface, state: () => store.getState() };
}

export function press(fixture: SurfaceFixture, xPx: number, atMs = 0, pointerId = 1): void {
	fire(fixture.root, "pointerdown", { pointerId, clientX: xPx, clientY: 10, timeStamp: atMs });
}
export function move(fixture: SurfaceFixture, xPx: number, atMs: number, pointerId = 1): void {
	fire(fixture.root, "pointermove", { pointerId, clientX: xPx, clientY: 10, timeStamp: atMs });
}
