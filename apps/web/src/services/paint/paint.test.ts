/* The paint layer: what is drawn, where, and how little of it.
 *
 * Every assertion here is about geometry or about counts. "It repainted" is not
 * evidence for any of the requirements in `timeline-render-budget` — the whole
 * point of the region mechanism is that a full repaint and a two-clip repaint
 * both look like "it repainted" to a render counter.
 */
import { describe, expect, test } from "vite-plus/test";
import { createStore } from "@models/timeline-view/store.ts";
import { framesToProject } from "@models/timeline-view/tick.ts";
import { itemGeometry } from "@models/timeline-view/geometry.ts";
import { timebase } from "@models/timeline-view/timebase.ts";
import { rational } from "@models/timeline-view/rational.ts";
import { type ItemId, type TimelineState } from "@models/timeline-view/types.ts";
import { type PaintRegion } from "@models/timeline-view/effects.ts";
import { magneticSingleRow, multiRowFree, BASE_30 } from "@models/timeline-view/fixtures.ts";
import { createCanvasBackend, type Canvas2DContext } from "./canvas-backend.ts";
import { ROW_HEIGHT_PX, RULER_HEIGHT_PX, sceneOptions } from "./paint-fixtures.ts";
import {
	coalesceRegions,
	createPaintScheduler,
	type PaintBackend,
	type PaintFrame,
	type PaintScene,
} from "./paint.ts";
import {
	DEFAULT_PAINT_PALETTE,
	PAINT_PALETTE_TOKENS,
	resolvePaintPalette,
	tokenReaderFrom,
} from "./palette.ts";
import { describeScene, rulerStepFrames } from "./scene.ts";

/* ---- Doubles -------------------------------------------------------------- */

interface DrawCall {
	readonly op: "fillRect" | "clearRect" | "fillText" | "clip";
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly fill: string;
	readonly text?: string;
}

/** A 2D context that draws nothing and remembers everything. */
function recordingContext(): Canvas2DContext & { calls: DrawCall[] } {
	const calls: DrawCall[] = [];
	let rect = { x: 0, y: 0, width: 0, height: 0 };
	const context = {
		calls,
		fillStyle: "",
		font: "",
		textBaseline: "",
		save() {},
		restore() {},
		beginPath() {},
		rect(x: number, y: number, width: number, height: number) {
			rect = { x, y, width, height };
		},
		clip() {
			calls.push({ op: "clip", ...rect, fill: context.fillStyle });
		},
		clearRect(x: number, y: number, width: number, height: number) {
			calls.push({ op: "clearRect", x, y, width, height, fill: context.fillStyle });
		},
		fillRect(x: number, y: number, width: number, height: number) {
			calls.push({ op: "fillRect", x, y, width, height, fill: context.fillStyle });
		},
		fillText(text: string, x: number, y: number) {
			calls.push({ op: "fillText", x, y, width: 0, height: 0, fill: context.fillStyle, text });
		},
	};
	return context;
}

/** A backend that records the frames it was asked to paint. */
function recordingBackend(): PaintBackend & { frames: PaintFrame[] } {
	const frames: PaintFrame[] = [];
	return {
		frames,
		paint(frame) {
			frames.push(frame);
		},
	};
}

function manualClock() {
	let handle = 0;
	const frames = new Map<number, () => void>();
	return {
		now: () => 0,
		request(callback: (timeMs: number) => void) {
			handle += 1;
			frames.set(handle, () => callback(0));
			return handle;
		},
		cancel(id: number) {
			frames.delete(id);
		},
		run() {
			const due = [...frames.values()];
			frames.clear();
			for (const callback of due) callback();
		},
		pending: () => frames.size,
	};
}

/* ---- 7.1 The paint interface ---------------------------------------------- */

describe("paint interface", () => {
	test("a fake backend receives the scene and the regions, and nothing else", () => {
		const backend = recordingBackend();
		const state = magneticSingleRow();
		const clock = manualClock();
		const scheduler = createPaintScheduler({
			backend,
			clock,
			scene: () => describeScene(state, sceneOptions(state)),
		});

		scheduler.invalidate({ xPx: 0, yPx: 0, widthPx: 100, heightPx: 40 });
		expect(backend.frames.length).toBe(0);
		clock.run();

		expect(backend.frames.length).toBe(1);
		const frame = backend.frames[0]!;
		expect(frame.regions).toEqual([{ xPx: 0, yPx: 0, widthPx: 100, heightPx: 40 }]);
		expect(frame.scene.items.length).toBeGreaterThan(0);
		expect(frame.scene.palette).toBe(DEFAULT_PAINT_PALETTE);
	});

	test("several invalidations in one frame paint once", () => {
		const backend = recordingBackend();
		const state = magneticSingleRow();
		const clock = manualClock();
		const scheduler = createPaintScheduler({
			backend,
			clock,
			scene: () => describeScene(state, sceneOptions(state)),
		});

		scheduler.invalidate({ xPx: 0, yPx: 0, widthPx: 10, heightPx: 40 });
		scheduler.invalidate({ xPx: 500, yPx: 0, widthPx: 10, heightPx: 40 });
		clock.run();

		expect(backend.frames.length).toBe(1);
		/* Two disjoint regions stay two. Merging them would repaint everything
		 * between, which is the cost this mechanism exists to avoid. */
		expect(backend.frames[0]!.regions.length).toBe(2);
	});

	test("overlapping invalidations coalesce into their union", () => {
		expect(
			coalesceRegions([
				{ xPx: 0, yPx: 0, widthPx: 40, heightPx: 40 },
				{ xPx: 30, yPx: 0, widthPx: 40, heightPx: 40 },
			]),
		).toEqual([{ xPx: 0, yPx: 0, widthPx: 70, heightPx: 40 }]);
	});

	test("dispose drops the pending frame and paints nothing afterwards", () => {
		const backend = recordingBackend();
		const state = magneticSingleRow();
		const clock = manualClock();
		const scheduler = createPaintScheduler({
			backend,
			clock,
			scene: () => describeScene(state, sceneOptions(state)),
		});
		scheduler.invalidate({ xPx: 0, yPx: 0, widthPx: 10, heightPx: 10 });
		scheduler.dispose();
		clock.run();
		expect(backend.frames).toEqual([]);
		expect(clock.pending()).toBe(0);
	});
});

/* ---- 7.2 The Canvas 2D backend -------------------------------------------- */

describe("canvas backend", () => {
	test("painted item geometry equals the kernel's computed geometry", () => {
		const state = magneticSingleRow();
		const options = sceneOptions(state);
		const scene = describeScene(state, options);
		const context = recordingContext();
		createCanvasBackend(context).paint({
			scene,
			regions: [{ xPx: 0, yPx: 0, widthPx: scene.widthPx, heightPx: scene.heightPx }],
		});

		for (const painted of scene.items) {
			const item = state.items.get(painted.id)!;
			const geometry = itemGeometry(item, state.viewport);
			const drawn = context.calls.find(
				(call) =>
					call.op === "fillRect" &&
					call.x === geometry.paintBox.leftPx &&
					call.height === ROW_HEIGHT_PX,
			);
			expect(drawn, `no body drawn for ${painted.id}`).toBeDefined();
			expect(drawn!.width).toBeCloseTo(geometry.paintBox.rightPx - geometry.paintBox.leftPx, 6);
			expect(drawn!.y).toBe(RULER_HEIGHT_PX);
		}
	});

	test("selection, locking, ruler, playhead, and guides each take their own colour", () => {
		const base = multiRowFree();
		const state: TimelineState = { ...base, selection: new Set<ItemId>(["v1"]) };
		const options = sceneOptions(state, {
			playheadTicks: framesToProject(60, BASE_30).ticks,
			guideTicks: [framesToProject(30, BASE_30).ticks],
		});
		const scene = describeScene(state, options);
		const context = recordingContext();
		createCanvasBackend(context).paint({
			scene,
			regions: [{ xPx: 0, yPx: 0, widthPx: scene.widthPx, heightPx: scene.heightPx }],
		});

		const fills = new Set(
			context.calls.filter((call) => call.op === "fillRect").map((call) => call.fill),
		);
		expect(fills.has(DEFAULT_PAINT_PALETTE.itemSelected)).toBe(true);
		expect(fills.has(DEFAULT_PAINT_PALETTE.itemLocked)).toBe(true);
		expect(fills.has(DEFAULT_PAINT_PALETTE.item)).toBe(true);
		expect(fills.has(DEFAULT_PAINT_PALETTE.ruler)).toBe(true);
		expect(fills.has(DEFAULT_PAINT_PALETTE.playhead)).toBe(true);
		expect(fills.has(DEFAULT_PAINT_PALETTE.snapGuide)).toBe(true);

		/* The playhead is drawn where the viewport puts frame 60, not at a rounded
		 * pixel of its own choosing. */
		const playhead = context.calls.find((call) => call.fill === DEFAULT_PAINT_PALETTE.playhead)!;
		expect(playhead.x).toBeCloseTo(scene.playheadPx!, 6);
	});

	test("the ruler is drawn at a graduation that keeps labels apart", () => {
		const state = magneticSingleRow();
		const scene = describeScene(state, sceneOptions(state));
		/* Ascending along the ladder, and never closer together than asked. */
		for (let index = 1; index < scene.ticks.length; index += 1) {
			expect(scene.ticks[index]!.xPx - scene.ticks[index - 1]!.xPx).toBeGreaterThanOrEqual(80);
		}
		expect(scene.ticks[0]?.label).toMatch(/^\d\d:\d\d:\d\d[:;]\d\d$/);
	});

	test("the ruler step travels through the timebase rather than comparing frames to pixels", () => {
		const state = magneticSingleRow();
		const fine = timebase(rational(30, 1), 1);
		/* Same scale, a thousandth of the ticks per frame: the step in FRAMES must
		 * grow to compensate, which a frames-to-pixels comparison would miss. */
		expect(rulerStepFrames(state.viewport, fine.ticksPerFrame, 80)).toBeGreaterThan(
			rulerStepFrames(state.viewport, BASE_30.ticksPerFrame, 80),
		);
	});

	test("a region confines what is drawn, and the backend clips to it", () => {
		const state = magneticSingleRow();
		const scene = describeScene(state, sceneOptions(state));
		const context = recordingContext();
		const region: PaintRegion = {
			xPx: 0,
			yPx: RULER_HEIGHT_PX,
			widthPx: 60,
			heightPx: ROW_HEIGHT_PX,
		};
		createCanvasBackend(context).paint({ scene, regions: [region] });

		expect(context.calls.filter((call) => call.op === "clip")).toEqual([
			{
				op: "clip",
				x: region.xPx,
				y: region.yPx,
				width: region.widthPx,
				height: region.heightPx,
				fill: "",
			},
		]);
		/* The ruler is above this region and is not drawn for it at all. */
		expect(context.calls.some((call) => call.fill === DEFAULT_PAINT_PALETTE.ruler)).toBe(false);
		/* And the second scene item, which starts beyond the region, is skipped. */
		const second = itemGeometry(state.items.get("scene-1")!, state.viewport);
		expect(context.calls.some((call) => call.x === second.paintBox.leftPx)).toBe(false);
	});
});

/* ---- 7.3 Region invalidation ---------------------------------------------- */

describe("region invalidation", () => {
	test("a selection change invalidates exactly the two items whose state moved", () => {
		const store = createStore(magneticSingleRow());
		const invalidated: PaintRegion[] = [];
		store.setEffectSink((effects) => {
			for (const effect of effects)
				if (effect.type === "invalidateRegion") invalidated.push(effect.region);
		});

		store.dispatch({ type: "select", items: ["scene-0"] });
		store.dispatch({ type: "select", items: ["scene-1"] });

		const state = store.getState();
		const first = itemGeometry(state.items.get("scene-0")!, state.viewport);
		const second = itemGeometry(state.items.get("scene-1")!, state.viewport);
		/* One region for the first selection, then exactly two for the change:
		 * the item that lost selection and the one that gained it. Not the row,
		 * not the timeline. */
		expect(invalidated.length).toBe(3);
		expect(
			invalidated
				.slice(1)
				.map((region) => region.xPx)
				.sort((a, b) => a - b),
		).toEqual([first.timeBox.leftPx, second.timeBox.leftPx]);
		/* Each region is one item's own extent. Wider than the viewport here — the
		 * fixture's clips are longer than what is on screen — but a small fraction
		 * of the timeline, which is the bound that matters. */
		const timelineWidthPx = state.duration.ticks * state.viewport.scale;
		for (const region of invalidated.slice(1)) {
			expect(region.widthPx).toBeCloseTo(first.timeBox.rightPx - first.timeBox.leftPx, 6);
			expect(region.widthPx).toBeLessThan(timelineWidthPx / 3);
		}
	});

	test("selecting what is already selected invalidates nothing", () => {
		const store = createStore(magneticSingleRow());
		store.dispatch({ type: "select", items: ["scene-0"] });
		const invalidated: PaintRegion[] = [];
		store.setEffectSink((effects) => {
			for (const effect of effects)
				if (effect.type === "invalidateRegion") invalidated.push(effect.region);
		});
		store.dispatch({ type: "select", items: ["scene-0"] });
		expect(invalidated).toEqual([]);
	});

	test("a playback tick invalidates only the playhead's column, in both positions", () => {
		const state = magneticSingleRow();
		const backend = recordingBackend();
		const clock = manualClock();
		let playheadTicks = framesToProject(30, BASE_30).ticks;
		const options = () => sceneOptions(state, { playheadTicks });
		const scheduler = createPaintScheduler({
			backend,
			clock,
			scene: () => describeScene(state, options()),
		});

		/* What a host does on a tick: invalidate where the playhead was and where
		 * it now is, and nothing between. */
		const columnAt = (ticks: number): PaintRegion => ({
			xPx: (ticks - state.viewport.start.ticks) * state.viewport.scale - 1,
			yPx: 0,
			widthPx: 4,
			heightPx: options().heightPx,
		});
		const before = columnAt(playheadTicks);
		/* One tick past a whole frame: a tick is a thousandth of a frame, and the
		 * playhead moves by whatever the renderer reported, not by whole frames. */
		playheadTicks += 100;
		scheduler.invalidate(before);
		scheduler.invalidate(columnAt(playheadTicks));
		clock.run();

		const regions = backend.frames[0]!.regions;
		const painted = regions.reduce((total, region) => total + region.widthPx, 0);
		/* Two overlapping columns, coalesced into one narrow band — not the width
		 * of the timeline. */
		expect(regions.length).toBe(1);
		expect(painted).toBeLessThan(20);
	});
});

/* ---- 7.6 Theme tokens into the paint palette ------------------------------ */

describe("paint palette", () => {
	test("a token change moves the styled region and the painted region to one value", () => {
		const tokens = new Map<string, string>([[PAINT_PALETTE_TOKENS.item, "#123456"]]);
		const palette = resolvePaintPalette(
			tokenReaderFrom({ getPropertyValue: (property) => tokens.get(property) ?? "" }),
		);
		expect(palette.item).toBe("#123456");

		const state = magneticSingleRow();
		const scene: PaintScene = describeScene(state, sceneOptions(state, { palette }));
		const context = recordingContext();
		createCanvasBackend(context).paint({
			scene,
			regions: [{ xPx: 0, yPx: 0, widthPx: scene.widthPx, heightPx: scene.heightPx }],
		});

		/* The value the painter used is the value the stylesheet declared — one
		 * source, read once, rather than two that have to be kept in agreement. */
		expect(
			context.calls.some(
				(call) => call.op === "fillRect" && call.fill === tokens.get(PAINT_PALETTE_TOKENS.item),
			),
		).toBe(true);

		tokens.set(PAINT_PALETTE_TOKENS.item, "#abcdef");
		expect(
			resolvePaintPalette(
				tokenReaderFrom({ getPropertyValue: (property) => tokens.get(property) ?? "" }),
			).item,
		).toBe("#abcdef");
	});

	test("an unset or empty token falls back rather than painting an empty fill", () => {
		const palette = resolvePaintPalette(() => "");
		expect(palette).toEqual(DEFAULT_PAINT_PALETTE);
		/* Whitespace is empty too: a context given "  " keeps the previous colour
		 * on the surface and the mistake looks like a caching bug. */
		expect(resolvePaintPalette(() => "   ").item).toBe(DEFAULT_PAINT_PALETTE.item);
	});

	test("every painted surface names a token, and every token is read", () => {
		const read: string[] = [];
		resolvePaintPalette((token) => {
			read.push(token);
			return undefined;
		});
		expect(read.sort()).toEqual(Object.values(PAINT_PALETTE_TOKENS).sort());
		expect(Object.keys(PAINT_PALETTE_TOKENS).sort()).toEqual(
			Object.keys(DEFAULT_PAINT_PALETTE).sort(),
		);
	});
});
