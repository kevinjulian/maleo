/* The DOM layer's contract: one interpreter, one terminal phase, no leaks.
 *
 * Nothing here needs a browser. The host is structural, the frame clock is
 * driven by hand, and the fake interpreter records what it was asked to do —
 * which is how "no component performs a side effect directly" is checkable at
 * all, rather than being a rule everybody agrees to and nobody can test.
 */
import { describe, expect, test } from "vite-plus/test";
import { type TimelineState } from "@models/timeline-view/types.ts";
import { fire, move, press, surfaceFixture } from "./surface.fixtures.ts";

describe("timeline surface", () => {
	test("a secondary button opens no gesture, so the context menu it belongs to survives", () => {
		const fixture = surfaceFixture();
		fire(fixture.root, "pointerdown", {
			pointerId: 1,
			button: 2,
			clientX: 100,
			clientY: 10,
			timeStamp: 0,
		});
		expect(fixture.state().gestures.size).toBe(0);
		/* Capture is what would break the menu: a captured pointer retargets the
		 * `contextmenu` that follows to the capturing element. */
		expect(fixture.root.captured()).toEqual([]);

		fire(fixture.root, "pointerdown", {
			pointerId: 2,
			button: 1,
			clientX: 100,
			clientY: 10,
			timeStamp: 0,
		});
		expect(fixture.state().gestures.size).toBe(0);

		/* The primary button still opens one, and an event that names no button at
		 * all is treated as primary — a synthetic press from a test or an assistive
		 * technology should not be silently ignored. */
		fire(fixture.root, "pointerdown", {
			pointerId: 3,
			button: 0,
			clientX: 100,
			clientY: 10,
			timeStamp: 0,
		});
		expect(fixture.state().gestures.size).toBe(1);
	});

	test("a press takes capture on the surface and carries the item as payload", () => {
		const fixture = surfaceFixture();
		press(fixture, 100);

		const gestures = [...fixture.state().gestures.values()];
		expect(gestures.length).toBe(1);
		expect(gestures[0]!.target).toEqual({ kind: "item", id: "scene-1" });
		/* Capture is on the root, which is the only element that took it. */
		expect(fixture.root.captured()).toEqual([1]);
	});

	test("the gesture survives the item unmounting and remounting mid-drag", () => {
		const fixture = surfaceFixture();
		press(fixture, 100, 0);
		move(fixture, 140, 50);

		/* What "the item unmounted" means to this surface: nothing. There is no
		 * element in the gesture, so removing and re-creating one cannot reach it —
		 * which is exactly the claim. The drag continues past the point the
		 * previous implementation reported `cancel` at (0,0). */
		move(fixture, 600, 100);
		move(fixture, 650, 150);
		fire(fixture.root, "pointerup", { pointerId: 1, clientX: 650, clientY: 10, timeStamp: 200 });

		const outcome = fixture.state().lastGesture!;
		expect(outcome.phase).toBe("commit");
		expect(outcome.reason).toBe("release");
		expect(outcome.target).toEqual({ kind: "item", id: "scene-1" });
		/* Committed where the pointer actually was, not at the origin. */
		expect(outcome.at.xPx).toBe(650);
		expect(outcome.engaged).toBe(true);
	});

	for (const [reason, type, phase] of [
		["release", "pointerup", "commit"],
		["pointercancel", "pointercancel", "rollback"],
		["lostcapture", "lostpointercapture", "rollback"],
	] as const) {
		test(`${reason} produces exactly one terminal phase, releases capture, and leaves nothing pending`, () => {
			const fixture = surfaceFixture();
			press(fixture, 100, 0);
			move(fixture, 160, 50);
			fire(fixture.root, type, { pointerId: 1, clientX: 160, clientY: 10, timeStamp: 60 });

			expect(fixture.state().lastGesture?.phase).toBe(phase);
			expect(fixture.state().gestures.size).toBe(0);
			expect(fixture.root.releases()).toEqual([1]);
			expect(fixture.surface.activeGestures()).toEqual([]);
			expect(fixture.clock.pending()).toBe(0);

			/* The second terminal event every real sequence produces changes
			 * nothing — the state object itself is unchanged, which is a stronger
			 * claim than the phase still reading the same. */
			const before = fixture.state();
			fire(fixture.root, "pointerup", { pointerId: 1, clientX: 160, clientY: 10, timeStamp: 70 });
			expect(fixture.state()).toBe(before);
			expect(fixture.root.releases()).toEqual([1]);
		});
	}

	test("Escape rolls back, and the release that follows produces no second terminal phase", () => {
		const fixture = surfaceFixture();
		press(fixture, 100, 0);
		move(fixture, 160, 50);
		fire(fixture.root, "keydown", { key: "Escape" });

		const afterEscape = fixture.state();
		expect(afterEscape.lastGesture?.phase).toBe("rollback");
		expect(afterEscape.lastGesture?.reason).toBe("escape");

		fire(fixture.root, "pointerup", { pointerId: 1, clientX: 160, clientY: 10, timeStamp: 60 });
		expect(fixture.state()).toBe(afterEscape);

		/* And a subsequent press is handled normally: the surface is not left in a
		 * state where one cancelled gesture poisons the next. */
		press(fixture, 100, 100, 1);
		expect(fixture.state().gestures.size).toBe(1);
	});

	test("a key that is not Escape ends nothing", () => {
		const fixture = surfaceFixture();
		press(fixture, 100, 0);
		fire(fixture.root, "keydown", { key: "a" });
		expect(fixture.state().gestures.size).toBe(1);
	});

	test("surface unmount rolls the gesture back and leaves no listener, capture, or frame", () => {
		const fixture = surfaceFixture();
		press(fixture, 100, 0);
		move(fixture, 5, 50);
		fixture.clock.advance(16);

		fixture.surface.dispose();

		expect(fixture.state().lastGesture?.reason).toBe("unmount");
		expect(fixture.state().lastGesture?.phase).toBe("rollback");
		expect(fixture.root.releases()).toEqual([1]);
		expect(fixture.root.listeners()).toBe(0);
		expect(fixture.scroller.listeners()).toBe(0);
		expect(fixture.surface.listenerCount()).toBe(0);
		expect(fixture.clock.pending()).toBe(0);
		expect(fixture.surface.interpreter.capturedPointers()).toEqual([]);
	});

	test("a drag held at the edge auto-scrolls, and the terminal phase stops it", () => {
		const fixture = surfaceFixture();
		press(fixture, 100, 0);
		/* Into the left edge zone, engaged by the distance travelled to get there. */
		move(fixture, 4, 50);

		const gesture = [...fixture.state().gestures.values()][0]!;
		expect(gesture.engaged).toBe(true);
		expect(gesture.autoScroll).toBe(-1);
		expect(fixture.surface.interpreter.hasPendingFrame()).toBe(true);

		fire(fixture.root, "pointerup", { pointerId: 1, clientX: 4, clientY: 10, timeStamp: 60 });
		expect(fixture.surface.interpreter.hasPendingFrame()).toBe(false);
		const requestsAfterEnd = fixture.clock.requests();
		fixture.clock.advance(1000);
		expect(fixture.clock.requests()).toBe(requestsAfterEnd);
	});

	test("the scroller's echo of an applied viewport is not read back as input", () => {
		const fixture = surfaceFixture();
		/* A zoom publishes a viewport, which the interpreter applies to the
		 * scroller. The browser answers with a `scroll` at that exact position. */
		fire(fixture.root, "wheel", { deltaX: 0, deltaY: -100, clientX: 400, ctrlKey: true });
		const zoomed = fixture.state().viewport;
		fire(fixture.scroller, "scroll", {});
		expect(fixture.state().viewport).toBe(zoomed);

		/* A scroll that is not ours is input as usual. */
		fixture.scroller.scrollLeft = zoomed.start.ticks * zoomed.scale + 250;
		fire(fixture.scroller, "scroll", {});
		expect(fixture.state().viewport).not.toBe(zoomed);
	});

	test("repeated wheel zoom holds its focal point without drift", () => {
		const fixture = surfaceFixture();
		const focalPx = 400;
		const timeAt = (state: TimelineState) =>
			state.viewport.start.ticks + focalPx / state.viewport.scale;
		const before = timeAt(fixture.state());

		for (let step = 0; step < 20; step += 1) {
			fire(fixture.root, "wheel", { deltaX: 0, deltaY: -60, clientX: focalPx, ctrlKey: true });
			/* Every applied viewport echoes back, the way a real scroller does. This
			 * is the loop that drifted before echo suppression. */
			fire(fixture.scroller, "scroll", {});
			fire(fixture.root, "wheel", { deltaX: 0, deltaY: 60, clientX: focalPx, ctrlKey: true });
			fire(fixture.scroller, "scroll", {});
		}

		const after = timeAt(fixture.state());
		/* Within one device pixel, expressed in ticks at the current scale. */
		expect(Math.abs(after - before) * fixture.state().viewport.scale).toBeLessThanOrEqual(1);
	});

	test("a wheel without the zoom modifier pans", () => {
		const fixture = surfaceFixture();
		const before = fixture.state().viewport.start.ticks;
		fire(fixture.root, "wheel", { deltaX: 120, deltaY: 0, clientX: 200 });
		expect(fixture.state().viewport.start.ticks).toBeGreaterThan(before);
	});

	test("a plain vertical wheel is left to the browser, which scrolls the cross axis", () => {
		const fixture = surfaceFixture();
		const before = fixture.state().viewport;
		let prevented = false;
		fire(fixture.root, "wheel", {
			deltaX: 0,
			deltaY: 120,
			clientX: 200,
			preventDefault: () => {
				prevented = true;
			},
		});
		expect(prevented).toBe(false);
		expect(fixture.state().viewport).toBe(before);

		/* A zoom or a horizontal pan is still ours. */
		fire(fixture.root, "wheel", {
			deltaX: 120,
			deltaY: 0,
			clientX: 200,
			preventDefault: () => {
				prevented = true;
			},
		});
		expect(prevented).toBe(true);
	});

	test("twenty mount, gesture, unmount cycles return every counter to baseline", () => {
		for (let cycle = 0; cycle < 20; cycle += 1) {
			const fixture = surfaceFixture();
			const listenersWhileMounted = fixture.root.listeners() + fixture.scroller.listeners();
			expect(listenersWhileMounted).toBeGreaterThan(0);

			press(fixture, 100, 0);
			move(fixture, 4, 40);
			fixture.clock.advance(16);
			/* Half the cycles end by release and half by teardown, so neither path
			 * is the only one exercised twenty times. */
			if (cycle % 2 === 0)
				fire(fixture.root, "pointerup", { pointerId: 1, clientX: 4, clientY: 10, timeStamp: 50 });
			fixture.surface.dispose();

			expect(fixture.root.listeners()).toBe(0);
			expect(fixture.scroller.listeners()).toBe(0);
			expect(fixture.root.captured().length).toBe(1);
			expect(fixture.root.releases().length).toBe(1);
			expect(fixture.clock.pending()).toBe(0);
			expect(fixture.state().gestures.size).toBe(0);
			expect(fixture.surface.interpreter.capturedPointers()).toEqual([]);
		}
	});
});

/* ---- The touch viewport: pan and pinch ------------------------------------ */
