/* The second axis, which belongs to the consumer.
 *
 * The library resolves time. It does not know what a row means: Maleo's lanes,
 * a compositor's layers, and a keyframe editor's property tracks are three
 * different taxonomies, and a library that re-derived rows from a DOM lookup
 * would reintroduce exactly the private-DOM dependency it exists to remove.
 *
 * So the consumer supplies this. Two rules shape it:
 *
 *   - **Height varies per row and is fixed per item.** Resolution is a
 *     cumulative-offset lookup, never a division by a uniform height. A single
 *     constant row height is a number that has to agree with one in a
 *     stylesheet, and nothing checks that two such numbers agree.
 *   - **A row may refuse an item**, and the refusal is visible in the projection
 *     before the commit rather than discovered by the commit failing.
 */
import type { RowId, TimelineItem } from "./types.ts";

/** One row's contribution to the cross axis. */
export interface RowMetric {
	readonly id: RowId;
	/** How tall this row is drawn. Rows need not agree. */
	readonly heightPx: number;
}

/** What a commit does when the destination row refuses the item. */
export type RefusalBehaviour = "decline" | "reroute";

/** Everything the surface asks of the cross axis. */
export interface CrossAxisAdapter {
	/** The row containing this coordinate, or none above or below every row. */
	rowAt(yPx: number): RowId | undefined;
	/** Where the row starts, measured from the top of the row area. */
	offsetOf(rowId: RowId): number;
	heightOf(rowId: RowId): number;
	/** Rows top to bottom. Painting and traversal order. */
	order(): readonly RowId[];
	/** Whether this row takes this item. */
	accepts(rowId: RowId, item: TimelineItem): boolean;
	readonly refusal: RefusalBehaviour;
	/** Where a rerouting adapter sends a refused item. */
	reroute(item: TimelineItem, refused: RowId): RowId | undefined;
}

/** Rows as they are now. A function when the consumer's rows can change height. */
export type RowMetricSource = readonly RowMetric[] | (() => readonly RowMetric[]);

export interface CrossAxisOptions {
	/** Which rows take which items. Everything is accepted by default. */
	accepts?(rowId: RowId, item: TimelineItem): boolean;
	readonly refusal?: RefusalBehaviour;
	/** Where a refused item goes under `reroute`. The nearest accepting row by default. */
	reroute?(item: TimelineItem, refused: RowId): RowId | undefined;
}

interface Resolved {
	readonly metrics: readonly RowMetric[];
	/** Cumulative tops, one per row, plus the total at the end. */
	readonly offsets: readonly number[];
}

function resolve(metrics: readonly RowMetric[]): Resolved {
	const offsets: number[] = [0];
	for (const metric of metrics)
		offsets.push(offsets[offsets.length - 1]! + Math.max(0, metric.heightPx));
	return { metrics, offsets };
}

/**
 * A cross axis over rows of any heights.
 *
 * Pass a function when heights can change: it is called on every lookup, so a
 * consumer that re-measures its rows is followed immediately and no constant in
 * this file has to be updated to match a stylesheet.
 */
export function createCrossAxis(
	rows: RowMetricSource,
	options: CrossAxisOptions = {},
): CrossAxisAdapter {
	/* Cached by the identity of the array the source returned. A consumer with
	 * static rows pays for the cumulative sum once; one that re-measures pays
	 * again only when the measurements actually changed. */
	let cache: Resolved | undefined;
	function current(): Resolved {
		const metrics = typeof rows === "function" ? rows() : rows;
		if (!cache || cache.metrics !== metrics) cache = resolve(metrics);
		return cache;
	}

	function indexOf(rowId: RowId): number {
		return current().metrics.findIndex((metric) => metric.id === rowId);
	}

	const adapter: CrossAxisAdapter = {
		order: () => current().metrics.map((metric) => metric.id),
		offsetOf(rowId) {
			const index = indexOf(rowId);
			return index < 0 ? 0 : current().offsets[index]!;
		},
		heightOf(rowId) {
			const index = indexOf(rowId);
			return index < 0 ? 0 : current().metrics[index]!.heightPx;
		},
		rowAt(yPx) {
			const { metrics, offsets } = current();
			/* A walk over cumulative offsets, not `Math.floor(y / rowHeight)`. The
			 * division is only correct when every row is the same height, and it is
			 * wrong silently — the pointer lands on the row above or below and the
			 * drag looks like it has a one-row bias. */
			if (yPx < 0) return undefined;
			for (const [index, metric] of metrics.entries()) {
				if (yPx >= offsets[index]! && yPx < offsets[index + 1]!) return metric.id;
			}
			return undefined;
		},
		accepts: (rowId, item) => options.accepts?.(rowId, item) ?? true,
		refusal: options.refusal ?? "decline",
		reroute(item, refused) {
			if (options.reroute) return options.reroute(item, refused);
			/* The nearest accepting row, measured in rows rather than pixels: the
			 * question is which lane the person meant, and a tall row is not further
			 * away than a short one. */
			const order = adapter.order();
			const from = order.indexOf(refused);
			if (from < 0) return undefined;
			for (let distance = 1; distance < order.length; distance += 1) {
				for (const candidate of [order[from - distance], order[from + distance]]) {
					if (candidate !== undefined && adapter.accepts(candidate, item)) return candidate;
				}
			}
			return undefined;
		},
	};
	return adapter;
}
