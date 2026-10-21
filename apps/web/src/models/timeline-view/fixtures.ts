/* Timeline shapes the model has to be able to represent.
 *
 * Three unlike consumers, built here so the model is checked against more than
 * the one it was written beside — the failure this whole rebuild exists to
 * correct. Nothing here imports a consumer type, which is the point being
 * demonstrated: a magnetic single-row editor, a multi-row editor, and a
 * keyframe editor are all expressible in the library's own terms.
 *
 * Not exported from any entry point. Test-facing, and `tests/public-api` would
 * fail if that changed.
 */
import { framesToProject, framesToSource, projectTime, sourceTime } from "./tick.ts";
import { timebase } from "./timebase.ts";
import { rational } from "./rational.ts";
import { resolveViewport } from "./viewport.ts";
import type { ItemId, Row, TimelineItem, TimelineState } from "./types.ts";

/** 30 fps, the rate most of these fixtures are written at. */
export const BASE_30 = timebase(rational(30, 1));

/** 29.97 drop-frame, for the fixtures that exist to be awkward. */
export const BASE_2997 = timebase(rational(30000, 1001));

function assemble(
	items: readonly TimelineItem[],
	rows: readonly Row[],
	durationFrames: number,
): TimelineState {
	const map = new Map<ItemId, TimelineItem>();
	for (const item of items) map.set(item.id, item);
	return {
		timebase: BASE_30,
		duration: framesToProject(durationFrames, BASE_30),
		rows,
		items: map,
		order: items.map((item) => item.id),
		markers: [],
		selection: new Set(),
		/* 0.01 device pixels per tick, so 800px shows 80 frames of a timeline that
		 * is hundreds long. A viewport wider than its content clamps to a start of
		 * zero and cannot pan at all, which is correct behaviour and a useless
		 * fixture — the scrolling cases would pass by never scrolling. */
		viewport: resolveViewport({ start: projectTime(0), scale: 0.01, widthPx: 800 }),
		gestures: new Map(),
	};
}

/**
 * A magnetic single-row timeline: contiguous scenes, no row on any item.
 *
 * The single-row consumer supplies no cross-axis adapter, so no item carries a
 * row and no operation names one.
 */
export function magneticSingleRow(): TimelineState {
	const items: TimelineItem[] = [0, 1, 2, 3].map((index) => ({
		id: `scene-${index}`,
		kind: "scene",
		label: `Scene ${index + 1}`,
		start: framesToProject(index * 90, BASE_30),
		duration: framesToProject(90, BASE_30),
		source: {
			timebase: BASE_30,
			inPoint: framesToSource(0, BASE_30),
			availableStart: sourceTime(0),
			availableEnd: framesToSource(300, BASE_30),
		},
	}));
	return assemble(items, [{ id: "base", placement: "magnetic", overlap: "insert" }], 360);
}

/**
 * A multi-row timeline with unlike rows: a magnetic base and two free overlays.
 *
 * Deliberately mixed, because "an edit on either behaves under its own row's
 * policy, and neither affects the other" is a requirement and not an accident.
 * One item is locked and one pair is linked.
 */
export function multiRowFree(): TimelineState {
	const rows: Row[] = [
		{ id: "video", placement: "magnetic", overlap: "insert" },
		{ id: "overlay", placement: "free", overlap: "permit" },
		{ id: "audio", placement: "free", overlap: "reject" },
	];
	const items: TimelineItem[] = [
		{
			id: "v1",
			rowId: "video",
			kind: "video",
			start: framesToProject(0, BASE_30),
			duration: framesToProject(120, BASE_30),
			linkedTo: ["a1"],
			source: {
				timebase: BASE_30,
				inPoint: framesToSource(30, BASE_30),
				availableStart: sourceTime(0),
				availableEnd: framesToSource(600, BASE_30),
			},
		},
		{
			id: "v2",
			rowId: "video",
			kind: "video",
			start: framesToProject(120, BASE_30),
			duration: framesToProject(90, BASE_30),
		},
		{
			id: "t1",
			rowId: "overlay",
			kind: "text",
			start: framesToProject(30, BASE_30),
			duration: framesToProject(45, BASE_30),
			groupId: "titles",
		},
		{
			id: "t2",
			rowId: "overlay",
			kind: "text",
			start: framesToProject(150, BASE_30),
			duration: framesToProject(45, BASE_30),
			groupId: "titles",
		},
		{
			id: "locked",
			rowId: "overlay",
			kind: "watermark",
			start: framesToProject(0, BASE_30),
			duration: framesToProject(210, BASE_30),
			locked: true,
		},
		{
			id: "a1",
			rowId: "audio",
			kind: "audio",
			start: framesToProject(0, BASE_30),
			duration: framesToProject(120, BASE_30),
			linkedTo: ["v1"],
			source: {
				timebase: BASE_30,
				inPoint: framesToSource(30, BASE_30),
				availableStart: sourceTime(0),
				availableEnd: framesToSource(600, BASE_30),
			},
		},
	];
	return assemble(items, rows, 240);
}

/**
 * A keyframe timeline: one item carrying nested property tracks.
 *
 * Nested rather than flattened into rows, because a keyframe's position is
 * meaningful only relative to the item that carries it.
 */
export function nestedKeyframes(): TimelineState {
	const item: TimelineItem = {
		id: "layer-1",
		rowId: "layers",
		kind: "layer",
		label: "Logo",
		start: framesToProject(0, BASE_30),
		duration: framesToProject(150, BASE_30),
		tracks: [
			{
				id: "opacity",
				label: "Opacity",
				markers: [0, 30, 90, 150].map((frame) => ({
					id: `opacity-${frame}`,
					at: framesToProject(frame, BASE_30),
				})),
			},
			{
				id: "position",
				label: "Position",
				markers: [0, 75].map((frame) => ({
					id: `position-${frame}`,
					at: framesToProject(frame, BASE_30),
					label: "hold",
				})),
			},
		],
	};
	return assemble([item], [{ id: "layers", placement: "free", overlap: "permit" }], 150);
}
