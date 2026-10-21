/* The store: state, dispatch, and subscription by slice.
 *
 * Subscription is per slice rather than per store, because "the timeline
 * changed" is not a useful thing to be told. Selection is the most frequent
 * action in an editor and the cheapest one to get wrong: as a prop it repaints
 * every clip and the preview; as a slice subscription it costs the two clips
 * whose selected state changed.
 *
 * No React here, and none reachable from here. A slice exposes exactly the pair
 * `useSyncExternalStore` wants — `subscribe(listener)` and a `get()` that
 * returns a cached, referentially stable value — so the React binding is a
 * one-line adapter and the kernel stays usable from anything else.
 */
import type { Effect, Reduction } from "./effects.ts";
import type { TimelineEvent } from "./events.ts";
import { DEFAULT_REDUCER_OPTIONS, reduce, reduceAll, type ReducerOptions } from "./reducer.ts";
import type { TimelineState } from "./types.ts";

/** Compare two selected values. Defaults to `Object.is`. */
export type Equals<S> = (a: S, b: S) => boolean;

/** Read one part of the state, and be told only when that part changes. */
export interface StoreSlice<S> {
	/** The current value. Referentially stable until the slice actually changes. */
	get(): S;
	/** Subscribe. Returns the unsubscribe. */
	subscribe(listener: () => void): () => void;
}

/** Where performed effects go. The kernel describes; the host performs. */
export type EffectSink = (effects: readonly Effect[]) => void;

/** The kernel's store. */
export interface TimelineStore {
	getState(): TimelineState;
	/** Apply one event, then hand any effects to the sink. */
	dispatch(event: TimelineEvent): void;
	/**
	 * Apply several events as one step.
	 *
	 * Batched so that two inputs arriving in one frame are both reflected, and
	 * subscribers are notified once rather than once per event.
	 */
	dispatchAll(events: readonly TimelineEvent[]): void;
	/** A slice, memoised per selector-and-equality pair by the caller. */
	slice<S>(select: (state: TimelineState) => S, equals?: Equals<S>): StoreSlice<S>;
	/** Where effects go. Replacing it replaces the interpreter. */
	setEffectSink(sink: EffectSink | undefined): void;
}

/**
 * Shallow equality over own enumerable keys.
 *
 * Provided because the alternative is every consumer writing it, and half of
 * them writing it wrong. Deliberately shallow: a deep comparison over a
 * timeline's item map costs more than the render it is trying to avoid.
 */
export function shallowEqual<S>(a: S, b: S): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	/* `Object.entries` on the narrowed value, rather than asserting `S` into a
	 * dictionary: `S` is whatever the consumer's selector returned, and claiming
	 * to know its keys is exactly the thing this function must not do.
	 *
	 * The right-hand side is indexed through a `Map` because key ORDER is not
	 * part of equality — two objects with the same keys inserted in different
	 * orders are equal, and a pairwise walk of two key arrays would call them
	 * different. */
	const right = new Map(Object.entries(b));
	const left = Object.entries(a);
	if (left.length !== right.size) return false;
	for (const [key, value] of left) {
		if (!right.has(key) || !Object.is(value, right.get(key))) return false;
	}
	return true;
}

/** Equality for a set of identities, for the selection slice. */
export function setEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
	if (a === b) return true;
	if (a.size !== b.size) return false;
	for (const value of a) if (!b.has(value)) return false;
	return true;
}

interface SliceRecord {
	/** Recompute and, if the value changed, notify. Returns whether it notified. */
	readonly refresh: () => void;
}

/** Create a store over an initial state. */
export function createStore(
	initial: TimelineState,
	options: ReducerOptions = DEFAULT_REDUCER_OPTIONS,
): TimelineStore {
	let state = initial;
	let sink: EffectSink | undefined;
	const slices = new Set<SliceRecord>();

	function apply(reduction: Reduction<TimelineState>): void {
		const changed = reduction.state !== state;
		state = reduction.state;
		/* Slices are refreshed before effects are performed, so an interpreter
		 * that reads the store during an effect sees the state the effect belongs
		 * to rather than the one before it. */
		/* Iterated over a copy: refreshing a slice notifies its listeners, and a
		 * listener is free to subscribe or unsubscribe in response. Mutating the
		 * live set mid-iteration is how a component that unmounts on a state
		 * change skips the next slice in the set. */
		if (changed) for (const record of [...slices]) record.refresh();
		if (reduction.effects.length > 0) sink?.(reduction.effects);
	}

	return {
		getState: () => state,
		dispatch(event) {
			apply(reduce(state, event, options));
		},
		dispatchAll(events) {
			apply(reduceAll(state, events, options));
		},
		slice<S>(select: (value: TimelineState) => S, equals: Equals<S> = Object.is): StoreSlice<S> {
			let current = select(state);
			const listeners = new Set<() => void>();
			const record: SliceRecord = {
				refresh() {
					const next = select(state);
					/* An equal value is not a change. This is the second half of the
					 * no-republish rule: the reducer does not produce an equal derived
					 * value, and a slice does not report one either. */
					if (equals(current, next)) return;
					current = next;
					/* A copy, for the same reason as above: a listener may unsubscribe
					 * itself while being called. */
					for (const listener of [...listeners]) listener();
				},
			};
			slices.add(record);
			return {
				get: () => current,
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
						/* The last unsubscribe releases the slice, so a mounted-and-
						 * unmounted component leaves nothing behind to recompute. */
						if (listeners.size === 0) slices.delete(record);
					};
				},
			};
		},
		setEffectSink(next) {
			sink = next;
		},
	};
}
