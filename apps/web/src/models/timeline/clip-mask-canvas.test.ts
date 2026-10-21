import { expect, test } from "vite-plus/test";
import { maskCanvasLayout, maskFromCanvas } from "./clip-mask-canvas.ts";
import { canvasClipLayout, patchCanvasLayout } from "./canvas-transform.ts";
import { storyboardJson } from "@models/storyboard/document-wire.ts";
import { readStoryboardDocument, toTimelineDoc } from "@maleo/shared";

const mask = {
	shape: "ellipse" as const,
	xPct: 20,
	yPct: 30,
	widthPct: 40,
	heightPct: 50,
	rotationDeg: 30,
	featherPct: 12,
	inverted: true,
};
test("mask handles invert rotated rectangular clip coordinates including animated scale", () => {
	const layout = {
		xPct: 10,
		yPct: 20,
		widthPct: 40,
		heightPct: 60,
		rotationDeg: 75,
		fit: "stretch" as const,
	};
	const canvas = { w: 800, h: 450 },
		box = maskCanvasLayout(layout, mask, canvas, 1.7);
	const result = maskFromCanvas(layout, mask, box, canvas, 1.7);
	for (const property of ["xPct", "yPct", "widthPct", "heightPct", "rotationDeg"] as const)
		expect(result[property]).toBeCloseTo(mask[property], 8);
	const clamped = maskFromCanvas(layout, mask, { ...box, xPct: 200, widthPct: 500 }, canvas, 1.7);
	expect(clamped.xPct).toBe(0);
	expect(clamped.widthPct).toBe(100);
});
test("compositing writes one scene source; save/reset preserve siblings and refuse locks", () => {
	const doc = toTimelineDoc([
		{
			id: 1,
			name: "Scene",
			shot: "Wide",
			move: "Static",
			vis: "",
			vo: "",
			img: true,
			src: "a.png",
			dur: 4,
			visualClips: ["a", "b"].map((id) => ({
				id,
				kind: "image",
				label: id,
				url: `${id}.png`,
				startSec: 0,
				durationSec: 4,
			})),
		},
	]);
	const target = { source: "scene" as const, id: 1, visualId: "b" };
	const patch = {
		mask,
		color: { brightness: 0.5, contrast: 1.2, saturation: 1.5 },
		blendMode: "screen" as const,
	};
	const edited = patchCanvasLayout(doc, target, patch);
	const persisted = {
		...edited,
		clips: readStoryboardDocument(
			JSON.parse(JSON.stringify(storyboardJson("video", {}, { clips: edited.clips }))),
		).doc.clips,
	};
	expect(canvasClipLayout(persisted, target).layout).toMatchObject(patch);
	expect(canvasClipLayout(persisted, { ...target, visualId: "a" }).layout?.mask).toBeUndefined();
	const reset = patchCanvasLayout(persisted, target, {
		mask: null,
		color: { brightness: 1, contrast: 1, saturation: 1 },
		blendMode: "normal",
	});
	expect(canvasClipLayout(reset, target).layout?.mask).toBeNull();
	expect(patchCanvasLayout(persisted, target, { mask: { ...mask, widthPct: 99 } })).toBe(persisted);
	expect(() =>
		storyboardJson(
			"video",
			{},
			{
				clips: persisted.clips.map((c) =>
					c.scene
						? {
								...c,
								scene: {
									...c.scene,
									layout: {
										xPct: 0,
										yPct: 0,
										widthPct: 100,
										fit: "cover",
										color: {
											brightness: NaN,
											contrast: 1,
											saturation: 1,
										},
									},
								},
							}
						: c,
				),
			},
		),
	).toThrow("invalid color");
	const locked = { ...persisted, trackFlags: { [-1]: { locked: true } } };
	expect(patchCanvasLayout(locked, target, { mask: undefined })).toBe(locked);
});

test("removing an inherited scene mask stays removed after reload", () => {
	const doc = toTimelineDoc([
		{
			id: 1,
			name: "Scene",
			shot: "Wide",
			move: "Static",
			vis: "",
			vo: "",
			img: true,
			src: "a.png",
			dur: 4,
			layout: { xPct: 0, yPct: 0, widthPct: 100, fit: "cover", mask },
			visualClips: [
				{ id: "a", kind: "image", label: "Image", url: "a.png", startSec: 0, durationSec: 4 },
			],
		},
	]);
	const target = { source: "scene" as const, id: 1, visualId: "a" };
	const edited = patchCanvasLayout(doc, target, { mask: null });
	const loaded = {
		...edited,
		clips: readStoryboardDocument(storyboardJson("video", {}, { clips: edited.clips })).doc.clips,
	};
	expect(canvasClipLayout(loaded, target).layout?.mask).toBeNull();
});
