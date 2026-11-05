import { describe, expect, test } from "vite-plus/test";
import { framesToProject, projectTime } from "./tick.ts";
import { EFFECT_TYPES, isSerializable, unionRegions, type Effect } from "./effects.ts";
import { isViewportEvent, type TimelineEvent } from "./events.ts";
import { BASE_30, magneticSingleRow, multiRowFree, nestedKeyframes } from "./fixtures.ts";
import { DEFAULT_REDUCER_OPTIONS, reduce, reduceAll } from "./reducer.ts";
import { createStore, setEqual, shallowEqual } from "./store.ts";

import {
	pixelAtTime,
	resolveViewport,
	timeAtPixel,
	viewportEquals,
	zoomAbout,
} from "./viewport.ts";

describe("the model represents unlike timelines", () => {
	test("a magnetic single-row timeline carries no row on any item", () => {
		const state = magneticSingleRow();
		expect(state.order).toHaveLength(4);
		for (const id of state.order) expect(state.items.get(id)!.rowId).toBeUndefined();
		expect(state.rows).toHaveLength(1);
		expect(state.rows[0]!.placement).toBe("magnetic");
	});

	test("a multi-row timeline mixes policies, locking, grouping and linking", () => {
		const state = multiRowFree();
		expect(state.rows.map((row) => row.placement)).toEqual(["magnetic", "free", "free"]);
		expect(state.rows.map((row) => row.overlap)).toEqual(["insert", "permit", "reject"]);
		expect(state.items.get("locked")!.locked).toBe(true);
		expect(state.items.get("v1")!.linkedTo).toEqual(["a1"]);
		expect(state.items.get("a1")!.linkedTo).toEqual(["v1"]);
		expect([...state.items.values()].filter((item) => item.groupId === "titles")).toHaveLength(2);
		/* Source media is in SOURCE ticks, the timeline position in project ticks,
		 * and both are retrievable without ambiguity. */
		expect(state.items.get("v1")!.source!.inPoint.domain).toBe("source");
		expect(state.items.get("v1")!.start.domain).toBe("project");
	});

	test("a keyframe timeline nests tracks inside an item", () => {
		const state = nestedKeyframes();
		const layer = state.items.get("layer-1")!;
		expect(layer.tracks!.map((track) => track.id)).toEqual(["opacity", "position"]);
		expect(layer.tracks![0]!.markers).toHaveLength(4);
		/* A nested marker's position is a project time, so it is comparable with
		 * the item's own start without a second unit being involved. */
		expect(layer.tracks![0]!.markers[1]!.at.ticks).toBe(framesToProject(30, BASE_30).ticks);
	});
});

describe("effects are descriptions, not actions", () => {
	/** One of every variant, so the checks below cover the union rather than a sample. */
	const everyEffect: Effect[] = [
		{ type: "capturePointer", pointerId: 3 },
		{ type: "releasePointer", pointerId: 3 },
		{ type: "scrollTo", leftPx: 120 },
		{ type: "startAutoScroll", direction: 1, pixelsPerSecond: 400 },
		{ type: "stopAutoScroll" },
		{ type: "focus", target: { kind: "item", id: "v1" } },
		{ type: "announce", message: "Trimmed to 2 seconds" },
		{
			type: "invalidateRegion",
			region: { xPx: 0, yPx: 0, widthPx: 10, heightPx: 10 },
			items: ["v1"],
		},
	];

	test("every variant is covered by this test", () => {
		expect(everyEffect.map((effect) => effect.type).sort()).toEqual([...EFFECT_TYPES].sort());
	});

	test("every effect round-trips through JSON without loss", () => {
		for (const effect of everyEffect) {
			expect(JSON.parse(JSON.stringify(effect)), `${effect.type} did not round-trip`).toEqual(
				effect,
			);
		}
	});

	test("no effect carries a function or a host reference", () => {
		for (const effect of everyEffect)
			expect(isSerializable(effect), `${effect.type} is not data`).toBe(true);
		/* The predicate has to be able to say no, or the assertion above is empty. */
		expect(isSerializable({ type: "focus", onDone: () => undefined })).toBe(false);
		expect(isSerializable({ region: new Map() })).toBe(false);
		expect(isSerializable({ nested: [{ ok: 1 }, { bad: Symbol("x") }] })).toBe(false);
	});

	test("regions union into the smallest rectangle containing both", () => {
		expect(
			unionRegions(
				{ xPx: 0, yPx: 0, widthPx: 10, heightPx: 10 },
				{ xPx: 20, yPx: 5, widthPx: 10, heightPx: 10 },
			),
		).toEqual({
			xPx: 0,
			yPx: 0,
			widthPx: 30,
			heightPx: 15,
		});
	});
});

describe("the viewport has exactly one writer", () => {
	const options = { ...DEFAULT_REDUCER_OPTIONS, scaleLimits: { minScale: 1e-6, maxScale: 1 } };

	test("an input that resolves to the published viewport publishes nothing", () => {
		const state = magneticSingleRow();
		/* A resize observer that re-arms and reports the width it already had:
		 * the loop that produced an unbounded republish in the previous
		 * implementation, reduced to no state change at all. */
		const same = reduce(state, { type: "resize", widthPx: state.viewport.widthPx }, options);
		expect(same.state).toBe(state);
		expect(same.effects).toEqual([]);

		const alsoSame = reduce(
			state,
			{ type: "scroll", leftPx: state.viewport.start.ticks * state.viewport.scale },
			options,
		);
		expect(alsoSame.state).toBe(state);
		expect(alsoSame.effects).toEqual([]);
	});

	test("a scroller's lead maps offsets to times and lets the view start before zero", () => {
		const state = magneticSingleRow();
		const { widthPx, scale } = state.viewport;
		const lead = Math.round(widthPx / 2);
		const led = reduce(state, { type: "resize", widthPx, leadPx: lead }, options).state;
		/* Scrolled to zero, the view starts a lead before time zero rather than
		 * being clamped back to zero, which would write the scroller to `lead`. */
		const atZero = reduce(led, { type: "scroll", leftPx: 0 }, options);
		expect(atZero.state.viewport.start.ticks).toBe(-Math.round(lead / scale));
		expect(atZero.effects.filter((e) => e.type === "scrollTo")).toEqual([
			{ type: "scrollTo", leftPx: 0 },
		]);
		/* A published start is written back as an offset that includes the lead. */
		const panned = reduce(atZero.state, { type: "pan", deltaPx: 40 }, options);
		const write = panned.effects.find((e) => e.type === "scrollTo");
		expect(write).toEqual({ type: "scrollTo", leftPx: expect.closeTo(40, 0) });
	});

	test("a scroll queued before a zoom and delivered after it does not overwrite the zoom", () => {
		const state = magneticSingleRow();
		const zoomed = reduce(state, { type: "zoom", focalPx: 400, factor: 2 }, options).state;
		expect(zoomed.viewport.scale).toBeCloseTo(state.viewport.scale * 2, 12);

		/* The stale scroll: computed against the OLD scale, delivered after the
		 * zoom. It moves the start, and it must not restore the old scale. */
		const stale: TimelineEvent = { type: "scroll", leftPx: 240 };
		const after = reduce(zoomed, stale, options).state;
		expect(after.viewport.scale).toBe(zoomed.viewport.scale);
	});

	test("two inputs in one frame both survive, in order", () => {
		const state = magneticSingleRow();
		const both = reduceAll(
			state,
			[
				{ type: "scroll", leftPx: 200 },
				{ type: "zoom", focalPx: 0, factor: 4 },
			],
			options,
		);
		expect(both.state.viewport.scale).toBeCloseTo(state.viewport.scale * 4, 12);
		expect(both.state.viewport.start.ticks).toBeGreaterThan(0);
	});

	test("zoom holds the time under its focal point", () => {
		let input = { start: projectTime(0), scale: 0.001, widthPx: 800 };
		const focalPx = 500;
		const before = timeAtPixel(input, focalPx);
		/* Repeatedly, because the failure this guards is drift that accumulates
		 * rather than an error visible in one step. */
		for (let step = 0; step < 40; step += 1) {
			input = zoomAbout(input, focalPx, step % 2 === 0 ? 1.25 : 0.8, {
				minScale: 1e-9,
				maxScale: 1,
			});
		}
		const after = timeAtPixel(input, focalPx);
		/* Within one device pixel, which is the requirement — the only movement is
		 * rounding to a whole tick, and a tick is a thousandth of a frame. */
		expect(Math.abs(pixelAtTime(input, before) - pixelAtTime(input, after))).toBeLessThanOrEqual(1);
	});

	test("magnification is held inside its limits", () => {
		const input = { start: projectTime(0), scale: 0.001, widthPx: 800 };
		const limits = { minScale: 0.0005, maxScale: 0.002 };
		expect(zoomAbout(input, 0, 1000, limits).scale).toBe(0.002);
		expect(zoomAbout(input, 0, 0.000001, limits).scale).toBe(0.0005);
	});

	test("equality compares the stored fields, and `end` is derived from them", () => {
		const a = resolveViewport({ start: projectTime(0), scale: 0.001, widthPx: 800 });
		const b = resolveViewport({ start: projectTime(0), scale: 0.001, widthPx: 800 });
		expect(viewportEquals(a, b)).toBe(true);
		expect(a.end.ticks).toBe(b.end.ticks);
		expect(
			viewportEquals(a, resolveViewport({ start: projectTime(1), scale: 0.001, widthPx: 800 })),
		).toBe(false);
		expect(
			viewportEquals(a, resolveViewport({ start: projectTime(0), scale: 0.002, widthPx: 800 })),
		).toBe(false);
		expect(
			viewportEquals(a, resolveViewport({ start: projectTime(0), scale: 0.001, widthPx: 900 })),
		).toBe(false);
	});

	test("the four viewport inputs are events, and are recognisable as such", () => {
		for (const event of [
			{ type: "scroll", leftPx: 0 },
			{ type: "resize", widthPx: 1 },
			{ type: "zoom", focalPx: 0, factor: 1 },
			{ type: "pan", deltaPx: 1 },
		] as TimelineEvent[]) {
			expect(isViewportEvent(event), `${event.type} should resolve the viewport`).toBe(true);
		}
		expect(isViewportEvent({ type: "select", items: [] })).toBe(false);
	});
});

describe("selection and focus", () => {
	test("selecting another item invalidates the two that changed, not the row", () => {
		const state = multiRowFree();
		const first = reduce(state, { type: "select", items: ["v1"] }).state;
		const step = reduce(first, { type: "select", items: ["v2"] });
		expect([...step.state.selection]).toEqual(["v2"]);
		const invalidated = step.effects.filter((effect) => effect.type === "invalidateRegion");
		expect(invalidated).toHaveLength(2);
		expect(
			invalidated
				.flatMap((effect) => (effect.type === "invalidateRegion" ? (effect.items ?? []) : []))
				.sort(),
		).toEqual(["v1", "v2"]);
	});

	test("selecting the already-selected item changes nothing and repaints nothing", () => {
		const state = reduce(multiRowFree(), { type: "select", items: ["v1"] }).state;
		const again = reduce(state, { type: "select", items: ["v1"] });
		expect(again.state).toBe(state);
		expect(again.effects).toEqual([]);
	});

	test("a selection cannot name an item that does not exist", () => {
		const state = multiRowFree();
		const step = reduce(state, { type: "select", items: ["nope"] });
		expect(step.state).toBe(state);
	});

	test("replacing the items drops a selection and a focus that no longer exist", () => {
		let state = multiRowFree();
		state = reduce(state, { type: "select", items: ["v1", "v2"] }).state;
		state = reduce(state, { type: "focus", target: { kind: "item", id: "v1" } }).state;
		const kept = state.items.get("v2")!;
		const step = reduce(state, { type: "replaceItems", items: [kept] });
		expect([...step.state.selection]).toEqual(["v2"]);
		expect(step.state.focus).toBeUndefined();
		expect(step.state.order).toEqual(["v2"]);
	});

	test("focusing what is already focused emits nothing", () => {
		const state = reduce(multiRowFree(), {
			type: "focus",
			target: { kind: "item", id: "v1" },
		}).state;
		const again = reduce(state, { type: "focus", target: { kind: "item", id: "v1" } });
		expect(again.state).toBe(state);
		expect(again.effects).toEqual([]);
	});
});

describe("the store notifies by slice", () => {
	function counterStore() {
		const state = multiRowFree();
		return { store: createStore(state), state };
	}

	test("an unrelated slice change notifies nobody", () => {
		const { store } = counterStore();
		const selection = store.slice((state) => state.selection, setEqual);
		let notified = 0;
		selection.subscribe(() => {
			notified += 1;
		});

		/* A viewport change is not a selection change. */
		store.dispatch({ type: "zoom", focalPx: 10, factor: 2 });
		expect(notified).toBe(0);
	});

	test("a selected slice change notifies exactly once", () => {
		const { store } = counterStore();
		const selection = store.slice((state) => state.selection, setEqual);
		let notified = 0;
		selection.subscribe(() => {
			notified += 1;
		});

		store.dispatch({ type: "select", items: ["v1"] });
		expect(notified).toBe(1);
		expect([...selection.get()]).toEqual(["v1"]);

		/* And an equal value is not a change, at the slice as well as at the reducer. */
		store.dispatch({ type: "select", items: ["v1"] });
		expect(notified).toBe(1);
	});

	test("a batch notifies once, not once per event", () => {
		const { store } = counterStore();
		const viewport = store.slice((state) => state.viewport, viewportEquals);
		let notified = 0;
		viewport.subscribe(() => {
			notified += 1;
		});
		store.dispatchAll([
			{ type: "pan", deltaPx: 40 },
			{ type: "pan", deltaPx: 40 },
			{ type: "zoom", focalPx: 0, factor: 2 },
		]);
		expect(notified).toBe(1);
	});

	test("a slice's value is referentially stable until it changes", () => {
		const { store } = counterStore();
		const viewport = store.slice((state) => state.viewport, viewportEquals);
		const before = viewport.get();
		store.dispatch({ type: "select", items: ["v1"] });
		expect(viewport.get()).toBe(before);
		store.dispatch({ type: "pan", deltaPx: 100 });
		expect(viewport.get()).not.toBe(before);
	});

	test("unsubscribing releases the slice, leaving nothing to recompute", () => {
		const { store } = counterStore();
		let computed = 0;
		const slice = store.slice((state) => {
			computed += 1;
			return state.selection;
		}, setEqual);
		const stop = slice.subscribe(() => undefined);
		store.dispatch({ type: "select", items: ["v1"] });
		const afterOne = computed;
		stop();
		store.dispatch({ type: "select", items: ["v2"] });
		expect(computed).toBe(afterOne);
	});

	test("effects reach the sink, and the sink sees the state they belong to", () => {
		const { store } = counterStore();
		const seen: Array<{ effects: number; selected: number }> = [];
		store.setEffectSink((effects) => {
			seen.push({ effects: effects.length, selected: store.getState().selection.size });
		});
		store.dispatch({ type: "select", items: ["v1"] });
		expect(seen).toEqual([{ effects: 1, selected: 1 }]);
	});

	test("shallow equality compares own keys, one level deep", () => {
		expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
		expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
		expect(shallowEqual({ a: { x: 1 } }, { a: { x: 1 } })).toBe(false);
		expect(shallowEqual(1, 1)).toBe(true);
		expect(shallowEqual(null, null)).toBe(true);
		expect(shallowEqual(null, { a: 1 })).toBe(false);
	});

	test("set equality compares membership", () => {
		expect(setEqual(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
		expect(setEqual(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
		expect(setEqual(new Set(["a"]), new Set(["b"]))).toBe(false);
	});
});
