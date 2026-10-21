/* Painted geometry, assertable without reading the DOM.
 *
 * A painted item has no element to measure, so every assertion a test suite
 * makes today by reading a box would become unassertable — the coverage would
 * not fail, it would quietly stop existing. This is the replacement, and it is a
 * shipped interface rather than a test hook: a consumer building its own
 * assertions needs exactly the same answers.
 *
 * It reports what the kernel computed, in the kernel's units. It does not
 * measure anything, which is the point: a query that measured the canvas could
 * only confirm that the painter drew what the painter drew.
 */
import {
	itemCapabilities,
	itemGeometry,
	trimHandles,
	type Box,
	type GeometryOptions,
	type ItemGeometry,
	type TrimHandles,
} from "@models/timeline-view/geometry.ts";
import {
	type ItemCapabilities,
	type ItemId,
	type TimelineState,
} from "@models/timeline-view/types.ts";
import type { ItemIndex } from "@services/paint/scene.ts";
import { createItemIndex } from "@services/paint/scene.ts";

/** Everything the query answers about one item. */
export interface ItemQueryResult extends ItemGeometry {
	readonly id: ItemId;
	readonly selected: boolean;
	readonly focused: boolean;
	/** Whether the item is within the visible range, and so has a mounted element. */
	readonly visible: boolean;
	readonly capabilities: ItemCapabilities;
	readonly handles: TrimHandles;
	/** Where the item sits on the cross axis, when the consumer declares rows. */
	readonly topPx: number;
	readonly heightPx: number;
}

export interface GeometryQueryOptions {
	state(): TimelineState;
	/** Row offsets and heights. A single-row consumer may leave it out. */
	readonly rows?: {
		offsetOf(rowId: string | undefined): number;
		heightOf(rowId: string | undefined): number;
	};
	readonly rulerHeightPx?: number;
	readonly geometry?: GeometryOptions;
	/** Rebuilt when the document changes; supplied so a query is not O(document). */
	index?(): ItemIndex;
}

/** Query by identity. Nothing here reads an element. */
export interface GeometryQuery {
	itemAt(id: ItemId): ItemQueryResult | undefined;
	/** Items within the visible range, in painting order. */
	visibleItems(): readonly ItemId[];
	/** The number of items on screen. The bound a mounted-node count is judged against. */
	visibleCount(): number;
}

export function createGeometryQuery(options: GeometryQueryOptions): GeometryQuery {
	const indexOf = options.index ?? ((): ItemIndex => createItemIndex(options.state()));

	function visible(): readonly ItemId[] {
		const state = options.state();
		return indexOf().inRange(state.viewport.start.ticks, state.viewport.end.ticks);
	}

	return {
		visibleItems: visible,
		visibleCount: () => visible().length,
		itemAt(id) {
			const state = options.state();
			const item = state.items.get(id);
			if (!item) return undefined;
			/* Neighbours matter here and not in the scene: the hit box grows inward
			 * off them, and this is the answer a test asks when it wants to know
			 * whether two adjacent items can both be pressed. Only the items sharing
			 * the row are consulted.
			 *
			 * This walk is linear in the document, and deliberately so: the query is
			 * answered on demand, not once per frame. The frame path is
			 * `visibleScenery`, which consults no neighbours precisely because doing
			 * so per item would make painting quadratic in the visible range. */
			const neighbours: Box[] = [];
			for (const other of state.items.values()) {
				if (other.id === id || other.rowId !== item.rowId) continue;
				neighbours.push(itemGeometry(other, state.viewport, [], options.geometry).timeBox);
			}
			const geometry = itemGeometry(item, state.viewport, neighbours, options.geometry);
			const row = state.rows.find((candidate) => candidate.id === item.rowId);
			const capabilities = itemCapabilities(item, geometry, row, options.geometry);
			return {
				...geometry,
				id,
				selected: state.selection.has(id),
				focused: state.focus?.kind === "item" && state.focus.id === id,
				visible: visible().includes(id),
				capabilities,
				handles: trimHandles(geometry, capabilities, options.geometry),
				topPx: (options.rulerHeightPx ?? 0) + (options.rows?.offsetOf(item.rowId) ?? 0),
				heightPx: options.rows?.heightOf(item.rowId) ?? 0,
			};
		},
	};
}
