/* The DOM layer's contract: one interpreter, one terminal phase, no leaks.
 *
 * Nothing here needs a browser. The host is structural, the frame clock is
 * driven by hand, and the fake interpreter records what it was asked to do —
 * which is how "no component performs a side effect directly" is checkable at
 * all, rather than being a rule everybody agrees to and nobody can test.
 */
import { describe, expect, test } from "vite-plus/test";
import { type TimelineEvent } from "@models/timeline-view/events.ts";
import { createEffectInterpreter, type InterpreterHost } from "./interpreter.ts";
import { createScrollWriter } from "./scroll-writer.ts";
import {
	fire,
	hostFixture,
	manualClock,
	move,
	press,
	recordingInterpreter,
	surfaceFixture,
} from "./surface.fixtures.ts";

describe("effect interpreter", () => {
	test("performs every effect variant, and only through the host", () => {
		const clock = manualClock();
		const dispatched: TimelineEvent[] = [];
		const fixture = hostFixture(clock, dispatched);
		const interpreter = createEffectInterpreter(fixture.host);

		interpreter.perform([
			{ type: "capturePointer", pointerId: 7 },
			{ type: "scrollTo", leftPx: 120 },
			{ type: "focus", target: { kind: "item", id: "scene-1" } },
			{ type: "announce", message: "Scene 2 moved to 00:00:03:00" },
			{
				type: "invalidateRegion",
				region: { xPx: 10, yPx: 0, widthPx: 40, heightPx: 40 },
				items: ["scene-1"],
			},
		]);

		expect(fixture.surface.captured()).toEqual([7]);
		expect(fixture.scroller.scrollLeft).toBe(120);
		expect(fixture.focused).toEqual([{ kind: "item", id: "scene-1" }]);
		expect(fixture.liveRegion.textContent).toBe("Scene 2 moved to 00:00:03:00");
		expect(fixture.painted).toEqual([{ xPx: 10, widthPx: 40 }]);
		expect(interpreter.capturedPointers()).toEqual([7]);

		interpreter.perform([{ type: "releasePointer", pointerId: 7 }]);
		expect(fixture.surface.releases()).toEqual([7]);
		expect(interpreter.capturedPointers()).toEqual([]);
	});

	test("with the interpreter replaced, a whole gesture reaches the host through nothing else", () => {
		const fixture = surfaceFixture();
		const fake = recordingInterpreter();
		/* Swap the sink out from under a live surface: whatever still happens to
		 * the host after this came from something performing a side effect
		 * directly, which is the thing being ruled out. */
		fixture.store.setEffectSink((effects) => {
			fake.perform(effects);
		});

		press(fixture, 100, 0);
		move(fixture, 4, 40);
		fire(fixture.root, "pointerup", { pointerId: 1, clientX: 4, clientY: 10, timeStamp: 50 });

		expect(fake.effects().map((effect) => effect.type)).toEqual([
			"capturePointer",
			"startAutoScroll",
			"releasePointer",
			"stopAutoScroll",
		]);
		expect(fixture.root.captured()).toEqual([]);
		expect(fixture.root.releases()).toEqual([]);
		expect(fixture.scroller.scrollLeft).toBe(0);
		expect(fixture.clock.pending()).toBe(0);
	});

	test("a capture the browser refuses does not break the gesture", () => {
		/* `setPointerCapture` throws for a pointer the browser no longer considers
		 * active — a synthetic press, or one released before the effect ran. Found
		 * on a phone: the throw escaped the dispatch and left the gesture
		 * half-open, with the page reporting a `NotFoundError` nobody could act on. */
		const clock = manualClock();
		const dispatched: TimelineEvent[] = [];
		const fixture = hostFixture(clock, dispatched);
		const refusing: InterpreterHost = {
			...fixture.host,
			surface: {
				setPointerCapture() {
					throw new Error("NotFoundError: no active pointer with the given id");
				},
				releasePointerCapture() {
					throw new Error("NotFoundError: no active pointer with the given id");
				},
			},
		};
		const interpreter = createEffectInterpreter(refusing);

		expect(() => interpreter.perform([{ type: "capturePointer", pointerId: 9 }])).not.toThrow();
		/* Not recorded, so teardown does not try to release what was never taken. */
		expect(interpreter.capturedPointers()).toEqual([]);
		expect(() => interpreter.perform([{ type: "releasePointer", pointerId: 9 }])).not.toThrow();
		expect(() => interpreter.dispose()).not.toThrow();

		/* And everything else in the same batch still happened: the throw must not
		 * take the scroll and the repaint down with it. */
		const second = createEffectInterpreter({ ...refusing, surface: refusing.surface });
		second.perform([
			{ type: "capturePointer", pointerId: 3 },
			{ type: "announce", message: "still announced" },
		]);
		expect(fixture.liveRegion.textContent).toBe("still announced");
	});

	test("dispose releases every capture it still holds and cancels its frame", () => {
		const clock = manualClock();
		const dispatched: TimelineEvent[] = [];
		const fixture = hostFixture(clock, dispatched);
		const interpreter = createEffectInterpreter(fixture.host);
		interpreter.perform([
			{ type: "capturePointer", pointerId: 1 },
			{ type: "capturePointer", pointerId: 2 },
			{ type: "startAutoScroll", direction: 1, pixelsPerSecond: 600 },
		]);
		expect(interpreter.hasPendingFrame()).toBe(true);

		interpreter.dispose();

		expect(fixture.surface.releases().sort((a, b) => a - b)).toEqual([1, 2]);
		expect(interpreter.capturedPointers()).toEqual([]);
		expect(clock.pending()).toBe(0);
		clock.advance(1000);
		expect(dispatched).toEqual([]);
	});
});

/* ---- 6.4 Edge auto-scroll ------------------------------------------------- */

describe("edge auto-scroll", () => {
	test("advances the view per frame while it runs, at the declared speed", () => {
		const clock = manualClock();
		const dispatched: TimelineEvent[] = [];
		const fixture = hostFixture(clock, dispatched);
		const interpreter = createEffectInterpreter(fixture.host);

		interpreter.perform([{ type: "startAutoScroll", direction: 1, pixelsPerSecond: 600 }]);
		clock.advance(100);
		clock.advance(100);

		expect(dispatched).toEqual([
			{ type: "pan", deltaPx: 60 },
			{ type: "pan", deltaPx: 60 },
		]);
	});

	test("a terminal phase cancels the pending frame permanently", () => {
		const clock = manualClock();
		const dispatched: TimelineEvent[] = [];
		const fixture = hostFixture(clock, dispatched);
		const interpreter = createEffectInterpreter(fixture.host);

		interpreter.perform([{ type: "startAutoScroll", direction: -1, pixelsPerSecond: 300 }]);
		clock.advance(50);
		expect(dispatched.length).toBe(1);

		interpreter.perform([{ type: "stopAutoScroll" }]);
		expect(clock.pending()).toBe(0);
		/* Permanently: a second stop, and a long advance afterwards, must not find
		 * a frame that re-armed itself. */
		interpreter.perform([{ type: "stopAutoScroll" }]);
		clock.advance(5000);
		expect(dispatched.length).toBe(1);
		expect(interpreter.hasPendingFrame()).toBe(false);
	});

	test("a restart does not stack two loops on one gesture", () => {
		const clock = manualClock();
		const dispatched: TimelineEvent[] = [];
		const fixture = hostFixture(clock, dispatched);
		const interpreter = createEffectInterpreter(fixture.host);

		interpreter.perform([{ type: "startAutoScroll", direction: 1, pixelsPerSecond: 600 }]);
		interpreter.perform([{ type: "startAutoScroll", direction: -1, pixelsPerSecond: 600 }]);
		clock.advance(100);

		expect(dispatched).toEqual([{ type: "pan", deltaPx: -60 }]);
	});
});

/* ---- 6.5 The scroll writer ------------------------------------------------ */

describe("scroll writer", () => {
	test("recognizes the echo of its own write exactly once", () => {
		const scroller = { scrollLeft: 0 };
		const writer = createScrollWriter(scroller);

		writer.write(240);
		expect(scroller.scrollLeft).toBe(240);
		expect(writer.isEcho(240)).toBe(true);
		/* The same position arriving again is the person putting it back there, not
		 * a second echo of one write. */
		expect(writer.isEcho(240)).toBe(false);
	});

	test("a reading that is not ours is new input", () => {
		const writer = createScrollWriter({ scrollLeft: 0 });
		writer.write(100);
		expect(writer.isEcho(180)).toBe(false);
		/* And the write it did not match is still outstanding. */
		expect(writer.pending).toBe(100);
	});

	test("a sub-pixel rounding of our own write is still ours", () => {
		const writer = createScrollWriter({ scrollLeft: 0 });
		writer.write(100.4);
		expect(writer.isEcho(100)).toBe(true);
	});
});

/* ---- 6.2, 6.3, 6.6 The surface ------------------------------------------- */
