#!/usr/bin/env bun
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import sharp from "sharp";
import type { ClipLayout } from "@maleo/shared";
import { storyboardSchema } from "../src/schema.ts";

const image = (color: string) =>
	`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>`)}`;
const background = [80, 120, 160],
	foreground = [160, 80, 40];
const mask = {
	shape: "rectangle" as const,
	xPct: 25,
	yPct: 25,
	widthPct: 50,
	heightPct: 50,
	rotationDeg: 0,
	featherPct: 0,
	inverted: false,
};
const video = execFileSync("ffmpeg", [
	"-v",
	"error",
	"-f",
	"lavfi",
	"-i",
	"color=c=0xa05028:s=64x64:r=30:d=1",
	"-c:v",
	"libx264",
	"-crf",
	"0",
	"-pix_fmt",
	"yuv420p",
	"-movflags",
	"frag_keyframe+empty_moov",
	"-f",
	"mp4",
	"pipe:1",
]);
const server = Bun.serve({
	port: 0,
	fetch: () => new Response(new Uint8Array(video), { headers: { "content-type": "video/mp4" } }),
});
const dir = await mkdtemp(join(tmpdir(), "maleo-clip-compositing-"));
try {
	const serveUrl = await bundle({
		entryPoint: new URL("../src/index.ts", import.meta.url).pathname,
		outDir: join(dir, "bundle"),
	});
	const cases: Array<{
		label: string;
		patch: Partial<ClipLayout>;
		samples: Array<[number, number, number[]]>;
	}> = [
		{
			label: "geometry after mask reset",
			patch: { xPct: 25, yPct: 25, widthPct: 50, heightPct: 50 },
			samples: [
				[32, 32, foreground],
				[4, 4, background],
			],
		},
		{
			label: "reset inherited controls",
			patch: {
				mask: null,
				color: { brightness: 1, contrast: 1, saturation: 1 },
				blendMode: "normal",
			},
			samples: [
				[32, 32, foreground],
				[4, 4, foreground],
			],
		},
		{
			label: "neutral",
			patch: {},
			samples: [
				[32, 32, foreground],
				[4, 4, foreground],
			],
		},
		{
			label: "rectangle",
			patch: { mask },
			samples: [
				[32, 32, foreground],
				[4, 4, background],
			],
		},
		{
			label: "ellipse",
			patch: { mask: { ...mask, shape: "ellipse" } },
			samples: [
				[32, 32, foreground],
				[17, 17, background],
			],
		},
		{
			label: "inverted",
			patch: { mask: { ...mask, inverted: true } },
			samples: [
				[32, 32, background],
				[4, 4, foreground],
			],
		},
		{
			label: "rotated mask",
			patch: { mask: { ...mask, widthPct: 50, heightPct: 25, yPct: 37.5, rotationDeg: 90 } },
			samples: [
				[32, 20, foreground],
				[20, 32, background],
			],
		},
		{
			label: "brightness",
			patch: { color: { brightness: 0.5, contrast: 1, saturation: 1 } },
			samples: [[32, 32, foreground.map((v) => v / 2)]],
		},
		{
			label: "contrast",
			patch: { color: { brightness: 1, contrast: 0, saturation: 1 } },
			samples: [[32, 32, [128, 128, 128]]],
		},
		{
			label: "saturation",
			patch: { color: { brightness: 1, contrast: 1, saturation: 0 } },
			samples: [[32, 32, [94, 94, 94]]],
		},
		{
			label: "multiply",
			patch: { blendMode: "multiply" },
			samples: [[32, 32, foreground.map((v, i) => (v * background[i]!) / 255)]],
		},
		{
			label: "screen",
			patch: { blendMode: "screen" },
			samples: [
				[32, 32, foreground.map((v, i) => 255 - ((255 - v) * (255 - background[i]!)) / 255)],
			],
		},
		{
			label: "feather",
			patch: { mask: { ...mask, featherPct: 12 } },
			samples: [
				[32, 32, foreground],
				[4, 4, background],
			],
		},
		{
			label: "crop mask rotation",
			patch: { crop: { xPct: 0, yPct: 0, widthPct: 50, heightPct: 100 }, mask, rotationDeg: 90 },
			samples: [
				[32, 32, foreground],
				[4, 4, background],
			],
		},
	];
	for (const kind of ["image", "video"] as const)
		for (const family of ["overlay", "scene", "visual-timeline"] as const)
			for (const item of cases) {
				const layout = {
					xPct: 0,
					yPct: 0,
					widthPct: 100,
					heightPct: 100,
					fit: "stretch",
					...item.patch,
				};
				const clip = {
					kind,
					url: kind === "image" ? image("rgb(160,80,40)") : server.url.href,
					startSec: 0,
					durationSec: 1,
					layout,
				};
				const props = storyboardSchema.parse({
					bgColor: "rgb(80,120,160)",
					showLabels: false,
					scenes: [
						{
							durationSec: 1,
							movement: "Static",
							image: family === "overlay" ? image("rgb(80,120,160)") : clip.url,
							...(family === "scene"
								? {
										visualClips: [clip],
										layout:
											item.label === "reset inherited controls"
												? {
														mask,
														color: { brightness: 0, contrast: 1, saturation: 1 },
														blendMode: "multiply",
													}
												: undefined,
									}
								: {}),
						},
					],
					...(family === "overlay"
						? {
								videoOverlays: [
									clip,
									{
										kind: "image",
										url: image("rgb(30,200,60)"),
										track: 2,
										startSec: 0,
										durationSec: 1,
										layout: { xPct: 75, yPct: 0, widthPct: 25, heightPct: 100, fit: "stretch" },
									},
								],
							}
						: {}),
					...(family === "visual-timeline"
						? {
								visualTimeline: [
									{ ...clip, kind: "image", url: image("rgb(80,120,160)"), layout: undefined },
									clip,
								],
							}
						: {}),
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
					inputProps: JSON.parse(JSON.stringify(props)),
					frame: 6,
					output: path,
					imageFormat: "png",
				});
				const rgb = await sharp(path).removeAlpha().raw().toBuffer();
				const pixel = (x: number, y: number) => [
					...rgb.subarray((y * 64 + x) * 3, (y * 64 + x) * 3 + 3),
				];
				for (const [x, y, expected] of item.samples) {
					const actual = pixel(x, y);
					assert(
						actual.every((v, i) => Math.abs(v - expected[i]!) < (kind === "video" ? 6 : 4)),
						`${family} ${item.label} (${x},${y}): ${actual} != ${expected}`,
					);
				}
				if (family === "overlay")
					assert(
						pixel(60, 32).every((v, i) => Math.abs(v - [30, 200, 60][i]!) < 4),
						"Compositing leaked into later sibling",
					);
				if (item.label === "feather") {
					const edge = pixel(16, 32);
					assert(
						edge[0]! > background[0]! + 10 && edge[0]! < foreground[0]! - 10,
						`${family} missing soft edge: ${edge}`,
					);
				}
				console.log(JSON.stringify({ kind, family, case: item.label, matched: true }));
			}
} finally {
	void server.stop(true);
	await rm(dir, { recursive: true, force: true });
}
