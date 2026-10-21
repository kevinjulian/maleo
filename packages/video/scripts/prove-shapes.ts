#!/usr/bin/env bun
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import sharp from "sharp";
import { storyboardSchema, type TemplateParams } from "../src/schema.ts";

const dir = await mkdtemp(join(tmpdir(), "maleo-shapes-"));
const cases: Array<{ preset: string; params: TemplateParams; center: number[]; corner: number[] }> =
	[
		{
			preset: "shape-rect",
			params: { fill: "#ff0000", strokeWidth: 0, radius: 0 },
			center: [255, 0, 0],
			corner: [255, 0, 0],
		},
		{ preset: "shape-circle", params: { fill: "#ff0000" }, center: [255, 0, 0], corner: [0, 0, 0] },
		{
			preset: "shape-rect",
			params: { fill: "transparent", stroke: "#00ff00", strokeWidth: 8, radius: 0 },
			center: [0, 0, 0],
			corner: [0, 255, 0],
		},
		{
			preset: "shape-rect",
			params: { fill: "#ff0000", radius: 20 },
			center: [255, 0, 0],
			corner: [0, 0, 0],
		},
		{
			preset: "shape-circle",
			params: { fill: "#ff0000", opacity: 0 },
			center: [0, 0, 0],
			corner: [0, 0, 0],
		},
	];
try {
	const serveUrl = await bundle({
		entryPoint: new URL("../src/index.ts", import.meta.url).pathname,
		outDir: join(dir, "bundle"),
	});
	for (const item of cases) {
		const props = storyboardSchema.parse({
			bgColor: "#000000",
			showLabels: false,
			scenes: [{ image: "", durationSec: 1, movement: "Static" }],
			textOverlays: [
				{
					content: "",
					preset: item.preset,
					params: item.params,
					startSec: 0,
					durationSec: 1,
					layout: { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 },
				},
			],
		});
		const composition = await selectComposition({
			serveUrl,
			id: "StoryboardWide",
			inputProps: props,
		});
		const path = join(dir, "frame.png");
		await renderStill({
			serveUrl,
			composition: { ...composition, width: 64, height: 64 },
			inputProps: props,
			frame: 6,
			output: path,
			imageFormat: "png",
		});
		const rgb = await sharp(path).removeAlpha().raw().toBuffer();
		for (const [x, y, expected] of [
			[32, 32, item.center],
			[2, 2, item.corner],
		] as const) {
			const actual = [...rgb.subarray((y * 64 + x) * 3, (y * 64 + x) * 3 + 3)];
			assert(
				actual.every((value, channel) => Math.abs(value - expected[channel]!) <= 2),
				`${JSON.stringify(item)} at ${x},${y}: ${actual} != ${expected}`,
			);
		}
		console.log(JSON.stringify({ ...item, matched: true }));
	}
} finally {
	await rm(dir, { recursive: true, force: true });
}
