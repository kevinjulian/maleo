/* What the surface looks like right now, derived rather than stored.
 *
 * Two things live here, and they are the same argument twice. The visible-range
 * index answers "which items are on screen" without touching the ones that are
 * not, and the scene description turns exactly those into pixels. Per-frame work
 * is therefore a function of the visible range and not of the project: the
 * requirement that makes a project of a few thousand clips behave like the one
 * on screen.
 */
import {
	itemGeometry,
	type GeometryOptions,
	type ItemGeometry,
} from "@models/timeline-view/geometry.ts";
import { pixelAtTime } from "@models/timeline-view/viewport.ts";
import { projectTime, timeToFrames } from "@models/timeline-view/tick.ts";
import type { Timebase } from "@models/timeline-view/timebase.ts";
import {
	type ItemId,
	type RowId,
	type TimelineItem,
	type TimelineState,
	type Viewport,
} from "@models/timeline-view/types.ts";
import type { PaintedItem, PaintOverlay, PaintPalette, PaintScene, RulerTick } from "./paint.ts";

/**
 * Where a row sits and how tall it is.
 *
 * The minimum the painter needs from the cross axis. Only the consumer knows
 * its lane taxonomy, and a row height in the library is a number that has to
 * agree with one in a stylesheet with nothing checking that they do.
 */
export interface RowGeometry {
	/** Distance from the top of the row area to this row's top, in pixels. */
	offsetOf(rowId: RowId | undefined): number;
	heightOf(rowId: RowId | undefined): number;
}

/** One height for every row, for a consumer whose rows are uniform. */
export function uniformRows(rows: readonly RowId[], heightPx: number): RowGeometry {
	const index = new Map(rows.map((id, position) => [id, position]));
	return {
		offsetOf: (rowId) => (rowId === undefined ? 0 : (index.get(rowId) ?? 0) * heightPx),
		heightOf: () => heightPx,
	};
}

/* ---- The visible-range index --------------------------------------------- */

interface IndexEntry {
	readonly id: ItemId;
	readonly startTicks: number;
	readonly endTicks: number;
}

/** Which items are on screen, answered without walking the ones that are not. */
export interface ItemIndex {
	/** Items overlapping the range, in start order. */
	inRange(startTicks: number, endTicks: number): readonly ItemId[];
	/** How many entries the index holds. */
	readonly size: number;
}

function lowerBound(entries: readonly IndexEntry[], ticks: number): number {
	let low = 0;
	let high = entries.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (entries[middle]!.startTicks < ticks) low = middle + 1;
		else high = middle;
	}
	return low;
}

/**
 * Build the index once per document change, not once per frame.
 *
 * Sorted by start, with the longest duration remembered. A lookup binary-searches
 * for the first item that could still be on screen — one that starts before the
 * viewport but no earlier than the longest item's duration — and then walks
 * forward only while starts remain inside the range. Work is logarithmic in the
 * document plus linear in the answer.
 *
 * The longest-duration bound rather than a per-item interval tree: an interval
 * tree is the right structure when a few items are enormously longer than the
 * rest, and it costs a rebalance on every edit. On a timeline the durations are
 * within an order of magnitude of each other, so the bound scans a handful of
 * extra entries and the structure stays an array anything can rebuild in one
 * pass.
 */
export function createItemIndex(state: TimelineState): ItemIndex {
	const entries: IndexEntry[] = [];
	let longestTicks = 0;
	for (const id of state.order) {
		const item = state.items.get(id);
		if (!item) continue;
		const duration = Math.max(0, item.duration.ticks);
		if (duration > longestTicks) longestTicks = duration;
		entries.push({ id, startTicks: item.start.ticks, endTicks: item.start.ticks + duration });
	}
	entries.sort((a, b) => a.startTicks - b.startTicks);
	return {
		size: entries.length,
		inRange(startTicks, endTicks) {
			const visible: ItemId[] = [];
			for (
				let index = lowerBound(entries, startTicks - longestTicks);
				index < entries.length;
				index += 1
			) {
				const entry = entries[index]!;
				if (entry.startTicks > endTicks) break;
				if (entry.endTicks >= startTicks) visible.push(entry.id);
			}
			return visible;
		},
	};
}

/* ---- The scene ------------------------------------------------------------ */

/** How many frames one ruler graduation may span. Ascending, and musical. */
const TICK_STEPS_IN_FRAMES = [
	1, 2, 5, 10, 15, 30, 60, 150, 300, 600, 1800, 3600, 9000, 18_000, 54_000,
] as const;

/**
 * Choose a graduation that leaves labels legible at this magnification.
 *
 * From a fixed ladder rather than from a computed round number, because the
 * ladder's steps are the ones that mean something in time — half a second, a
 * second, five, a minute — and a computed step lands on 37 frames.
 */
export function rulerStepFrames(
	viewport: Viewport,
	ticksPerFrame: number,
	minSpacingPx: number,
): number {
	for (const step of TICK_STEPS_IN_FRAMES) {
		/* `scale` is pixels per TICK, so a step in frames has to travel through the
		 * timebase to become a width. Comparing frames to pixels directly is the
		 * mistake that makes a 24 fps ruler look right and a 30 fps one crowded. */
		if (step * ticksPerFrame * viewport.scale >= minSpacingPx) return step;
	}
	return TICK_STEPS_IN_FRAMES[TICK_STEPS_IN_FRAMES.length - 1]!;
}

export interface SceneOptions {
	readonly palette: PaintPalette;
	readonly rows: RowGeometry;
	readonly heightPx: number;
	readonly rulerHeightPx: number;
	readonly geometry?: GeometryOptions;
	/** A ruler label: a frame number as timecode. The Rust engine formats it
	 *  (`Engine.formatTimecode`), drop-frame counting included. */
	readonly timecode: (frames: number, timebase: Timebase) => string;
	/** The narrowest a ruler label may be spaced. */
	readonly minTickSpacingPx?: number;
	readonly playheadTicks?: number;
	/** Snap guides in ticks, from an edit in flight. */
	readonly guideTicks?: readonly number[];
	readonly overlays?: readonly PaintOverlay[];
	/** Reused across frames. Rebuilt when the document changes, not per frame. */
	readonly index?: ItemIndex;
}

/** Everything one item contributes: its boxes and its painted form. */
export interface ItemScenery {
	readonly item: TimelineItem;
	readonly geometry: ItemGeometry;
	readonly painted: PaintedItem;
}

/** The items on screen, with their geometry, in painting order. */
export function visibleScenery(state: TimelineState, options: SceneOptions): ItemScenery[] {
	const index = options.index ?? createItemIndex(state);
	const scenery: ItemScenery[] = [];
	for (const id of index.inRange(state.viewport.start.ticks, state.viewport.end.ticks)) {
		const item = state.items.get(id);
		if (!item) continue;
		/* Neighbours are not consulted here. The hit box's inward growth needs
		 * them, and the painter does not draw the hit box — a scene that gathered
		 * every neighbour per item would be quadratic in the visible range for a
		 * number it never uses. `geometryOf` in the query supplies them. */
		const geometry = itemGeometry(item, state.viewport, [], options.geometry);
		const topPx = options.rulerHeightPx + options.rows.offsetOf(item.rowId);
		scenery.push({
			item,
			geometry,
			painted: {
				id,
				leftPx: geometry.paintBox.leftPx,
				rightPx: geometry.paintBox.rightPx,
				topPx,
				heightPx: options.rows.heightOf(item.rowId),
				selected: state.selection.has(id),
				focused: state.focus?.kind === "item" && state.focus.id === id,
				padded: geometry.padded,
				locked: item.locked === true,
				label: item.label,
			},
		});
	}
	return scenery;
}

/** The ruler's graduations across the visible range. */
export function rulerTicks(state: TimelineState, options: SceneOptions): RulerTick[] {
	const step = rulerStepFrames(
		state.viewport,
		state.timebase.ticksPerFrame,
		options.minTickSpacingPx ?? 80,
	);
	const firstFrame =
		Math.floor(timeToFrames(state.viewport.start, state.timebase).value / step) * step;
	const ticks: RulerTick[] = [];
	for (let frame = Math.max(0, firstFrame); ; frame += step) {
		const xPx =
			(frame * state.timebase.ticksPerFrame - state.viewport.start.ticks) * state.viewport.scale;
		if (xPx > state.viewport.widthPx) break;
		if (xPx >= 0) ticks.push({ xPx, label: options.timecode(frame, state.timebase) });
	}
	return ticks;
}

/** The whole scene, ready to hand to a backend. */
export function describeScene(state: TimelineState, options: SceneOptions): PaintScene {
	return {
		widthPx: state.viewport.widthPx,
		heightPx: options.heightPx,
		rulerHeightPx: options.rulerHeightPx,
		palette: options.palette,
		items: visibleScenery(state, options).map((entry) => entry.painted),
		ticks: rulerTicks(state, options),
		playheadPx:
			options.playheadTicks === undefined
				? undefined
				: pixelAtTime(state.viewport, projectTime(options.playheadTicks)),
		guides: (options.guideTicks ?? []).map(
			(atTicks) => (atTicks - state.viewport.start.ticks) * state.viewport.scale,
		),
		overlays: options.overlays ?? [],
	};
}
