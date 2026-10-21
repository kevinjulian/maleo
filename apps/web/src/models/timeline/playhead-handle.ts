/* The playhead, as a value that can be read without re-rendering to read it.
 *
 * It was `useState` in the editor's root, written by the player's `frameupdate`
 * event — so a second of playback re-rendered the whole editor thirty times to
 * move one element by a few pixels, and every one of those renders repainted
 * every clip and every waveform. The same file already solves this exact
 * problem for the hover cursor (`timeline-tracks.tsx`), by writing styles
 * through a ref and keeping no state at all, with a comment saying the point is
 * to avoid a render per pointer move.
 *
 * A ref alone is not enough here, because two kinds of consumer read the
 * playhead and they want opposite things:
 *
 *  - handlers ("split at the playhead", "does this selection need a seek")
 *    want the CURRENT value at the moment they run, and re-rendering to learn
 *    it is what made the value expensive in the first place — `get()`.
 *  - surfaces that DISPLAY time (the timecode) have to re-render when it
 *    changes, or they show the wrong number — `subscribe()`, taken by the one
 *    component that displays it rather than by the tree above it.
 *
 * So this is a minimal external store, in the same shape as
 * `timeline-document-store.ts` and for the same reason. No React here: it is
 * the model, and `use-playhead.ts` is the glue. */

export interface PlayheadHandle {
	/** The current position in seconds. */
	get: () => number;
	/** Move it, notifying subscribers. A write of the same value notifies nobody. */
	set: (sec: number) => void;
	/** Called on every change. Returns the unsubscribe. */
	subscribe: (listener: () => void) => () => void;
}

export function createPlayheadHandle(initial = 0): PlayheadHandle {
	let sec = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => sec,
		set: (next) => {
			// Equal-value writes are the common case during a paused edit, and a
			// notification for one would re-render the timecode for nothing.
			if (next === sec) return;
			sec = next;
			for (const listener of listeners) listener();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
