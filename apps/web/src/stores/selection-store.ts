/* What the editor has selected, as an external store.
 *
 * It was `useState` in the editor's root, which is the root of the whole tree —
 * so selecting a clip re-rendered every lane, every clip, every waveform and
 * the preview, to change the appearance of at most two clips. The selection is
 * the most frequent action in the editor and the cheapest one to get wrong.
 *
 * The shape still belongs to `selection-model.ts`; this only decides who hears
 * about a change. A clip subscribes to ONE question — "am I selected?" — so a
 * selection change re-renders the clips whose answer flipped and nothing else.
 *
 * Same construction as `timeline-document-store.ts`, including the rule its
 * comments record: a selector must not allocate. `useSyncExternalStore` compares
 * what the selector returns by identity, so a selector that builds an object
 * reports a change on every read and notifies forever. Every selector here
 * returns a boolean, a number or the stored object itself.
 */
import { useCallback, useSyncExternalStore } from "react";
import {
	EMPTY_SELECTION,
	isClipSelected as isClipSelectedIn,
	selectionsEqual,
	type Selection,
} from "@models/timeline/selection-model.ts";

export interface SelectionStore {
	get: () => Selection;
	/** Replace the selection. An equal selection is not a change and notifies
	 *  nobody — selecting what is already selected carries no information. */
	set: (next: Selection | ((prev: Selection) => Selection)) => void;
	subscribe: (listener: () => void) => () => void;
}

export function createSelectionStore(initial: Selection = EMPTY_SELECTION): SelectionStore {
	let selection = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => selection,
		set: (next) => {
			const resolved = typeof next === "function" ? next(selection) : next;
			if (selectionsEqual(selection, resolved)) return;
			selection = resolved;
			for (const listener of listeners) listener();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

/** The whole selection. For surfaces that describe it — the inspector, the
 *  editor's own bookkeeping. A lane or a clip must NOT take this. */
export function useSelectionValue(store: SelectionStore): Selection {
	return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** One clip's answer. This is the subscription that makes a selection change
 *  cost two renders instead of one per clip. */
export function useClipSelected(store: SelectionStore, clipId: string): boolean {
	const read = useCallback(() => isClipSelectedIn(store.get(), clipId), [store, clipId]);
	return useSyncExternalStore(store.subscribe, read, read);
}

/** Any other single fact about the selection. The selector must return a
 *  primitive or a stored reference, never a fresh object — see the note above. */
export function useSelectionFact<T>(store: SelectionStore, fact: (selection: Selection) => T): T {
	const read = useCallback(() => fact(store.get()), [store, fact]);
	return useSyncExternalStore(store.subscribe, read, read);
}
