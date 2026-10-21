#!/usr/bin/env bun
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import sharp from "sharp";
import { storyboardSchema } from "../src/schema.ts";

// Production decoder must sample the retained source, not restart at zero.
const cases: Array<{ storyboard: unknown; original: unknown; sourceTime: number; label: string }> =
	await Bun.file(process.argv[2]!).json();
const dir = await mkdtemp(join(tmpdir(), "maleo-source-cut-render-"));
const path = join(dir, "numbered.mp4");
execFileSync("ffmpeg", [
	"-v",
	"error",
	"-f",
	"lavfi",
	"-i",
	"nullsrc=s=32x32:r=30:d=8",
	"-vf",
	"format=rgb24,geq=r=N:g=N:b=N",
	"-c:v",
	"libx264",
	"-crf",
	"0",
	"-pix_fmt",
	"yuv420p",
	path,
]);
const server = Bun.serve({ port: 0, fetch: () => new Response(Bun.file(path)) });
try {
	const serveUrl = await bundle({
		entryPoint: new URL("../src/index.ts", import.meta.url).pathname,
		outDir: join(dir, "bundle"),
	});
	for (const item of cases) {
		const storyboard = JSON.parse(
			JSON.stringify(item.storyboard).replaceAll(
				"synthetic-numbered.mkv",
				new URL("/numbered.mp4", server.url).href,
			),
		);
		const props = storyboardSchema.parse(storyboard);
		const composition = await selectComposition({
			serveUrl,
			id: "StoryboardWide",
			inputProps: props,
		});
		const output = join(dir, "frame.png");
		await renderStill({
			serveUrl,
			composition: { ...composition, width: 32, height: 32 },
			inputProps: props,
			frame: 8,
			output,
			imageFormat: "png",
		});
		const rgb = await sharp(output).removeAlpha().raw().toBuffer();
		const original = storyboardSchema.parse(
			JSON.parse(
				JSON.stringify(item.original).replaceAll(
					"synthetic-numbered.mkv",
					new URL("/numbered.mp4", server.url).href,
				),
			),
		);
		const originalComposition = await selectComposition({
			serveUrl,
			id: "StoryboardWide",
			inputProps: original,
		});
		await renderStill({
			serveUrl,
			composition: { ...originalComposition, width: 32, height: 32 },
			inputProps: original,
			frame: 16,
			output,
			imageFormat: "png",
		});
		const baseline = await sharp(output).removeAlpha().raw().toBuffer();
		assert.deepEqual(rgb, baseline, `${item.label}: cut changed retained production frame`);
		assert(rgb[0]! > 25, `${item.label}: playback restarted at source zero`);
		console.log(
			JSON.stringify({
				label: item.label,
				retainedFrame: rgb[0],
				originalFrame: baseline[0],
				identical: true,
			}),
		);
	}
} finally {
	void server.stop(true);
	await rm(dir, { recursive: true, force: true });
}
