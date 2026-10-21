/* The published performance budget, measured here.
 *
 * On a synthetic three-row timeline rather than on the running editor,
 * deliberately: the editor's numbers include its own chrome, its own document,
 * and its own React tree. A budget measured there would move for reasons that
 * have nothing to do with the surface, and would then be either muted or wrong.
 * Published in docs/editor-surface-budget.md; moved from @maleo/vui's
 * multi-row example with the DOM layer.
 *
 * Every entry is classified, and the classification is the point:
 *
 *   - INVARIANT — asserted exactly, no tolerance, no hardware dependence.
 *     "Mounting one item per visible item" is true on any machine or it is a
 *     bug. These catch regressions; they need no measurement to write.
 *   - BOUND — asserted with a ceiling, qualified by the hardware and item count
 *     it was measured on. Set far enough above the median to catch a regression
 *     in KIND rather than in noise.
 *   - REPORTED — recorded, never asserted. A threshold on a number that moves
 *     with hardware and CI load becomes a muted test within a week.
 *
 * Run: `bun apps/web/src/controllers/surface/surface-budget.bench.ts`.
 */
import { testEngine } from "@models/editor-engine/engine-fixture.ts";
import { openPolicyGesture } from "@models/editor-engine/policy-gesture.ts";
import { resolveViewport } from "@models/timeline-view/viewport.ts";
import { createStore } from "@models/timeline-view/store.ts";
import { framesToProject, projectTime } from "@models/timeline-view/tick.ts";
import { type TimelineItem, type TimelineState } from "@models/timeline-view/types.ts";
import { rational } from "@models/timeline-view/rational.ts";
import { timebase } from "@models/timeline-view/timebase.ts";
import { createGeometryQuery } from "./query.ts";

/** The measured timeline's timebase. */
const BASE = timebase(rational(30, 1));

/** Rows of three different heights. */
const ROW_METRICS = [
	{ id: "video", heightPx: 64 },
	{ id: "overlay", heightPx: 28 },
	{ id: "audio", heightPx: 48 },
];

/** How many items the numbers below were measured at. */
const ITEM_COUNT = 2000;
/** How wide the viewport is, in device pixels. */
const VIEWPORT_WIDTH_PX = 1440;
/** Ticks per device pixel at the measured zoom. */
const SCALE = 0.0006;

function crowdedState(itemCount: number): TimelineState {
	const items: TimelineItem[] = [];
	for (let index = 0; index < itemCount; index += 1) {
		const row = ROW_METRICS[index % ROW_METRICS.length]!;
		items.push({
			id: `item-${index}`,
			rowId: row.id,
			kind: row.id,
			label: `Item ${index}`,
			start: framesToProject(index * 15, BASE),
			duration: framesToProject(14, BASE),
		});
	}
	return {
		timebase: BASE,
		duration: framesToProject(itemCount * 15 + 14, BASE),
		rows: ROW_METRICS.map((metric) => ({
			id: metric.id,
			placement: "free" as const,
			overlap: "permit" as const,
		})),
		items: new Map(items.map((item) => [item.id, item])),
		order: items.map((item) => item.id),
		markers: [],
		selection: new Set(),
		/* Resolved rather than written: `end` is derived from start, scale and
		 * width, and a hand-written one that said "the whole project" would make
		 * every item visible and quietly measure nothing. */
		viewport: resolveViewport({ start: projectTime(0), scale: SCALE, widthPx: VIEWPORT_WIDTH_PX }),
		gestures: new Map(),
	};
}

/** The median of `runs` timings, in milliseconds. The median, not the mean: one
 *  scheduling hiccup should not become the number everybody quotes. */
function medianMs(runs: number, body: () => void): number {
	const samples: number[] = [];
	for (let run = 0; run < runs; run += 1) {
		const started = performance.now();
		body();
		samples.push(performance.now() - started);
	}
	samples.sort((left, right) => left - right);
	return samples[Math.floor(samples.length / 2)]!;
}

function fail(message: string): never {
	throw new Error(`surface budget: ${message}`);
}

const rows = {
	offsetOf: (rowId?: string) => {
		let cursor = 0;
		for (const metric of ROW_METRICS) {
			if (metric.id === rowId) return cursor;
			cursor += metric.heightPx;
		}
		return 0;
	},
	heightOf: (rowId?: string) => ROW_METRICS.find((metric) => metric.id === rowId)?.heightPx ?? 0,
};

const store = createStore(crowdedState(ITEM_COUNT));
const query = createGeometryQuery({ state: () => store.getState(), rows, rulerHeightPx: 28 });

/* ---- INVARIANT: what is mounted follows what is visible ------------------- */

const visible = query.visibleCount();
if (visible >= ITEM_COUNT)
	fail(`every item is visible at ${VIEWPORT_WIDTH_PX}px; the fixture does not exercise the bound`);
/* Exact, not a ceiling: the visible set is what a host mounts, and "one element
 * per visible item" is either true or the virtualization is broken. */
if (query.visibleItems().length !== visible) fail("visibleItems and visibleCount disagree");

/* ---- INVARIANT: scrolling changes the visible set, not its size ----------- */

const before = query.visibleCount();
store.dispatch({ type: "scroll", leftPx: 4000 });
const after = query.visibleCount();
const movedIds = new Set(query.visibleItems());
store.dispatch({ type: "scroll", leftPx: 0 });
if (Math.abs(after - before) > 1)
	fail(`a scroll changed the visible COUNT from ${before} to ${after}`);
if ([...movedIds].every((id) => query.visibleItems().includes(id)))
	fail("a 4000px scroll did not change which items are visible");

/* ---- INVARIANT: an unrelated slice change notifies nobody ----------------- */

const selection = store.slice((state) => state.selection);
let notifications = 0;
const stop = selection.subscribe(() => {
	notifications += 1;
});
store.dispatch({ type: "scroll", leftPx: 240 });
store.dispatch({ type: "scroll", leftPx: 0 });
if (notifications !== 0) fail(`a scroll notified the selection slice ${notifications} time(s)`);
stop();

/* ---- BOUND: the cost of one gesture sample ------------------------------- */

const sampleMs = medianMs(200, () => {
	store.dispatch({ type: "scroll", leftPx: Math.random() * 20_000 });
	query.visibleItems();
});

/* ---- BOUND: the cost of one committed trim ------------------------------- */

/* Through the engine's edit policies, as the editor runs one (task 4.10).
 * Opening a gesture is where the base state crosses into the engine, once per
 * gesture; it is reported, and the sample-and-commit is the bound. */
const openSamples: number[] = [];
const commitSamples: number[] = [];
for (let run = 0; run < 200; run += 1) {
	const opened = performance.now();
	const gesture = openPolicyGesture(
		testEngine,
		"bench",
		store.getState(),
		{ policy: "trim", id: "item-10", edge: "end", kind: "trim" },
		undefined,
	);
	const started = performance.now();
	gesture.update({ deltaTicks: -300 });
	const ended = gesture.commit();
	commitSamples.push(performance.now() - started);
	openSamples.push(started - opened);
	if (!ended.ok) fail(`the bench trim was refused: ${ended.rejection}`);
}
const median = (samples: number[]): number =>
	[...samples].sort((left, right) => left - right)[samples.length >> 1]!;
const commitMs = median(commitSamples);
const openMs = median(openSamples);

/* ---- REPORTED: building the whole query index ---------------------------- */

const indexMs = medianMs(20, () => {
	createGeometryQuery({ state: () => store.getState(), rows, rulerHeightPx: 28 }).visibleItems();
});

/* The two bounds are asserted here so a regression in KIND fails the run. The
 * ceilings sit an order of magnitude above the medians measured on the hardware
 * named in the README, which is what keeps them out of the noise. */
if (sampleMs > 2) fail(`a viewport sample took ${sampleMs.toFixed(3)}ms, over the 2ms ceiling`);
if (commitMs > 2) fail(`a committed trim took ${commitMs.toFixed(3)}ms, over the 2ms ceiling`);

console.log(
	JSON.stringify(
		{
			itemCount: ITEM_COUNT,
			viewportWidthPx: VIEWPORT_WIDTH_PX,
			invariant: { visibleItems: visible, mountedPerVisible: 1, unrelatedSliceNotifications: 0 },
			bound: {
				viewportSampleMs: Number(sampleMs.toFixed(3)),
				committedTrimMs: Number(commitMs.toFixed(3)),
			},
			reported: {
				queryIndexBuildMs: Number(indexMs.toFixed(3)),
				gestureOpenMs: Number(openMs.toFixed(3)),
			},
		},
		null,
		2,
	),
);
console.log(
	`surface budget: ${visible} of ${ITEM_COUNT} items visible at ${VIEWPORT_WIDTH_PX}px; bounds hold`,
);
