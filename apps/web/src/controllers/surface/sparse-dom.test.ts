/* Split from services/paint/paint.test.ts when the DOM layer moved into the web
 * app: virtualization is a controller, and a services test may not import one. */
import { describe, expect, test } from "vite-plus/test";
import { framesToProject } from "@models/timeline-view/tick.ts";
import { resolveViewport } from "@models/timeline-view/viewport.ts";
import { type ItemId, type TimelineItem, type TimelineState } from "@models/timeline-view/types.ts";
import { magneticSingleRow, BASE_30 } from "@models/timeline-view/fixtures.ts";
import { createOverlay } from "./sparse-dom.ts";
import { sceneOptions, largeTimeline } from "@services/paint/paint-fixtures.ts";
import { createItemIndex, visibleScenery } from "@services/paint/scene.ts";

/* ---- 7.4 Virtualization ---------------------------------------------------- */

describe("virtualization", () => {
	test("two thousand items with fifty visible mount a node count proportional to the visible set", () => {
		const state = largeTimeline(2000, 1500);
		const index = createItemIndex(state);
		const visible = index.inRange(state.viewport.start.ticks, state.viewport.end.ticks);
		const overlay = createOverlay<{ id: ItemId }>({ create: (id) => ({ id }) });
		overlay.sync(visible);

		expect(index.size).toBe(2000);
		expect(visible.length).toBeLessThan(60);
		expect(overlay.size()).toBe(visible.length);
		/* The claim is the ratio, not the number: the mounted count is within a
		 * small factor of what is on screen and nowhere near the document. */
		expect(overlay.size()).toBeLessThanOrEqual(visible.length * 3);
		expect(overlay.size()).toBeLessThan(state.items.size / 20);
	});

	test("the same visible count costs the same work whether the document is small or large", () => {
		const small = largeTimeline(100);
		const large = largeTimeline(5000);
		const visibleIn = (state: TimelineState) =>
			createItemIndex(state).inRange(state.viewport.start.ticks, state.viewport.end.ticks).length;
		/* Same viewport, same magnification: the answer is the visible range, and
		 * the document's size does not enter into it. */
		expect(visibleIn(large)).toBe(visibleIn(small));
	});

	test("scrolling releases what left the range and creates what entered, and no cost accumulates", () => {
		const state = largeTimeline(2000, 800);
		const index = createItemIndex(state);
		const created: ItemId[] = [];
		const released: ItemId[] = [];
		const overlay = createOverlay<{ id: ItemId }>({
			create: (id) => {
				created.push(id);
				return { id };
			},
			release: (id) => released.push(id),
		});

		const spanTicks = state.viewport.end.ticks - state.viewport.start.ticks;
		const sizes: number[] = [];
		for (let step = 0; step < 10; step += 1) {
			const start = step * spanTicks;
			overlay.sync(index.inRange(start, start + spanTicks));
			sizes.push(overlay.size());
		}

		/* Ten screens travelled, and the mounted count at the last is the count at
		 * the first: nothing accumulated with distance scrolled. It varies by one
		 * with how the range falls across an item boundary, and by no more. */
		expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
		expect(sizes[sizes.length - 1]).toBeLessThanOrEqual(sizes[0]! + 1);
		expect(released.length).toBeGreaterThan(0);
		expect(created.length - released.length).toBe(overlay.size());
	});

	test("a retained item keeps its element although it left the visible range", () => {
		const state = largeTimeline(200);
		const index = createItemIndex(state);
		const released: ItemId[] = [];
		const overlay = createOverlay<{ id: ItemId }>({
			create: (id) => ({ id }),
			release: (id) => released.push(id),
			/* What a focused item looks like to the overlay: a thing that must not
			 * vanish from under the keyboard mid-edit. */
			retain: (id) => id === "item-0",
		});

		overlay.sync(index.inRange(0, state.viewport.end.ticks));
		const span = state.viewport.end.ticks - state.viewport.start.ticks;
		overlay.sync(index.inRange(span * 4, span * 5));

		expect(released).not.toContain("item-0");
		expect(overlay.nodes().some((node) => node.id === "item-0")).toBe(true);
	});

	test("dispose releases every mounted element", () => {
		const overlay = createOverlay<{ id: ItemId }>({ create: (id) => ({ id }) });
		overlay.sync(["a", "b", "c"]);
		overlay.dispose();
		expect(overlay.size()).toBe(0);
	});

	test("the painted scene holds only the visible items", () => {
		const state = largeTimeline(2000, 800);
		const scenery = visibleScenery(state, sceneOptions(state));
		expect(scenery.length).toBeLessThan(40);
		for (const entry of scenery) {
			expect(entry.geometry.timeBox.rightPx).toBeGreaterThanOrEqual(0);
			expect(entry.geometry.timeBox.leftPx).toBeLessThanOrEqual(state.viewport.widthPx);
		}
	});

	test("an item longer than the viewport is still found when it spans it", () => {
		const base = magneticSingleRow();
		const long: TimelineItem = {
			id: "long",
			kind: "bed",
			start: framesToProject(0, BASE_30),
			duration: framesToProject(10_000, BASE_30),
		};
		const state: TimelineState = {
			...base,
			items: new Map([["long", long]]),
			order: ["long"],
			duration: framesToProject(10_000, BASE_30),
			viewport: resolveViewport({
				start: framesToProject(5000, BASE_30),
				scale: 0.01,
				widthPx: 800,
			}),
		};
		/* The bound that makes the index correct rather than merely fast: an item
		 * starting long before the viewport still overlaps it. */
		expect(
			createItemIndex(state).inRange(state.viewport.start.ticks, state.viewport.end.ticks),
		).toEqual(["long"]);
	});
});
