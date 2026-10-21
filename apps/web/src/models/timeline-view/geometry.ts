/* Three boxes, and no affordance hidden in CSS.
 *
 * An item has three separate rectangles and conflating any two of them causes a
 * specific, familiar bug:
 *
 *   - `timeBox` is the duration. It is the truth, and nothing widens it.
 *   - `paintBox` is what is drawn. It may exceed the time box for legibility,
 *     and when it does it says so — because the alternative is a timeline that
 *     quietly stops representing durations, with the discrepancy discoverable
 *     only by measuring.
 *   - `hitBox` is what is interactive. It meets the platform minimum and grows
 *     INWARD from the item's own edges, so it never takes a press belonging to
 *     the item next door.
 *
 * The reason this is three values and not one padded value was learned twice in
 * the previous change: an affordance hidden with `display: none` keeps its hit
 * area and takes the press meant for the body underneath. Whether an affordance
 * exists at all is a capability decision, in data, and a host renders nothing
 * for a declined one.
 */
import type { ItemCapabilities, Row, TimelineItem, ViewportInput } from "./types.ts";
import { pixelAtTime } from "./viewport.ts";
import { projectTime } from "./tick.ts";

/** A horizontal extent in device pixels. */
export interface Box {
	readonly leftPx: number;
	readonly rightPx: number;
}

/** The width of a box. Never negative. */
export function boxWidth(box: Box): number {
	return Math.max(0, box.rightPx - box.leftPx);
}

/** What geometry answers for one item. */
export interface ItemGeometry {
	/** The duration, in pixels. The truth. */
	readonly timeBox: Box;
	/** What is drawn. */
	readonly paintBox: Box;
	/** True when the paint box is wider than the time box. */
	readonly padded: boolean;
	/**
	 * True when the HIT box is wider than the time box.
	 *
	 * Separate from `padded` because the two discrepancies are different facts
	 * with different consequences, and one flag covering both would answer
	 * neither question. `padded` says the drawing is wider than the duration, so
	 * a host may mark the excess. `hitPadded` says the touch target is wider than
	 * what is drawn — the case the touch spec asks be made apparent rather than
	 * silently applied, and the far more common one, since the interactive
	 * minimum is much larger than the drawing minimum.
	 */
	readonly hitPadded: boolean;
	/** What is interactive. At least the configured minimum, grown inward. */
	readonly hitBox: Box;
}

/** Sizes a consumer chooses, in device pixels. */
export interface GeometryOptions {
	/** The platform's minimum touch target. Nothing interactive is narrower. */
	readonly minHitPx: number;
	/** The narrowest an item is ever drawn, so a short item stays visible. */
	readonly minPaintPx: number;
	/** How wide a trim handle is drawn. */
	readonly handlePx: number;
}

/** A coarse-pointer default: 44px is the long-standing platform minimum. */
export const DEFAULT_GEOMETRY_OPTIONS: GeometryOptions = {
	minHitPx: 44,
	minPaintPx: 6,
	handlePx: 12,
};

/** Grow a box to a minimum width about its own centre. */
function growToMinimum(box: Box, minimumPx: number): Box {
	const width = boxWidth(box);
	if (width >= minimumPx) return box;
	const grow = (minimumPx - width) / 2;
	return { leftPx: box.leftPx - grow, rightPx: box.rightPx + grow };
}

/**
 * The three boxes for one item.
 *
 * `neighbours` are the time boxes of the items sharing this item's row. The hit
 * box is grown to the minimum and then pulled back off any neighbour it would
 * have crossed — "grown inward" in the requirement's words. Two adjacent items
 * that both expand therefore meet at their shared edge and neither takes the
 * other's press.
 */
export function itemGeometry(
	item: TimelineItem,
	viewport: ViewportInput,
	neighbours: readonly Box[] = [],
	options: GeometryOptions = DEFAULT_GEOMETRY_OPTIONS,
): ItemGeometry {
	const leftPx = pixelAtTime(viewport, item.start);
	/* A negative duration is not a state the model should carry, but geometry is
	 * defined for it rather than producing an inverted box that paints backwards
	 * and hit-tests as empty. */
	const rightPx = pixelAtTime(
		viewport,
		projectTime(item.start.ticks + Math.max(0, item.duration.ticks)),
	);
	const timeBox: Box = { leftPx, rightPx: Math.max(leftPx, rightPx) };

	const paintBox = growToMinimum(timeBox, options.minPaintPx);
	const padded = boxWidth(paintBox) > boxWidth(timeBox);

	const grown = growToMinimum(timeBox, options.minHitPx);
	let hitLeft = grown.leftPx;
	let hitRight = grown.rightPx;
	for (const neighbour of neighbours) {
		/* Only the neighbours this item was grown ACROSS matter. A neighbour that
		 * already overlapped the time box is a deliberate overlap the row permits,
		 * and clipping against it would shrink the hit box below the minimum for a
		 * reason that has nothing to do with the minimum. */
		if (neighbour.rightPx <= timeBox.leftPx) hitLeft = Math.max(hitLeft, neighbour.rightPx);
		if (neighbour.leftPx >= timeBox.rightPx) hitRight = Math.min(hitRight, neighbour.leftPx);
	}
	/* Clipping must not invert the box. An item wedged between two neighbours
	 * closer together than the minimum keeps its own extent and no more, which
	 * is the honest answer: there is no room to give it. */
	if (hitLeft > timeBox.leftPx) hitLeft = Math.min(hitLeft, timeBox.leftPx);
	if (hitRight < timeBox.rightPx) hitRight = Math.max(hitRight, timeBox.rightPx);

	const hitBox: Box = { leftPx: hitLeft, rightPx: hitRight };
	return { timeBox, paintBox, padded, hitPadded: boxWidth(hitBox) > boxWidth(timeBox), hitBox };
}

/**
 * What an item currently allows.
 *
 * A locked item, or an item on a locked row, declines every edit and keeps
 * selection — it is still a thing you can point at and read properties of.
 *
 * Trimming is declined on an item too narrow to hold a body between two
 * handles. That is not a degradation: two touch-sized handles would meet in the
 * middle and leave nothing to grab, and there is no trim precision at that zoom
 * to lose. The item is moved by its body and zoomed into before it is trimmed.
 */
export function itemCapabilities(
	item: TimelineItem,
	geometry: ItemGeometry,
	row: Row | undefined,
	options: GeometryOptions = DEFAULT_GEOMETRY_OPTIONS,
): ItemCapabilities {
	const locked = item.locked === true || row?.locked === true;
	if (locked) {
		return {
			select: true,
			move: false,
			trimStart: false,
			trimEnd: false,
			remove: false,
			readOnly: true,
		};
	}
	/* Body plus two handles, measured against what is DRAWN rather than against
	 * the hit box.
	 *
	 * The hit box is the wrong ruler here and measuring by it is a bug: it has
	 * already been grown to the interactive minimum, so every item is at least
	 * 44px by it and every item would appear to have room. The question is
	 * whether there is a visible body left between two handles, and only the
	 * paint box knows that. */
	const roomToTrim = boxWidth(geometry.paintBox) >= options.handlePx * 2 + options.minPaintPx;
	const source = item.source;
	/* An item already at the start of its media cannot be trimmed further in that
	 * direction, and reports that by declining rather than by clamping silently. */
	const canTrimStart =
		roomToTrim && (source === undefined || source.inPoint.ticks > source.availableStart.ticks);
	const canTrimEnd =
		roomToTrim &&
		(source === undefined ||
			source.inPoint.ticks + item.duration.ticks < source.availableEnd.ticks);
	return {
		select: true,
		move: true,
		trimStart: canTrimStart,
		trimEnd: canTrimEnd,
		remove: true,
		readOnly: false,
	};
}

/** The two trim handles, when they are offered. Absent means no element exists. */
export interface TrimHandles {
	readonly start?: Box;
	readonly end?: Box;
}

/**
 * Where the handles go, for the capabilities that are granted.
 *
 * Inset within the item's own bounds rather than straddling its edges: a handle
 * that overhangs is a handle that takes the neighbour's press, which is the
 * same defect as a hidden one wearing different clothes.
 */
export function trimHandles(
	geometry: ItemGeometry,
	capabilities: ItemCapabilities,
	options: GeometryOptions = DEFAULT_GEOMETRY_OPTIONS,
): TrimHandles {
	/* Built as a mutable `TrimHandles` rather than under an anonymous shape, so
	 * the returned contract is the named one and the two cannot drift apart. */
	const handles: { -readonly [K in keyof TrimHandles]: TrimHandles[K] } = {};
	/* Inset within the DRAWN bounds, for the same reason the room for them is
	 * measured there: a handle placed against the grown hit box would sit outside
	 * the clip a person can see, which is an overhanging handle wearing different
	 * clothes. */
	if (capabilities.trimStart) {
		handles.start = {
			leftPx: geometry.paintBox.leftPx,
			rightPx: geometry.paintBox.leftPx + options.handlePx,
		};
	}
	if (capabilities.trimEnd) {
		handles.end = {
			leftPx: geometry.paintBox.rightPx - options.handlePx,
			rightPx: geometry.paintBox.rightPx,
		};
	}
	return handles;
}
