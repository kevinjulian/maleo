#!/usr/bin/env bun
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import {
	buildRenderStoryboardFromDoc,
	edgeAnimationTracks,
	toTimelineDoc,
	DEFAULT_CAPTIONS,
} from "@maleo/shared";
import { storyboardSchema } from "../src/schema.ts";

const directory = await mkdtemp(join(tmpdir(), "maleo-edge-animation-"));
try {
	const serveUrl = await bundle({
		entryPoint: new URL("../src/index.ts", import.meta.url).pathname,
		outDir: join(directory, "bundle"),
	});
	const image = (color: string) =>
		`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="${color}"/></svg>`)}`;
	const refs = { images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } };
	// Basic primitives stay identical across their full visible span after save/reload.
	for (const preset of ["plain", "shape-rect", "shape-circle", "title"] as const) {
		const doc = toTimelineDoc(
			[
				{
					id: 1,
					name: "Plate",
					shot: "Wide",
					move: "Static",
					vis: "",
					vo: "",
					img: true,
					src: image("blue"),
					dur: 4,
				},
			],
			[],
			[
				{
					id: 2,
					content: "Text",
					preset,
					start: 0,
					dur: 4,
					track: 0,
					params: { fill: "red", radius: 0 },
					layout: { xPct: 10, yPct: 10, widthPct: 80, heightPct: 80, fit: "contain" },
				},
			],
		);
		const inputProps = storyboardSchema.parse(
			buildRenderStoryboardFromDoc({}, refs, JSON.parse(JSON.stringify(doc)), {
				captions: { ...DEFAULT_CAPTIONS, enabled: false },
			}).storyboard,
		);
		const selected = await selectComposition({ serveUrl, id: "StoryboardWide", inputProps });
		const frames: Buffer[] = [];
		for (const frame of [0, 60, 119]) {
			const output = join(directory, `${preset}-${frame}.png`);
			await renderStill({
				serveUrl,
				composition: { ...selected, width: 256, height: 256, durationInFrames: 120 },
				inputProps,
				frame,
				output,
				imageFormat: "png",
			});
			frames.push(
				execFileSync("ffmpeg", [
					"-v",
					"error",
					"-i",
					output,
					"-frames:v",
					"1",
					"-pix_fmt",
					"rgb24",
					"-f",
					"rawvideo",
					"pipe:1",
				]),
			);
		}
		if (preset === "title")
			assert.notDeepEqual(frames[0], frames[1], "Existing Title retains its built-in reveal");
		else {
			assert.deepEqual(frames[0], frames[1], `${preset}: first frame equals middle`);
			assert.deepEqual(frames[1], frames[2], `${preset}: last frame equals middle`);
			assert(
				frames[1]!.some((v, i) => i % 3 === 0 && v > 200),
				`${preset}: foreground renders, not only blue plate`,
			);
		}
		console.log(JSON.stringify({ preset, reloaded: true, static: preset !== "title" }));
	}
	for (const preset of ["fade", "slide", "zoom"] as const) {
		const entered = { tracks: edgeAnimationTracks(undefined, "in", preset, 0.5, 4, {}) };
		const animation = {
			tracks: { ...entered.tracks, ...edgeAnimationTracks(entered, "out", preset, 0.5, 4, {}) },
		};
		const doc = toTimelineDoc(
			[
				{
					id: 1,
					name: "Plate",
					shot: "Wide",
					move: "Static",
					vis: "",
					vo: "",
					img: true,
					src: image("blue"),
					dur: 4,
				},
			],
			[
				{
					id: 2,
					label: "Animated",
					kind: "image",
					url: image("red"),
					start: 0,
					dur: 4,
					track: 0,
					layout: { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100, fit: "stretch", animation },
				},
			],
		);
		const built = buildRenderStoryboardFromDoc({}, refs, JSON.parse(JSON.stringify(doc)), {
			captions: { ...DEFAULT_CAPTIONS, enabled: false },
		}).storyboard;
		const inputProps = storyboardSchema.parse(built);
		const selected = await selectComposition({ serveUrl, id: "StoryboardWide", inputProps });
		const pixel = async (frame: number, x: number) => {
			const output = join(directory, `${preset}-${frame}.png`);
			await renderStill({
				serveUrl,
				composition: { ...selected, width: 128, height: 128, durationInFrames: 120 },
				inputProps,
				frame,
				output,
				imageFormat: "png",
			});
			const pixels = execFileSync("ffmpeg", [
				"-v",
				"error",
				"-i",
				output,
				"-frames:v",
				"1",
				"-pix_fmt",
				"rgb24",
				"-f",
				"rawvideo",
				"pipe:1",
			]);
			return [...pixels.subarray((64 * 128 + x) * 3, (64 * 128 + x) * 3 + 3)];
		};
		const x = preset === "fade" ? 64 : 124;
		const start = await pixel(0, x),
			middle = await pixel(60, x),
			end = await pixel(119, x);
		assert(
			start[2]! > 230 && start[0]! < 20,
			`${preset}: entrance must expose underlying blue plate: ${start}`,
		);
		assert(
			middle[0]! > 230 && middle[2]! < 20,
			`${preset}: stable middle must show red clip: ${middle}`,
		);
		assert(
			end[2]! > 230 && end[0]! < 20,
			`${preset}: exit must expose underlying blue plate: ${end}`,
		);
		if (preset === "fade") {
			const half = await pixel(7, 64);
			assert(
				half[0]! > 80 && half[0]! < 170 && half[2]! > 80 && half[2]! < 170,
				`Fade blends into underlying plate, not black: ${half}`,
			);
		}
		console.log(JSON.stringify({ preset, reloaded: true, start, middle, end }));
	}
} finally {
	await rm(directory, { recursive: true, force: true });
}
