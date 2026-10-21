/* The sparse interactive DOM over the painted canvas.
 *
 * Pixels are painted; the things a person can act on are elements. An element
 * exists for an item only while that item is within the visible range, so the
 * mounted node count is a function of what is on screen and not of the project.
 * At two thousand items with fifty visible that is the difference between a
 * timeline that opens and one that does not.
 *
 * The elements themselves are created by the consumer's factory. This layer
 * decides only which ones should exist, and when to let one go — the reconciler
 * a React binding drives, and the same reconciler anything else can drive.
 */
import type { ItemId } from "@models/timeline-view/types.ts";

/** One mounted interactive element, from the consumer's point of view. */
export interface OverlayNode<E> {
	readonly id: ItemId;
	readonly element: E;
}

export interface OverlayOptions<E> {
	/** Create an element for an item entering the visible range. */
	create(id: ItemId): E;
	/** Position or update an element that is staying. */
	update?(id: ItemId, element: E): void;
	/** Release an element leaving the visible range. */
	release?(id: ItemId, element: E): void;
	/**
	 * Keep an element mounted although it left the range.
	 *
	 * The gesture in flight is the reason this exists: recycling the element a
	 * drag started on is safe for the gesture, which lives in the store, but a
	 * focused element vanishing from under the keyboard is not — focus would fall
	 * to the document body mid-edit.
	 */
	retain?(id: ItemId): boolean;
}

export interface Overlay<E> {
	/** Reconcile to exactly this visible set, plus anything retained. */
	sync(visible: readonly ItemId[]): void;
	/** Elements currently mounted. The number a node-count budget is measured on. */
	nodes(): readonly OverlayNode<E>[];
	size(): number;
	/** Release everything. Nothing mounted afterwards. */
	dispose(): void;
}

export function createOverlay<E>(options: OverlayOptions<E>): Overlay<E> {
	const mounted = new Map<ItemId, E>();

	function release(id: ItemId): void {
		const element = mounted.get(id);
		if (element === undefined) return;
		mounted.delete(id);
		options.release?.(id, element);
	}

	return {
		sync(visible) {
			const wanted = new Set(visible);
			for (const id of [...mounted.keys()]) {
				if (wanted.has(id)) continue;
				/* Asked before releasing, not after: a retained element that had
				 * already been released would be re-created, which is the unmount the
				 * retention exists to prevent. */
				if (options.retain?.(id) === true) continue;
				release(id);
			}
			for (const id of visible) {
				const existing = mounted.get(id);
				if (existing === undefined) mounted.set(id, options.create(id));
				else options.update?.(id, existing);
			}
		},
		nodes: () => [...mounted.entries()].map(([id, element]) => ({ id, element })),
		size: () => mounted.size,
		dispose() {
			for (const id of [...mounted.keys()]) release(id);
		},
	};
}
