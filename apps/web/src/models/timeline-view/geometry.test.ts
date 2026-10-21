import { describe, expect, test } from "vite-plus/test";
import { BASE_30 } from "./fixtures.ts";
import type { Row, TimelineItem } from "./types.ts";
import { framesToProject, framesToSource, projectTime, sourceTime } from "./tick.ts";
import {
	boxWidth,
	DEFAULT_GEOMETRY_OPTIONS,
	itemCapabilities,
	itemGeometry,
	trimHandles,
	type Box,
} from "./geometry.ts";
import {
	DEFAULT_COARSE_THRESHOLDS,
	defaultRecognizer,
	distanceAndHoldRecognizer,
	distanceOrHoldRecognizer,
	distanceRecognizer,
	observe,
	type GestureSample,
} from "./engagement.ts";

/* ---- Geometry ------------------------------------------------------------ */

describe("three boxes", () => {
	const viewport = { start: projectTime(0), scale: 0.01, widthPx: 800 };
	const options = DEFAULT_GEOMETRY_OPTIONS;

	function itemAt(
		startFrames: number,
		durationFrames: number,
		extra: Partial<TimelineItem> = {},
	): TimelineItem {
		return {
			id: `i${startFrames}`,
			kind: "clip",
			start: framesToProject(startFrames, BASE_30),
			duration: framesToProject(durationFrames, BASE_30),
			...extra,
		};
	}

	test("an item wider than the minimum keeps all three boxes equal", () => {
		const geometry = itemGeometry(itemAt(0, 60), viewport, [], options);
		expect(boxWidth(geometry.timeBox)).toBe(600);
		expect(geometry.padded).toBe(false);
		expect(geometry.hitPadded).toBe(false);
		expect(geometry.paintBox).toEqual(geometry.timeBox);
		expect(geometry.hitBox).toEqual(geometry.timeBox);
	});

	test("an item shorter than the interactive minimum grows only its hit box, and says it is padded", () => {
		/* One frame at this zoom is 10 device pixels — well under the 44px minimum. */
		const geometry = itemGeometry(itemAt(30, 1), viewport, [], options);
		expect(boxWidth(geometry.timeBox)).toBe(10);
		expect(boxWidth(geometry.hitBox)).toBe(options.minHitPx);
		/* The duration is unchanged. This is the honesty requirement: the hit box
		 * grew, the item did not become longer. */
		expect(boxWidth(geometry.timeBox)).toBe(10);
		/* And the discrepancy is reported: the touch target exceeds what is drawn,
		 * which is the fact the operator has to be able to see. The paint box is
		 * NOT padded here — ten pixels already exceeds the drawing minimum — which
		 * is why the two flags are separate. */
		expect(geometry.hitPadded).toBe(true);
		expect(geometry.padded).toBe(false);
		expect(boxWidth(geometry.paintBox)).toBe(10);
	});

	test("two adjacent items both expand, and neither crosses the shared edge", () => {
		const left = itemAt(0, 1);
		const right = itemAt(1, 1);
		const leftTime = itemGeometry(left, viewport, [], options).timeBox;
		const rightTime = itemGeometry(right, viewport, [], options).timeBox;

		const leftGeometry = itemGeometry(left, viewport, [rightTime], options);
		const rightGeometry = itemGeometry(right, viewport, [leftTime], options);

		/* The shared edge is at 10px. Neither hit box crosses it. */
		expect(leftGeometry.hitBox.rightPx).toBeLessThanOrEqual(10);
		expect(rightGeometry.hitBox.leftPx).toBeGreaterThanOrEqual(10);
		/* And each keeps a region that reaches only itself. */
		expect(boxWidth(leftGeometry.hitBox)).toBeGreaterThan(0);
		expect(boxWidth(rightGeometry.hitBox)).toBeGreaterThan(0);
		expect(leftGeometry.hitBox.rightPx).toBeLessThanOrEqual(rightGeometry.hitBox.leftPx);
	});

	test("a zero-duration item is defined rather than inverted", () => {
		const geometry = itemGeometry(itemAt(30, 0), viewport, [], options);
		expect(geometry.padded).toBe(true);
		expect(boxWidth(geometry.paintBox)).toBe(options.minPaintPx);
		expect(boxWidth(geometry.timeBox)).toBe(0);
		expect(geometry.timeBox.leftPx).toBe(geometry.timeBox.rightPx);
		expect(boxWidth(geometry.hitBox)).toBe(options.minHitPx);
	});

	test("a negative duration does not produce a box that paints backwards", () => {
		const geometry = itemGeometry(
			{ ...itemAt(30, 0), duration: projectTime(-5000) },
			viewport,
			[],
			options,
		);
		expect(geometry.timeBox.rightPx).toBeGreaterThanOrEqual(geometry.timeBox.leftPx);
		expect(boxWidth(geometry.timeBox)).toBe(0);
	});

	test("an item narrower than the viewport's own width is unaffected by the viewport being narrow", () => {
		const narrow = { start: projectTime(0), scale: 0.01, widthPx: 5 };
		const geometry = itemGeometry(itemAt(0, 60), narrow, [], options);
		/* Geometry answers about the item, not about what fits: clipping is the
		 * painter's job, and a geometry that clipped would make an item's reported
		 * position depend on the window size. */
		expect(boxWidth(geometry.timeBox)).toBe(600);
	});

	test("an item wedged between two close neighbours keeps its own extent and no more", () => {
		const middle = itemAt(30, 1);
		const neighbours: Box[] = [
			{ leftPx: 295, rightPx: 300 },
			{ leftPx: 310, rightPx: 315 },
		];
		const geometry = itemGeometry(middle, viewport, neighbours, options);
		expect(geometry.hitBox.leftPx).toBeGreaterThanOrEqual(300);
		expect(geometry.hitBox.rightPx).toBeLessThanOrEqual(310);
		expect(boxWidth(geometry.hitBox)).toBeGreaterThan(0);
	});
});

describe("capability is data, and a declined affordance has no element", () => {
	const viewport = { start: projectTime(0), scale: 0.01, widthPx: 800 };
	const row: Row = { id: "r", placement: "free", overlap: "permit" };

	function geometryFor(item: TimelineItem) {
		return itemGeometry(item, viewport, [], DEFAULT_GEOMETRY_OPTIONS);
	}

	const wide: TimelineItem = {
		id: "wide",
		kind: "clip",
		start: projectTime(0),
		duration: framesToProject(60, BASE_30),
		source: {
			timebase: BASE_30,
			inPoint: sourceTime(30_000),
			availableStart: sourceTime(0),
			availableEnd: sourceTime(600_000),
		},
	};

	test("a locked item declines every edit, keeps selection, and reports itself read-only", () => {
		const capabilities = itemCapabilities({ ...wide, locked: true }, geometryFor(wide), row);
		expect(capabilities).toEqual({
			select: true,
			move: false,
			trimStart: false,
			trimEnd: false,
			remove: false,
			readOnly: true,
		});
		expect(trimHandles(geometryFor(wide), capabilities)).toEqual({});
	});

	test("an item on a locked row is read-only too", () => {
		const capabilities = itemCapabilities(wide, geometryFor(wide), { ...row, locked: true });
		expect(capabilities.readOnly).toBe(true);
		expect(capabilities.select).toBe(true);
	});

	test("an item too narrow to hold body-plus-handles has no handle element at all", () => {
		const narrow: TimelineItem = { ...wide, id: "narrow", duration: framesToProject(1, BASE_30) };
		const geometry = geometryFor(narrow);
		const capabilities = itemCapabilities(narrow, geometry, row);
		expect(capabilities.trimStart).toBe(false);
		expect(capabilities.trimEnd).toBe(false);
		/* No element, rather than an element hidden by styling — a hidden handle
		 * keeps its hit area and takes the press meant for the body. */
		expect(trimHandles(geometry, capabilities)).toEqual({});
		/* And it is still movable by its body. */
		expect(capabilities.move).toBe(true);
	});

	test("an item at the start of its media declines the leading edge only", () => {
		const atStart: TimelineItem = { ...wide, source: { ...wide.source!, inPoint: sourceTime(0) } };
		const capabilities = itemCapabilities(atStart, geometryFor(atStart), row);
		expect(capabilities.trimStart).toBe(false);
		expect(capabilities.trimEnd).toBe(true);
		expect(trimHandles(geometryFor(atStart), capabilities).start).toBeUndefined();
		expect(trimHandles(geometryFor(atStart), capabilities).end).toBeDefined();
	});

	test("an item declining both edges gets neither handle, and a press at either edge reaches the body", () => {
		const exhausted: TimelineItem = {
			...wide,
			source: {
				timebase: BASE_30,
				inPoint: sourceTime(0),
				availableStart: sourceTime(0),
				availableEnd: framesToSource(60, BASE_30),
			},
		};
		const geometry = geometryFor(exhausted);
		const capabilities = itemCapabilities(exhausted, geometry, row);
		expect(capabilities.trimStart).toBe(false);
		expect(capabilities.trimEnd).toBe(false);
		expect(trimHandles(geometry, capabilities)).toEqual({});
	});

	test("handles are inset within the item's own bounds, never overhanging", () => {
		const geometry = geometryFor(wide);
		const handles = trimHandles(geometry, itemCapabilities(wide, geometry, row));
		expect(handles.start!.leftPx).toBeGreaterThanOrEqual(geometry.paintBox.leftPx);
		expect(handles.end!.rightPx).toBeLessThanOrEqual(geometry.paintBox.rightPx);
		expect(handles.start!.rightPx).toBeLessThanOrEqual(handles.end!.leftPx);
	});
});

/* ---- Gestures ------------------------------------------------------------ */

describe("engagement is injectable policy", () => {
	function samples(
		entries: ReadonlyArray<Partial<GestureSample> & { elapsedMs: number }>,
	): GestureSample[] {
		return entries.map((entry) => ({ coarse: true, ...entry }));
	}

	test("an AND recognizer rejects a fast flick", () => {
		const recognizer = distanceAndHoldRecognizer(DEFAULT_COARSE_THRESHOLDS);
		/* Crossed the distance well before the hold elapsed: a flick, which on a
		 * timeline means throw the view rather than move this clip by a frame. */
		const flick = observe(samples([{ elapsedMs: 20, distancePx: 60 }]));
		expect(recognizer(flick)).toBe(false);
		/* And the same distance, held, does engage. */
		expect(
			recognizer(
				observe(
					samples([
						{ elapsedMs: 20, distancePx: 60 },
						{ elapsedMs: 250, distancePx: 60 },
					]),
				),
			),
		).toBe(true);
	});

	test("an OR recognizer accepts the same flick", () => {
		const recognizer = distanceOrHoldRecognizer(DEFAULT_COARSE_THRESHOLDS);
		expect(recognizer(observe(samples([{ elapsedMs: 20, distancePx: 60 }])))).toBe(true);
		/* And a long press that has not moved. */
		expect(recognizer(observe(samples([{ elapsedMs: 400, distancePx: 0 }])))).toBe(true);
	});

	test("a press that wobbles below the threshold does not engage", () => {
		const recognizer = distanceAndHoldRecognizer(DEFAULT_COARSE_THRESHOLDS);
		expect(recognizer(observe(samples([{ elapsedMs: 300, distancePx: 3 }])))).toBe(false);
	});

	test("a sample carrying no pixel evidence contributes zero distance", () => {
		/* The rule that keeps engagement independent of zoom: without this, a
		 * distance inferred from elapsed time would engage at one magnification
		 * and not at another for the identical finger movement. */
		const observation = observe(samples([{ elapsedMs: 500 }, { elapsedMs: 900 }]));
		expect(observation.maxDistancePx).toBe(0);
		expect(distanceRecognizer({ distancePx: 1, holdMs: 0 })(observation)).toBe(false);
		expect(distanceAndHoldRecognizer(DEFAULT_COARSE_THRESHOLDS)(observation)).toBe(false);
	});

	test("the default is stricter on a coarse pointer than on a fine one", () => {
		const recognizer = defaultRecognizer();
		const flickCoarse = observe([{ elapsedMs: 20, distancePx: 30, coarse: true }]);
		const flickFine = observe([{ elapsedMs: 20, distancePx: 30, coarse: false }]);
		expect(recognizer(flickCoarse)).toBe(false);
		expect(recognizer(flickFine)).toBe(true);
	});

	test("an observation reports the largest distance seen, not the latest", () => {
		/* A finger that moves out and comes back has still moved. */
		const observation = observe(
			samples([
				{ elapsedMs: 100, distancePx: 40 },
				{ elapsedMs: 200, distancePx: 2 },
			]),
		);
		expect(observation.maxDistancePx).toBe(40);
		expect(observation.elapsedMs).toBe(200);
	});
});
