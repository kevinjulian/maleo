#!/usr/bin/env bun
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, renderMedia, selectComposition } from "@remotion/renderer";
import sharp from "sharp";
import { compositionConfigSchema, compositionLayerTiming } from "@maleo/shared";
import { storyboardSchema, type Storyboard } from "../src/schema.ts";

const config = compositionConfigSchema.parse({
	spanSec: 4,
	overlays: [
		{
			preset: "plain",
			content: "Saved mixed Case",
			relStart: 0.5,
			dur: 2.5,
			track: 0,
			style: {
				fontFamily: "Inter",
				fontSize: 24,
				weight: 900,
				fill: "#ffffff",
				align: "left",
				casing: "upper",
				letterSpacing: 1,
			},
			layout: { xPct: 10, yPct: 10, widthPct: 80, heightPct: 25, fit: "contain" },
			anim: {
				tracks: {
					opacity: [
						{ t: 0, v: 0 },
						{ t: 0.2, v: 1 },
						{ t: 1, v: 1 },
					],
				},
			},
		},
		{
			preset: "shape-triangle",
			content: "",
			relStart: 1,
			dur: 2.5,
			track: 1,
			params: { fill: "#ff0000", stroke: "#00ff00", strokeWidth: 3 },
			layout: { xPct: 60, yPct: 60, widthPct: 20, heightPct: 25, fit: "contain" },
			anim: {
				tracks: {
					rotate: [
						{ t: 0, v: 0 },
						{ t: 1, v: 30 },
					],
				},
			},
		},
	],
});
const reloaded = compositionConfigSchema.parse(JSON.parse(JSON.stringify(config)));
assert.deepEqual(reloaded, config);
assert.equal(reloaded.spanSec, 4);
assert.equal(reloaded.overlays[0]!.relStart, 0.5);
const base = {
	scenes: [{ image: "", durationSec: 4, movement: "Static", transition: "cut" }],
	bgColor: "#10182b",
	showLabels: false,
};
const full = { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100, fit: "contain" };
const packed = storyboardSchema.parse({
	...base,
	textOverlays: [
		{
			preset: "motion-comp",
			content: "",
			startSec: 0,
			durationSec: 4,
			layout: full,
			params: reloaded,
		},
	],
});
const unpacked = storyboardSchema.parse({
	...base,
	textOverlays: reloaded.overlays.map((layer) => {
		const { from, durationInFrames } = compositionLayerTiming(layer, reloaded.spanSec, 120, 30);
		return { ...layer, startSec: from / 30, durationSec: durationInFrames / 30 };
	}),
});
const dir = await mkdtemp(join(tmpdir(), "maleo-composition-proof-"));
const serveUrl = await bundle({
	entryPoint: new URL("../src/index.ts", import.meta.url).pathname,
	outDir: join(dir, "bundle"),
});
const browser = await openBrowser("chrome");
try {
	const selected = await selectComposition({
		serveUrl,
		id: "StoryboardWide",
		inputProps: packed,
		puppeteerInstance: browser,
	});
	const render = async (props: Storyboard, frame: number) => {
		const path = join(dir, "frame.png");
		await renderStill({
			serveUrl,
			composition: { ...selected, width: 640, height: 360 },
			inputProps: props,
			frame,
			output: path,
			puppeteerInstance: browser,
		});
		return sharp(path).ensureAlpha().raw().toBuffer();
	};
	const frames = [0, 14, 15, 29, 30, 45, 75, 89, 119];
	for (const frame of frames)
		assert.deepEqual(
			await render(packed, frame),
			await render(unpacked, frame),
			`packed/expanded mismatch at ${frame}`,
		);
	const direct = await render(packed, 45);
	for (const frame of [119, 0, 75]) await render(packed, frame);
	assert.deepEqual(await render(packed, 45), direct, "direct seek changed a frame");
	const keyed = storyboardSchema.parse({
		...base,
		textOverlays: [
			{
				...packed.textOverlays![0],
				layout: {
					...full,
					animation: {
						tracks: {
							opacity: [
								{ t: 0, v: 1 },
								{ t: 2, v: 0 },
								{ t: 4, v: 1 },
							],
						},
					},
				},
			},
		],
	});
	assert.deepEqual(
		await render(keyed, 60),
		await render(storyboardSchema.parse(base), 60),
		"outer clip-local opacity zero must hide all layers",
	);
	const movie = join(dir, "saved-composition.mp4");
	await renderMedia({
		serveUrl,
		composition: { ...selected, width: 640, height: 360 },
		inputProps: packed,
		codec: "h264",
		crf: 18,
		concurrency: 1,
		outputLocation: movie,
		puppeteerInstance: browser,
	});
	const metadata = Bun.spawnSync([
		"ffprobe",
		"-v",
		"error",
		"-select_streams",
		"v:0",
		"-show_entries",
		"stream=width,height,nb_frames,duration",
		"-of",
		"json",
		movie,
	]);
	assert.equal(metadata.exitCode, 0, metadata.stderr.toString());
	const stream = JSON.parse(metadata.stdout.toString()).streams[0];
	assert.equal(stream.width, 640);
	assert.equal(stream.height, 360);
	assert.equal(Number(stream.nb_frames), 120);
	assert.equal(Number(stream.duration), 4);
	const decoded = join(dir, "decoded.png");
	const decode = Bun.spawnSync([
		"ffmpeg",
		"-v",
		"error",
		"-i",
		movie,
		"-vf",
		"select=eq(n\\,45)",
		"-frames:v",
		"1",
		decoded,
	]);
	assert.equal(decode.exitCode, 0, decode.stderr.toString());
	const rgba = await sharp(decoded).ensureAlpha().raw().toBuffer();
	let error = 0;
	for (let i = 0; i < direct.length; i++) error += Math.abs(direct[i]! - rgba[i]!);
	const exportMeanError = error / direct.length;
	assert.ok(exportMeanError < 3, `Decoded export differs from preview: ${exportMeanError}`);
	console.log(
		JSON.stringify({
			frames,
			savedReloaded: true,
			packedEqualsExpanded: true,
			directSeek: true,
			outerOpacityZero: true,
			decodedH264: true,
			exportMeanError,
		}),
	);
} finally {
	await browser.close({ silent: true });
	await rm(dir, { recursive: true, force: true });
}
