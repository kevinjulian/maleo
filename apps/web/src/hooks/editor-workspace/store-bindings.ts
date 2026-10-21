/* React, bound to the kernel through the one hook that exists for it.
 *
 * `useSyncExternalStore` per slice, and nothing else. The kernel's slices were
 * built to be exactly the pair it wants — a `subscribe` and a referentially
 * stable `get` — so these bindings are an adapter rather than a state library,
 * and the kernel stays usable from anything that is not React.
 *
 * Two rules hold here, and both are the whole reason the bindings are thin:
 *
 *   - **One subscription per slice.** Subscribing to "the timeline" and reading
 *     a field means every component re-renders on every change, which is the
 *     arrangement that made selection cost a repaint of every clip.
 *   - **No gesture or viewport state in a component ref.** A ref holding either
 *     is a second copy of something the kernel owns, and the two disagree the
 *     moment a render is skipped.
 */
import { useDebugValue, useMemo, useSyncExternalStore } from "react";
import type { Equals, TimelineStore } from "@models/timeline-view/store.ts";
import type { TimelineState } from "@models/timeline-view/types.ts";

/**
 * Subscribe to one slice of the timeline.
 *
 * The selector and the equality are memoised by the caller's dependency list,
 * because a new selector on every render creates a new slice on every render —
 * which subscribes, recomputes, and unsubscribes forever without ever being
 * wrong enough to notice.
 */
export function useTimelineSlice<S>(
	store: TimelineStore,
	select: (state: TimelineState) => S,
	equals?: Equals<S>,
): S {
	const slice = useMemo(() => store.slice(select, equals), [store, select, equals]);
	const value = useSyncExternalStore(slice.subscribe, slice.get, slice.get);
	useDebugValue(value);
	return value;
}
