/* What painting is, described so the backend can be swapped without the kernel
 * hearing about it.
 *
 * The backend receives a frame: what to draw, and which regions of the surface
 * are dirty. It never reads the store, never computes geometry, and never
 * decides when to run — those belong to the scene description and to the
 * scheduler respectively, so replacing Canvas 2D with WebGL is one file.
 *
 * Regions rather than "repaint": a canvas that redraws entirely on selection has
 * given back everything that making selection a subscription bought, in a form
 * no render counter would show.
 */
import type { ItemId } from "@models/timeline-view/types.ts";
import type { PaintRegion } from "@models/timeline-view/effects.ts";
import { browserFrameClock, type FrameClock } from "@services/frame-clock/clock.ts";

/** One colour surface the painter draws with. Resolved from theme tokens. */
export interface PaintPalette {
	readonly background: string;
	readonly item: string;
	readonly itemSelected: string;
	readonly itemLocked: string;
	readonly itemLabel: string;
	readonly ruler: string;
	readonly rulerText: string;
	readonly playhead: string;
	readonly snapGuide: string;
	/** Drawn over the excess where an item is painted wider than its duration. */
	readonly paddedMark: string;
}

/** An item as the painter needs it: pixels, and the state that changes its look. */
export interface PaintedItem {
	readonly id: ItemId;
	readonly leftPx: number;
	readonly rightPx: number;
	readonly topPx: number;
	readonly heightPx: number;
	readonly selected: boolean;
	readonly focused: boolean;
	/** The drawing is wider than the duration, and the excess is marked. */
	readonly padded: boolean;
	readonly locked: boolean;
	readonly label?: string;
}

/** One graduation on the ruler. */
export interface RulerTick {
	readonly xPx: number;
	/** Major ticks carry a label; minor ones are a mark only. */
	readonly label?: string;
}

/** Anything a consumer draws on top, positioned in surface pixels. */
export interface PaintOverlay {
	readonly id: string;
	readonly region: PaintRegion;
	readonly colour: string;
}

/** Everything the surface looks like at one moment. */
export interface PaintScene {
	readonly widthPx: number;
	readonly heightPx: number;
	readonly rulerHeightPx: number;
	readonly palette: PaintPalette;
	readonly items: readonly PaintedItem[];
	readonly ticks: readonly RulerTick[];
	readonly playheadPx?: number;
	/** Snap guides, in surface pixels. Drawn only while an edit is snapping. */
	readonly guides: readonly number[];
	readonly overlays: readonly PaintOverlay[];
}

/** One frame of work: the scene, and the parts of it that are stale. */
export interface PaintFrame {
	readonly scene: PaintScene;
	/**
	 * The regions to repaint.
	 *
	 * Never empty: a caller that means "everything" says so with one region
	 * covering the surface, so the backend has one code path and a test can tell
	 * a full repaint from a partial one by looking at the frame.
	 */
	readonly regions: readonly PaintRegion[];
}

/** A drawing surface. Swappable — Canvas 2D today, anything else later. */
export interface PaintBackend {
	paint(frame: PaintFrame): void;
}

/** Whether two regions touch or overlap, so they can be merged into one. */
function intersects(a: PaintRegion, b: PaintRegion): boolean {
	return (
		a.xPx <= b.xPx + b.widthPx &&
		b.xPx <= a.xPx + a.widthPx &&
		a.yPx <= b.yPx + b.heightPx &&
		b.yPx <= a.yPx + a.heightPx
	);
}

function merge(a: PaintRegion, b: PaintRegion): PaintRegion {
	const left = Math.min(a.xPx, b.xPx);
	const top = Math.min(a.yPx, b.yPx);
	const right = Math.max(a.xPx + a.widthPx, b.xPx + b.widthPx);
	const bottom = Math.max(a.yPx + a.heightPx, b.yPx + b.heightPx);
	return { xPx: left, yPx: top, widthPx: right - left, heightPx: bottom - top };
}

/**
 * Coalesce regions so overlapping invalidations are painted once.
 *
 * Two clips whose selected state changed on one click produce two regions; if
 * they are adjacent, painting the union once is cheaper than painting two
 * rectangles that share an edge. Disjoint regions stay separate — merging the
 * two ends of a long timeline into their bounding box would repaint everything
 * between them, which is the failure this whole mechanism exists to avoid.
 */
export function coalesceRegions(regions: readonly PaintRegion[]): PaintRegion[] {
	const merged: PaintRegion[] = [];
	for (const region of regions) {
		let current = region;
		for (let index = merged.length - 1; index >= 0; index -= 1) {
			const existing = merged[index]!;
			if (!intersects(current, existing)) continue;
			current = merge(current, existing);
			merged.splice(index, 1);
		}
		merged.push(current);
	}
	return merged;
}

export interface PaintSchedulerOptions {
	readonly backend: PaintBackend;
	/** Read the scene as it is now. Called once per painted frame, never per region. */
	scene(): PaintScene;
	readonly clock?: FrameClock;
}

/**
 * Collects invalidations and paints at most once per frame.
 *
 * Per frame rather than per invalidation, because one user action produces
 * several: selecting a second clip invalidates two regions, and painting twice
 * for one click is the same waste as painting everything once.
 */
export interface PaintScheduler {
	/** Mark a region stale. Cheap, and safe to call many times per frame. */
	invalidate(region: PaintRegion): void;
	/** Paint now, if anything is stale. Returns whether it painted. */
	flush(): boolean;
	/** Regions currently stale and unpainted. */
	pending(): readonly PaintRegion[];
	/** Drop the pending frame. Nothing outstanding afterwards. */
	dispose(): void;
}

export function createPaintScheduler(options: PaintSchedulerOptions): PaintScheduler {
	const clock = options.clock ?? browserFrameClock();
	let pending: PaintRegion[] = [];
	let frame: number | undefined;
	let disposed = false;

	function flush(): boolean {
		if (frame !== undefined) {
			clock.cancel(frame);
			frame = undefined;
		}
		if (pending.length === 0 || disposed) return false;
		const regions = coalesceRegions(pending);
		pending = [];
		options.backend.paint({ scene: options.scene(), regions });
		return true;
	}

	return {
		invalidate(region) {
			if (disposed) return;
			pending.push(region);
			/* One frame request outstanding at a time. Re-requesting per region is
			 * how a scheduler ends up doing the work it exists to batch. */
			if (frame === undefined) frame = clock.request(() => flush());
		},
		flush,
		pending: () => coalesceRegions(pending),
		dispose() {
			disposed = true;
			pending = [];
			if (frame !== undefined) {
				clock.cancel(frame);
				frame = undefined;
			}
		},
	};
}
