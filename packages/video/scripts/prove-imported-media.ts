#!/usr/bin/env bun
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { storyboardSchema } from "../src/schema.ts";

// Native synthetic sources; real production composition, decoder and muxer.
const dir = await mkdtemp(join(tmpdir(), "maleo-import-render-"));
const videoPath = join(dir, "source.mp4"),
	audioPath = join(dir, "source.m4a"),
	output = join(dir, "render.mp4");
const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-v", "error", ...args]);
ffmpeg([
	"-f",
	"lavfi",
	"-i",
	"color=c=blue:s=320x180:r=30:d=1.5",
	"-c:v",
	"libx264",
	"-pix_fmt",
	"yuv420p",
	videoPath,
]);
ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=1.5", "-c:a", "aac", audioPath]);
const server = Bun.serve({
	port: 0,
	fetch: (request) =>
		new Response(Bun.file(new URL(request.url).pathname.endsWith(".mp4") ? videoPath : audioPath)),
});
try {
	const defaults = storyboardSchema.parse({
		scenes: [
			{
				durationSec: 1.5,
				movement: "Static",
				image:
					"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='black'/%3E%3C/svg%3E",
			},
		],
		bgColor: "#000000",
		showLabels: false,
		videoOverlays: [
			{
				kind: "video",
				url: new URL("/source.mp4", server.url).href,
				startSec: 0,
				durationSec: 1.5,
				layout: { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100, fit: "stretch" },
			},
		],
		audioOverlays: [
			{
				kind: "voiceover",
				url: new URL("/source.m4a", server.url).href,
				startSec: 0,
				durationSec: 1.5,
				volume: 1,
			},
		],
	});
	const supplied = process.argv[2]
		? storyboardSchema.parse(await Bun.file(process.argv[2]).json())
		: undefined;
	// Caller validates repaired identities; this fixture server supplies their synthetic bytes.
	const props = supplied
		? {
				...supplied,
				videoOverlays: supplied.videoOverlays.map((item) => ({
					...item,
					url: new URL("/source.mp4", server.url).href,
				})),
				audioOverlays: supplied.audioOverlays.map((item) => ({
					...item,
					url: new URL("/source.m4a", server.url).href,
				})),
			}
		: defaults;
	const serveUrl = await bundle({
		entryPoint: new URL("../src/index.ts", import.meta.url).pathname,
		outDir: join(dir, "bundle"),
	});
	const composition = await selectComposition({
		serveUrl,
		id: "StoryboardWide",
		inputProps: props,
	});
	await renderMedia({
		serveUrl,
		composition: { ...composition, width: 320, height: 180 },
		inputProps: props,
		codec: "h264",
		outputLocation: output,
		concurrency: 1,
	});
	const duration = Number(
		execFileSync(
			"ffprobe",
			["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", output],
			{ encoding: "utf8" },
		),
	);
	assert(Math.abs(duration - 1.5) < 0.1, `Rendered duration ${duration}`);
	const rgb = ffmpeg([
		"-ss",
		"0.75",
		"-i",
		output,
		"-frames:v",
		"1",
		"-vf",
		"scale=1:1",
		"-pix_fmt",
		"rgb24",
		"-f",
		"rawvideo",
		"pipe:1",
	]);
	assert(rgb[2]! > 180 && rgb[0]! < 30 && rgb[1]! < 30, `Wrong video pixels ${[...rgb]}`);
	const pcm = ffmpeg([
		"-ss",
		"0.25",
		"-t",
		"1",
		"-i",
		output,
		"-vn",
		"-ac",
		"1",
		"-ar",
		"44100",
		"-f",
		"f32le",
		"pipe:1",
	]);
	let crossings = 0,
		peak = 0,
		previous = 0;
	for (let i = 0; i < pcm.length; i += 4) {
		const sample = pcm.readFloatLE(i);
		if (previous <= 0 && sample > 0) crossings++;
		peak = Math.max(peak, Math.abs(sample));
		previous = sample;
	}
	const frequency = crossings / (pcm.length / 4 / 44100);
	assert(
		Math.abs(frequency - 440) < 10 && peak > 0.05,
		`Wrong soundtrack ${frequency}Hz peak ${peak}`,
	);
	console.log(
		JSON.stringify({
			composition: composition.id,
			resolution: "320x180",
			duration,
			rgb: [...rgb],
			frequency,
			peak,
		}),
	);
} finally {
	void server.stop(true);
	await rm(dir, { recursive: true, force: true });
}
