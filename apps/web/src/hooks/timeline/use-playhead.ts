/* React glue for the playhead handle (see `playhead-handle.ts` for why it is a
 * store rather than state).
 *
 * Three ways to read it, and which one a call site picks is the whole point:
 *
 *  - nothing at all — take the handle and call `get()` in a handler. This is
 *    most consumers, and it is what stops the tree re-rendering at frame rate.
 *  - `usePlayheadSec` — subscribe, and re-render when it moves. For a surface
 *    that DISPLAYS the time. Taken by that surface, never by a parent: a
 *    subscription in the editor's root is the state this change removed.
 *  - `usePlayheadEffect` — run a side effect on every move without rendering.
 *    For imperative work: writing the playhead's own style, scrolling it into
 *    view, following it with the preview scene.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";

/** Subscribe to the playhead. Re-renders the caller whenever it moves. */
export function usePlayheadSec(playhead: PlayheadHandle): number {
	return useSyncExternalStore(playhead.subscribe, playhead.get, playhead.get);
}

/** Run `effect` on every move, and once on mount, without re-rendering.
 *
 *  `effect` is held in a ref rather than being a dependency: it is written as a
 *  closure at the call site, so a dependency would resubscribe every render —
 *  which is the churn this hook exists to avoid. */
export function usePlayheadEffect(playhead: PlayheadHandle, effect: (sec: number) => void): void {
	const latest = useRef(effect);
	latest.current = effect;
	useEffect(() => {
		const run = (): void => latest.current(playhead.get());
		run();
		return playhead.subscribe(run);
	}, [playhead]);
}

/** Subscribe to something DERIVED from the playhead, and re-render only when
 *  that changes.
 *
 *  `usePlayheadSec` is the wrong instrument for most of what reads the time. The
 *  preview does not care what second it is; it cares which scene is painted and
 *  which clips are live, and those change a few times a minute while the time
 *  changes thirty times a second. Subscribing to the second and deriving the
 *  answer means re-deriving the same answer thirty times a second — which is
 *  where playback was still spending its frames after the timeline stopped
 *  re-rendering.
 *
 *  `select` must be stable (wrap it in `useCallback`), or the subscription is
 *  rebuilt on every render. The snapshot is cached because
 *  `useSyncExternalStore` compares by identity: a selector returning a fresh
 *  object every read reports a change every read, and the store notifies
 *  forever — the failure `timeline-document-store.ts` records at its `:96`. */
export function usePlayheadSelector<T>(
	playhead: PlayheadHandle,
	select: (sec: number) => T,
	isEqual: (a: T, b: T) => boolean = Object.is,
): T {
	const cache = useRef<{ sec: number; value: T } | null>(null);
	const getSnapshot = useCallback((): T => {
		const sec = playhead.get();
		const cached = cache.current;
		if (cached && cached.sec === sec) return cached.value;
		const next = select(sec);
		// Same answer, older identity: hand back the one already rendered, so the
		// subscription reports no change at all.
		const value = cached && isEqual(cached.value, next) ? cached.value : next;
		cache.current = { sec, value };
		return value;
	}, [playhead, select, isEqual]);
	return useSyncExternalStore(playhead.subscribe, getSnapshot, getSnapshot);
}
