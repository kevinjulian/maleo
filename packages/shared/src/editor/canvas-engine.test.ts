/* The canvas calls over the WASM ABI (`p2-preview-editing` task 3.2): each
 * typed wrapper round-trips through the engine the test preload provides. */
import { describe, expect, test } from "vite-plus/test";
import { editorEngine } from "./engine-registry.ts";
import type { EngineResult } from "./engine.ts";
import {
	CanvasEngineError,
	canvasEdit,
	canvasLayout,
	canvasSizePatch,
	openCanvas,
	type CanvasTarget,
} from "./canvas-engine.ts";

const layout = { xPct: 10, yPct: 20, widthPct: 40, heightPct: 30, fit: "contain" };
const SCOPE = {
	mediaAssets: [],
	slides: [],
	posts: [],
	doc: {
		schemaVersion: 2,
		markers: [],
		clips: [2, 3].map((id) => ({
			id: `video:${id}`,
			type: "image",
			startSec: 0,
			durationSec: 4,
			track: id,
			video: {
				id,
				kind: "image",
				url: `${id}.png`,
				start: 0,
				dur: 4,
				track: id,
				layout: id === 2 ? layout : { ...layout, xPct: 60, yPct: 60, widthPct: 20, heightPct: 20 },
			},
		})),
	},
};
const VIDEO: CanvasTarget = { source: "video", id: 2 };
const VIEW = { area: { x: 0, y: 0, width: 800, height: 450 }, aspect: 800 / 450 };

function ok<T>(result: EngineResult<T>): T {
	if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`);
	return result.value;
}

const open = () => {
	const engine = editorEngine();
	const doc = ok(engine.open(JSON.stringify(SCOPE)));
	return { engine, doc };
};

describe("canvas session calls", () => {
	test("view, input, overlay and close round-trip on a canvas handle", () => {
		const { engine, doc } = open();
		const before = engine.canvasOpenCount();
		const canvas = openCanvas(engine, doc);
		expect(engine.canvasOpenCount()).toBe(before + 1);
		canvas.view(VIEW);
		const context = { time: 1, targets: [VIDEO] };
		const overlay = canvas.overlay(context);
		expect(overlay.box).toMatchObject({ kind: "element", xPct: 10, source: "video", id: 2 });
		expect(overlay.box?.handles?.map((h) => h.id)).toEqual(["nw", "ne", "sw", "se", "rotate"]);

		expect(canvas.input({ ...context, type: "down", x: 240, y: 157.5 })).toMatchObject({
			handled: true,
			preview: null,
			commit: null,
		});
		const moved = canvas.input({ ...context, type: "move", x: 320, y: 157.5, alt: true });
		expect(moved.preview).toMatchObject({ type: "clip.replace", id: "video:2" });
		expect(moved.overlay.box?.xPct).toBe(20);
		const up = canvas.input({ ...context, type: "up", x: 320, y: 157.5 });
		expect(up.commit).toMatchObject({
			type: "clip.replace",
			clip: { video: { layout: { xPct: 20 } } },
		});
		expect(up.preview).toBeNull();

		const toggled = canvas.input({ ...context, type: "down", x: 560, y: 315, shift: true });
		expect(toggled.select).toEqual({ type: "toggleClip", source: "video", refId: 3 });
		const nudged = canvas.input({ ...context, type: "key", key: "ArrowRight", handle: "move" });
		expect(nudged.commit).toMatchObject({ clip: { video: { layout: { xPct: 11 } } } });

		canvas.close();
		expect(engine.canvasOpenCount()).toBe(before);
		expect(() => canvas.overlay(context)).toThrow(CanvasEngineError);
	});

	test("a canvas over a missing document and a bad view are refused", () => {
		const { engine, doc } = open();
		expect(() => openCanvas(engine, 9999)).toThrow(/UnknownHandle/);
		const canvas = openCanvas(engine, doc);
		expect(() => canvas.view({ ...VIEW, aspect: 0 })).toThrow(CanvasEngineError);
		expect(() => canvas.overlay({ time: 1 })).toThrow(/no view/);
		canvas.close();
	});
});

describe("inspector calls", () => {
	test("layout, edit and size patch round-trip", () => {
		const { engine, doc } = open();
		expect(canvasLayout(engine, doc, VIDEO)).toMatchObject({
			clipId: "video:2",
			layout,
			start: 0,
			duration: 4,
			kind: "image",
		});
		expect(canvasLayout(engine, doc, { source: "text", id: 9 })).toBeNull();
		const cropped = canvasEdit(engine, doc, VIDEO, {
			crop: { xPct: 25, yPct: 0, widthPct: 50, heightPct: 100 },
			flipX: true,
		});
		expect(cropped).toMatchObject({
			type: "clip.replace",
			clip: { video: { layout: { flipX: true } } },
		});
		ok(engine.executeDelta(doc, JSON.stringify(cropped)));
		const cleared = canvasEdit(engine, doc, VIDEO, { crop: undefined });
		expect(cleared.type).toBe("clip.replace");
		expect(JSON.stringify(cleared)).not.toContain("crop");
		expect(canvasEdit(engine, doc, VIDEO, { blendMode: "overlay" as never })).toEqual({
			type: "noop",
		});
		expect(
			canvasSizePatch(engine, { widthPct: 40, heightPct: 30, aspectLocked: true }, "widthPct", 80),
		).toEqual({ widthPct: 80, heightPct: 60 });
		expect(canvasSizePatch(engine, { widthPct: 40, heightPct: 30 }, "heightPct", 50)).toEqual({
			heightPct: 50,
		});
	});
});
