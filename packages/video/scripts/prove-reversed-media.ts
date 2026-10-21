#!/usr/bin/env bun
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import sharp from "sharp";
import {
	buildRenderStoryboard,
	DEFAULT_CAPTIONS,
	DEFAULT_MEDIA_IMPORT_LIMITS,
	type ClipLayout,
	type Scene,
} from "@maleo/shared";
import { reverseSelectedSource } from "../../media/src/processing/reverse.ts";
import { storyboardSchema } from "../src/schema.ts";
import { decodePcm, peakSeconds } from "./pcm.ts";

// Verification orchestration only: actual worker operation feeds production composition.
const directory = await mkdtemp(join(tmpdir(), "maleo-reverse-render-"));
const original = join(directory, "original.mp4"),
	derivative = join(directory, "reverse.mp4");
let server: ReturnType<typeof Bun.serve> | undefined;
try {
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"nullsrc=s=32x32:r=30:d=5",
		"-f",
		"lavfi",
		"-i",
		"aevalsrc=if(between(t\\,1.2\\,1.23)\\,0.8*sin(2*PI*440*t)\\,0):s=48000:d=5",
		"-vf",
		"format=rgb24,geq=r=N:g=N:b=N",
		"-c:v",
		"libx264",
		"-crf",
		"0",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-y",
		original,
	]);
	await reverseSelectedSource(
		original,
		derivative,
		{
			kind: "video",
			originalFilename: "Original.mp4",
			byteSize: Bun.file(original).size,
			width: 32,
			height: 32,
			duration: 5,
			hasAudio: true,
		},
		{
			type: "reverse",
			startSec: 1,
			durationSec: 2,
		},
		DEFAULT_MEDIA_IMPORT_LIMITS,
		AbortSignal.timeout(60_000),
	);
	const sourceUrl = "/api/media/11111111-1111-4111-8111-111111111111",
		derivativeUrl = "/api/media/22222222-2222-4222-8222-222222222222";
	server = Bun.serve({
		port: 0,
		fetch: (request) =>
			new Response(
				Bun.file(new URL(request.url).pathname === derivativeUrl ? derivative : original),
			),
	});
	const serveUrl = await bundle({
		entryPoint: new URL("../src/index.ts", import.meta.url).pathname,
		outDir: join(directory, "bundle"),
	});
	const layout: ClipLayout = {
		xPct: 0,
		yPct: 0,
		widthPct: 100,
		heightPct: 100,
		fit: "stretch",
		reverse: true,
		reverseMedia: {
			url: derivativeUrl,
			sourceUrl,
			sourceRevision: "proof",
			startSec: 1,
			durationSec: 2,
		},
	};
	const visual = {
		id: "video",
		kind: "video" as const,
		url: sourceUrl,
		label: "Reverse",
		startSec: 0,
		durationSec: 2,
		mediaStartSec: 1,
		primary: true,
		layout,
	};
	const scene: Scene = {
		id: 1,
		name: "Reverse",
		shot: "Wide",
		move: "Static",
		vis: "",
		vo: "",
		img: true,
		src: "",
		dur: 2,
		visualClips: [visual],
	};
	const refs = { images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } };
	for (const path of ["overlay", "single-scene", "multi-scene"] as const) {
		const scenes =
			path === "overlay"
				? [
						{
							...scene,
							visualClips: [],
							src: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><rect width='32' height='32'/></svg>",
						},
					]
				: path === "single-scene"
					? [scene]
					: [
							{
								...scene,
								visualClips: [
									{
										...visual,
										durationSec: 1,
									},
									{
										...visual,
										id: "second",
										startSec: 1,
										durationSec: 1,
										mediaStartSec: 2,
										primary: false,
									},
								],
							},
						];
		const built = buildRenderStoryboard({ format: "16:9" }, refs, scenes, {
			captions: DEFAULT_CAPTIONS,
			videoOverlays:
				path === "overlay"
					? [
							{
								id: 1,
								kind: "video",
								url: sourceUrl,
								start: 0,
								dur: 2,
								mediaStartSec: 1,
								layout,
								volume: 1,
							},
						]
					: [],
		}).storyboard;
		const props = storyboardSchema.parse(
			JSON.parse(
				JSON.stringify(built)
					.replaceAll(derivativeUrl, new URL(derivativeUrl, server.url).href)
					.replaceAll(sourceUrl, new URL(sourceUrl, server.url).href),
			),
		);
		const selected = await selectComposition({ serveUrl, id: "StoryboardWide", inputProps: props });
		const composition = { ...selected, width: 32, height: 32, durationInFrames: 60 };
		for (const frame of [0, 15, 29, 30, 45, 59]) {
			const output = join(directory, "frame.png");
			await renderStill({
				serveUrl,
				composition,
				inputProps: props,
				frame,
				output,
				imageFormat: "png",
			});
			const rgb = await sharp(output).removeAlpha().raw().toBuffer();
			// Multi-scene splits keep earlier/later original windows, reversed independently.
			const expected =
				path === "multi-scene" ? (frame < 30 ? 59 - frame : 119 - frame) : 89 - frame;
			assert(
				Math.abs(rgb[0]! - expected) <= 3,
				`${path} frame ${frame}: got ${rgb[0]}, expected original ${expected}`,
			);
		}
		if (path === "overlay") {
			const output = join(directory, "render.mp4");
			await renderMedia({
				serveUrl,
				composition,
				inputProps: props,
				codec: "h264",
				outputLocation: output,
				concurrency: 1,
			});
			const audio = decodePcm(output);
			assert(
				peakSeconds(audio, 1.74, 1.84, Math.round) > 0.5,
				"Production source audio did not reverse",
			);
			assert(peakSeconds(audio, 0.15, 0.3, Math.round) < 0.05, "Production audio remained forward");
		}
		console.log(
			JSON.stringify({ path, frames: 6, tolerance: 3, audibleReverse: path === "overlay" }),
		);
	}
} finally {
	void server?.stop(true);
	await rm(directory, { recursive: true, force: true });
}
