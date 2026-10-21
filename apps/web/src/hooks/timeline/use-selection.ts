/* React glue for the selection model.
 *
 * Several editing hooks were written against individual `setSelectedXId`
 * dispatchers, from when selection was nine separate `useState` calls. Rather
 * than rewrite each hook's interface, a slot setter folds one field back into the
 * single selection — so the model stays the only place that knows the shape,
 * without a cast at every call site.
 *
 * The value itself lives in an external store now (`selection-store.ts`), not in
 * this component's state: as state in the editor's root, every selection change
 * re-rendered the entire tree to change the look of at most two clips. This hook
 * returns the whole selection and therefore re-renders its caller, which is
 * right for the editor — it derives the inspector's subject from it. A lane or a
 * clip takes the STORE and subscribes to its own question instead. */
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { EMPTY_SELECTION, type Selection } from "@models/timeline/selection-model.ts";
import {
	createSelectionStore,
	useSelectionValue,
	type SelectionStore,
} from "@stores/selection-store.ts";
import { resolveSetState } from "@models/core/set-state.ts";

export interface SelectionState {
	selection: Selection;
	setSelection: Dispatch<SetStateAction<Selection>>;
	/** A `useState`-shaped setter for one field of the selection. */
	slot: <K extends keyof Selection>(key: K) => Dispatch<SetStateAction<Selection[K]>>;
	/** For the surfaces that subscribe per clip rather than reading the whole
	 *  selection — the lanes and the clips in them. */
	store: SelectionStore;
}

/** `external` lets a parent OWN the store without subscribing to it.
 *
 *  The editor shell needs to seed the selection when the operator moves between
 *  its views, and holding the store is enough for that — reading it there is not.
 *  Calling this hook in the shell would re-render the whole editor on every
 *  selection change, which is the cost this store exists to avoid. */
export function useSelection(
	initial: Selection = EMPTY_SELECTION,
	external?: SelectionStore,
): SelectionState {
	const [own] = useState(() => createSelectionStore(initial));
	const store = external ?? own;
	const selection = useSelectionValue(store);

	/* Equal selections are dropped by the store, not here: selecting what is
	 * already selected is not a state change, and the question belongs next to
	 * the value rather than next to one of its readers. */
	const setSelection = useCallback<Dispatch<SetStateAction<Selection>>>(
		(next) => store.set(next),
		[store],
	);

	const slot = useCallback(
		<K extends keyof Selection>(key: K): Dispatch<SetStateAction<Selection[K]>> =>
			(next) =>
				store.set((prev) => ({
					...prev,
					[key]: resolveSetState(next, prev[key]),
				})),
		[store],
	);

	return useMemo(
		() => ({ selection, setSelection, slot, store }),
		[selection, setSelection, slot, store],
	);
}
