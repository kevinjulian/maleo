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

const colors = {
	red: [255, 0, 0],
	green: [0, 255, 0],
	blue: [0, 0, 255],
	yellow: [255, 255, 0],
	black: [0, 0, 0],
} as const;
const pixels = Buffer.alloc(64 * 32 * 3);
for (let y = 0; y < 32; y++)
	for (let x = 0; x < 64; x++)
		pixels.set(
			y < 16 ? (x < 32 ? colors.red : colors.green) : x < 32 ? colors.blue : colors.yellow,
			(y * 64 + x) * 3,
		);
const source = await sharp(pixels, { raw: { width: 64, height: 32, channels: 3 } })
	.png()
	.toBuffer();
const video = execFileSync(
	"ffmpeg",
	[
		"-v",
		"error",
		"-f",
		"image2pipe",
		"-framerate",
		"30",
		"-i",
		"pipe:0",
		"-vf",
		"tpad=stop_mode=clone:stop_duration=1",
		"-t",
		"1",
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
	],
	{ input: source },
);
const server = Bun.serve({
	port: 0,
	fetch: (request) => {
		const isVideo = new URL(request.url).pathname.endsWith(".mp4");
		return new Response(new Uint8Array(isVideo ? video : source), {
			headers: { "content-type": isVideo ? "video/mp4" : "image/png" },
		});
	},
});
const dir = await mkdtemp(join(tmpdir(), "maleo-source-crop-"));
try {
	const serveUrl = await bundle({
		entryPoint: new URL("../src/index.ts", import.meta.url).pathname,
		outDir: join(dir, "bundle"),
	});
	const left = { xPct: 0, yPct: 0, widthPct: 50, heightPct: 100 };
	const cases: Array<{
		label: string;
		patch: Partial<ClipLayout>;
		expected: Array<keyof typeof colors>;
	}> = [
		{ label: "neutral", patch: {}, expected: ["red", "green", "blue", "yellow"] },
		{
			label: "flip horizontal",
			patch: { flipX: true },
			expected: ["green", "red", "yellow", "blue"],
		},
		{
			label: "flip vertical",
			patch: { flipY: true },
			expected: ["blue", "yellow", "red", "green"],
		},
		{ label: "source crop", patch: { crop: left }, expected: ["red", "red", "blue", "blue"] },
		{
			label: "crop flip rotation",
			patch: { crop: left, flipY: true, rotationDeg: 90 },
			expected: ["red", "blue", "red", "blue"],
		},
		{
			label: "intrinsic crop contain",
			patch: { crop: { xPct: 0, yPct: 0, widthPct: 100, heightPct: 50 }, fit: "contain" },
			expected: ["black", "black", "black", "black"],
		},
	];
	for (const kind of ["image", "video"] as const)
		for (const family of ["overlay", "scene", "multi-scene"])
			for (const item of cases) {
				const url = new URL(kind === "image" ? "/quadrants.png" : "/quadrants.mp4", server.url)
					.href;
				const layout = {
					xPct: 0,
					yPct: 0,
					widthPct: 100,
					heightPct: 100,
					fit: "stretch",
					...item.patch,
				};
				// Per-visual source timing must not discard the scene's crop or flips.
				const visualClips = [
					{ url, kind, startSec: 0, durationSec: 1, primary: true, layout: { playbackRate: 1 } },
				];
				if (family === "multi-scene")
					visualClips.push({
						url,
						kind,
						startSec: 0.8,
						durationSec: 0.2,
						primary: false,
						layout: { playbackRate: 1 },
					});
				const props = storyboardSchema.parse({
					bgColor: "#000000",
					showLabels: false,
					scenes: [
						{
							durationSec: 1,
							movement: "Static",
							image:
								family === "overlay"
									? "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='black'/%3E%3C/svg%3E"
									: url,
							visualClips: family === "overlay" ? [] : visualClips,
							layout: family === "overlay" ? undefined : layout,
						},
					],
					...(family === "overlay"
						? { videoOverlays: [{ kind, url, startSec: 0, durationSec: 1, layout }] }
						: {}),
					...(family === "multi-scene"
						? { visualTimeline: visualClips.map((clip) => ({ ...clip, layout })) }
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
					inputProps: props,
					frame: 6,
					output: path,
					imageFormat: "png",
				});
				const rgb = await sharp(path).removeAlpha().raw().toBuffer();
				// Native H264 YUV conversion shifts RGB primaries by up to four levels.
				const tolerance = kind === "video" ? 5 : 3;
				[
					[16, 16],
					[48, 16],
					[16, 48],
					[48, 48],
				].forEach(([x, y], index) => {
					const actual = [...rgb.subarray((y! * 64 + x!) * 3, (y! * 64 + x!) * 3 + 3)],
						expected = colors[item.expected[index]!];
					assert(
						actual.every((value, channel) => Math.abs(value - expected[channel]!) < tolerance),
						`${kind} ${family} ${item.label} quadrant ${index}: ${actual} != ${expected}`,
					);
				});
				if (item.label === "intrinsic crop contain")
					for (const [x, expected] of [
						[16, colors.red],
						[48, colors.green],
					] as const) {
						const actual = [...rgb.subarray((32 * 64 + x) * 3, (32 * 64 + x) * 3 + 3)];
						assert(
							actual.every((value, channel) => Math.abs(value - expected[channel]!) < tolerance),
							`${kind} ${family} contain center ${actual} != ${expected}`,
						);
					}
				console.log(
					JSON.stringify({
						kind,
						family,
						case: item.label,
						quadrants: item.expected,
						matched: true,
					}),
				);
			}
} finally {
	void server.stop(true);
	await rm(dir, { recursive: true, force: true });
}
