/* The DOM layer's contract: one interpreter, one terminal phase, no leaks.
 *
 * Nothing here needs a browser. The host is structural, the frame clock is
 * driven by hand, and the fake interpreter records what it was asked to do —
 * which is how "no component performs a side effect directly" is checkable at
 * all, rather than being a rule everybody agrees to and nobody can test.
 */
import { describe, expect, test } from "vite-plus/test";
import { createStore } from "@models/timeline-view/store.ts";
/* Straight from the fixture module, not the entry point: the fixtures are
 * test-facing and exporting them would put three fake timelines in the public
 * API. `tests/public-api` fails if that ever changes. */
import { magneticSingleRow } from "@models/timeline-view/fixtures.ts";
import { createTimelineSurface } from "./surface.ts";
import {
	type SurfaceFixture,
	fakeRoot,
	fakeScroller,
	fire,
	manualClock,
} from "./surface.fixtures.ts";

function touchSurfaceFixture(touchViewport: { pan?: boolean; pinch?: boolean }): SurfaceFixture {
	const root = fakeRoot();
	const scroller = fakeScroller();
	const clock = manualClock();
	const store = createStore(magneticSingleRow());
	const surface = createTimelineSurface({
		root,
		store,
		scroller,
		clock,
		touchViewport,
		/* The left half is an item; the right half is bare surface the hit test
		 * DECLINES, which is the half a finger pans. */
		hitTest: (point) => (point.xPx < 400 ? { kind: "item", id: "scene-1" } : undefined),
	});
	return { root, scroller, clock, store, surface, state: () => store.getState() };
}

function touch(
	fixture: SurfaceFixture,
	type: "pointerdown" | "pointermove" | "pointerup",
	pointerId: number,
	xPx: number,
	yPx = 10,
): void {
	fire(fixture.root, type, {
		pointerId,
		pointerType: "touch",
		clientX: xPx,
		clientY: yPx,
		timeStamp: 0,
	});
}

describe("touch viewport", () => {
	test("a finger on a declined press pans the view, and the view moves opposite to the finger", () => {
		const fixture = touchSurfaceFixture({ pan: true });
		const before = fixture.state().viewport.start.ticks;
		touch(fixture, "pointerdown", 7, 600);
		touch(fixture, "pointermove", 7, 500);
		/* The finger went left, so the content went left, so the view went right. */
		expect(fixture.state().viewport.start.ticks).toBeGreaterThan(before);
		const middle = fixture.state().viewport.start.ticks;
		touch(fixture, "pointermove", 7, 620);
		expect(fixture.state().viewport.start.ticks).toBeLessThan(middle);
	});

	test("panning is off by default, so a consumer whose browser scrolls natively is not moved twice", () => {
		const fixture = touchSurfaceFixture({});
		const before = fixture.state().viewport.start.ticks;
		touch(fixture, "pointerdown", 7, 600);
		touch(fixture, "pointermove", 7, 400);
		expect(fixture.state().viewport.start.ticks).toBe(before);
	});

	test("a mouse never pans, however far it is dragged over declined surface", () => {
		const fixture = touchSurfaceFixture({ pan: true });
		const before = fixture.state().viewport.start.ticks;
		fire(fixture.root, "pointerdown", {
			pointerId: 3,
			pointerType: "mouse",
			clientX: 600,
			clientY: 10,
			timeStamp: 0,
		});
		fire(fixture.root, "pointermove", {
			pointerId: 3,
			pointerType: "mouse",
			clientX: 400,
			clientY: 10,
			timeStamp: 8,
		});
		expect(fixture.state().viewport.start.ticks).toBe(before);
	});

	test("two fingers spreading magnify, and pinching together reduce", () => {
		const fixture = touchSurfaceFixture({ pinch: true });
		const before = fixture.state().viewport.scale;
		touch(fixture, "pointerdown", 11, 500);
		touch(fixture, "pointerdown", 12, 600);
		/* The baseline was taken when the second finger landed, so a sample that
		 * moves nothing changes nothing, and the very first real one magnifies. */
		touch(fixture, "pointermove", 12, 600);
		expect(fixture.state().viewport.scale).toBe(before);
		touch(fixture, "pointermove", 12, 700);
		const spread = fixture.state().viewport.scale;
		expect(spread).toBeGreaterThan(before);
		touch(fixture, "pointermove", 12, 550);
		expect(fixture.state().viewport.scale).toBeLessThan(spread);
	});

	test("a second finger zooms rather than pans, and lifting it does not pan by the gap", () => {
		const fixture = touchSurfaceFixture({ pan: true, pinch: true });
		touch(fixture, "pointerdown", 11, 500);
		touch(fixture, "pointerdown", 12, 600);
		touch(fixture, "pointermove", 12, 620);
		const scaled = fixture.state().viewport.scale;
		touch(fixture, "pointermove", 12, 700);
		expect(fixture.state().viewport.scale).toBeGreaterThan(scaled);

		touch(fixture, "pointerup", 12, 700);
		const afterLift = fixture.state().viewport.start.ticks;
		/* The remaining finger re-reads its own position before it pans, so the
		 * distance the other finger travelled is not applied to it in one jump. */
		touch(fixture, "pointermove", 11, 500);
		expect(fixture.state().viewport.start.ticks).toBe(afterLift);
	});

	test("the pinch anchor is where the fingers started, so the time under it does not slide", () => {
		const fixture = touchSurfaceFixture({ pinch: true });
		const scale = () => fixture.state().viewport.scale;
		const startTicks = () => fixture.state().viewport.start.ticks;
		/* The time under the anchor: the midpoint of the two presses, 550. */
		const anchorPx = 550;
		const timeUnderAnchor = (): number => startTicks() + anchorPx / scale();
		touch(fixture, "pointerdown", 11, 500);
		touch(fixture, "pointerdown", 12, 600);
		const before = timeUnderAnchor();
		/* One finger travels, so the midpoint MOVES. A pinch anchored to the live
		 * midpoint would drag the whole timeline along with it. */
		touch(fixture, "pointermove", 12, 700);
		touch(fixture, "pointermove", 12, 900);
		expect(scale()).toBeGreaterThan(0);
		expect(Math.abs(timeUnderAnchor() - before) / before).toBeLessThan(0.01);
	});

	test("a finger the consumer claims for itself pans nothing", () => {
		const root = fakeRoot();
		const store = createStore(magneticSingleRow());
		const surface = createTimelineSurface({
			root,
			store,
			clock: manualClock(),
			/* Everything above y=28 is the consumer's ruler, which scrubs. Declining
			 * it in the hit test is not enough: "no item here" does not mean "the
			 * view may have this finger". */
			touchViewport: { pan: true, pans: (event) => event.clientY > 28 },
			hitTest: () => undefined,
		});
		const before = store.getState().viewport.start.ticks;
		fire(root, "pointerdown", {
			pointerId: 9,
			pointerType: "touch",
			clientX: 600,
			clientY: 8,
			timeStamp: 0,
		});
		fire(root, "pointermove", {
			pointerId: 9,
			pointerType: "touch",
			clientX: 400,
			clientY: 8,
			timeStamp: 8,
		});
		expect(store.getState().viewport.start.ticks).toBe(before);
		fire(root, "pointerup", {
			pointerId: 9,
			pointerType: "touch",
			clientX: 400,
			clientY: 8,
			timeStamp: 12,
		});
		/* And a finger below it still pans, so the predicate is not simply off. */
		fire(root, "pointerdown", {
			pointerId: 10,
			pointerType: "touch",
			clientX: 600,
			clientY: 60,
			timeStamp: 0,
		});
		fire(root, "pointermove", {
			pointerId: 10,
			pointerType: "touch",
			clientX: 400,
			clientY: 60,
			timeStamp: 8,
		});
		expect(store.getState().viewport.start.ticks).toBeGreaterThan(before);
		surface.dispose();
	});

	test("a touch the surface tracked leaves nothing behind after dispose", () => {
		const fixture = touchSurfaceFixture({ pan: true, pinch: true });
		touch(fixture, "pointerdown", 11, 500);
		fixture.surface.dispose();
		expect(fixture.root.listeners()).toBe(0);
		expect(fixture.state().gestures.size).toBe(0);
	});
});
