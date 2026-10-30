/// <reference types="node" />
// Author synthetic video inputs. References still come only from the production image.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { storyboardSchema } from "../../../../packages/video/src/schema.ts";

const output = resolve(process.argv[2] ?? "data/video-parity-corpus");
const source = resolve(output, "source");
mkdirSync(source, { recursive: true });
const width = 160;
const height = 96;
const raw = Buffer.alloc(width * height * 3 * 24);
for (let frame = 0; frame < 24; frame++) {
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const at = ((frame * height + y) * width + x) * 3;
			const cell = ((frame >> Math.floor(x / 20)) & 1) * 255;
			raw[at] = y < 32 ? cell : 32 + x;
			raw[at + 1] = y < 32 ? cell : 32 + frame * 7;
			raw[at + 2] = y < 32 ? cell : 32 + y * 2;
		}
	}
}
const movie = resolve(source, "numbered.mp4");
const encode = [
	"-v",
	"error",
	"-y",
	"-f",
	"rawvideo",
	"-pixel_format",
	"rgb24",
	"-video_size",
	"160x96",
	"-framerate",
	"12",
	"-i",
	"pipe:0",
	"-c:v",
	"libx264",
	"-preset",
	"veryfast",
	"-crf",
	"18",
	"-pix_fmt",
	"yuv420p",
	"-threads",
	"1",
	"-fflags",
	"+bitexact",
	"-flags:v",
	"+bitexact",
	movie,
];
execFileSync("ffmpeg", encode, { input: raw });
const timeBase = execFileSync(
	"ffprobe",
	[
		"-v",
		"error",
		"-select_streams",
		"v:0",
		"-show_entries",
		"stream=time_base",
		"-of",
		"default=nw=1:nk=1",
		movie,
	],
	{ encoding: "utf8" },
)
	.trim()
	.split("/")
	.map(Number);
assert.equal(timeBase.length, 2);
assert(timeBase.every((value) => Number.isFinite(value) && value > 0));
const timestamps = execFileSync(
	"ffprobe",
	[
		"-v",
		"error",
		"-select_streams",
		"v:0",
		"-show_frames",
		"-show_entries",
		"frame=best_effort_timestamp",
		"-of",
		"csv=p=0",
		movie,
	],
	{ encoding: "utf8" },
)
	.trim()
	.split("\n")
	.filter((line) => line.trim())
	.map((line) => Number(line.split(",")[0]));
assert.equal(timestamps.length, 24);
const positions = timestamps.map(
	(timestamp) => ((timestamp - timestamps[0]) * timeBase[0]) / timeBase[1],
);
positions.forEach((position, index) => assert.equal(position, index / 12));
execFileSync("ffmpeg", [
	"-v",
	"error",
	"-y",
	"-i",
	movie,
	"-fps_mode",
	"passthrough",
	"-start_number",
	"0",
	resolve(source, "%02d.png"),
]);
const rgba = execFileSync(
	"ffmpeg",
	["-v", "error", "-i", movie, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"],
	{ maxBuffer: 4 * 1024 * 1024 },
);
assert.equal(rgba.length, width * height * 4 * 24);
for (let frame = 0; frame < 24; frame++) {
	let id = 0;
	for (let bit = 0; bit < 8; bit++) {
		const at = ((frame * height + 16) * width + bit * 20 + 10) * 4;
		if ((rgba[at] + rgba[at + 1] + rgba[at + 2]) / 3 > 128) id |= 1 << bit;
	}
	assert.equal(id, frame);
}
const url = "media/numbered.mp4";
const revision = createHash("sha256").update(readFileSync(movie)).digest("hex");
const clip = (extra = {}) => ({ url, kind: "video", startSec: 0, durationSec: 2, ...extra });
const base = { scenes: [], hideBase: true, showLabels: false, bgColor: "#193456" };
const layout = { xPct: 10, yPct: 10, widthPct: 80, heightPct: 75, fit: "stretch" };
const frames = [0, 5, 12, 24, 36, 45, 59];
const cases: {
	name: string;
	frames: number[];
	options: string[];
	storyboard: Record<string, unknown>;
}[] = [
	{
		name: "video-scene-clock",
		frames,
		options: ["video.scene", "video.source-rate", "video.selected-end-hold"],
		storyboard: {
			...base,
			hideBase: false,
			scenes: [
				{
					image: "",
					durationSec: 2,
					movement: "Zoom In",
					transition: "cut",
					visualClips: [
						clip({
							mediaStartSec: 0.2,
							sourceDurationSec: 1.2,
							layout: { ...layout, playbackRate: 1.5 },
						}),
					],
				},
			],
		},
	},
	{
		name: "video-timeline-crop",
		frames,
		options: ["video.timeline", "video.crop", "video.flip", "video.fit"],
		storyboard: {
			...base,
			hideBase: false,
			visualTimeline: [
				clip({
					mediaStartSec: 0.25,
					sourceDurationSec: 1.75,
					layout: {
						...layout,
						fit: "cover",
						flipX: true,
						flipY: true,
						crop: { xPct: 10, yPct: 15, widthPct: 65, heightPct: 60 },
					},
				}),
			],
		},
	},
	{
		name: "video-overlay-mask-color",
		frames,
		options: ["video.overlay", "video.mask", "video.feather", "video.color", "video.rotation"],
		storyboard: {
			...base,
			videoOverlays: [
				clip({
					layout: {
						...layout,
						rotationDeg: 12,
						color: { brightness: 0.8, contrast: 1.3, saturation: 0.5 },
						mask: {
							shape: "ellipse",
							xPct: 10,
							yPct: 15,
							widthPct: 80,
							heightPct: 65,
							rotationDeg: -20,
							featherPct: 4,
							inverted: false,
						},
					},
				}),
			],
		},
	},
	{
		name: "video-overlap-motion",
		frames: [0, 5, 12, 24, 36, 41],
		options: ["video.simultaneous-source-times", "video.blend", "video.motion"],
		storyboard: {
			...base,
			videoOverlays: [
				clip({
					durationSec: 1.4,
					layout: {
						...layout,
						widthPct: 65,
						opacity: 0.8,
						blendMode: "screen",
						animation: {
							tracks: {
								xPct: [
									{ t: 0, v: 5 },
									{ t: 1.3, v: 25, easing: "in-out" },
								],
								rotationDeg: [
									{ t: 0, v: -10 },
									{ t: 1.3, v: 15 },
								],
							},
						},
					},
				}),
				clip({
					durationSec: 1.4,
					mediaStartSec: 0.5,
					track: 1,
					layout: {
						...layout,
						xPct: 30,
						yPct: 25,
						widthPct: 60,
						heightPct: 50,
						opacity: 0.7,
						blendMode: "multiply",
					},
				}),
			],
		},
	},
	{
		name: "video-reveal",
		frames: [0, 6, 7, 15, 24, 25, 26, 47, 48, 59],
		options: ["video.reveal", "video.reveal-phase", "video.texture"],
		storyboard: {
			...base,
			videoOverlays: [
				clip({
					layout,
					reveal: {
						type: "wipe",
						direction: "left",
						phase: "black_then_color",
						durationSec: 1.4,
						delaySec: 0.2,
						texture: "paper",
					},
				}),
			],
		},
	},
	{
		name: "video-timeline-transition",
		frames: [0, 21, 22, 23, 28, 33, 34, 45, 51],
		options: ["video.timeline-transition"],
		storyboard: {
			...base,
			hideBase: false,
			visualTimeline: [
				clip({ durationSec: 0.75, sourceDurationSec: 0.75, layout }),
				clip({
					startSec: 0.75,
					durationSec: 1,
					sourceDurationSec: 1,
					mediaStartSec: 0.5,
					transition: "fade",
					transitionDurSec: 0.4,
					layout,
				}),
			],
		},
	},
	{
		name: "video-scene-transition",
		frames: [0, 17, 18, 19, 23, 29, 30, 40],
		options: ["video.scene-transition"],
		storyboard: {
			...base,
			hideBase: false,
			scenes: [
				{
					image: "",
					durationSec: 1,
					transition: "cut",
					visualClips: [clip({ durationSec: 1, sourceDurationSec: 1, layout })],
				},
				{
					image: "",
					durationSec: 1,
					transition: "slide",
					transitionDurSec: 0.4,
					visualClips: [clip({ durationSec: 1, sourceDurationSec: 1, mediaStartSec: 0.5, layout })],
				},
			],
		},
	},
];
const companions = new Map<string, string>();
for (const entry of [...cases]) {
	if (!["video-overlap-motion", "video-overlay-mask-color"].includes(entry.name)) continue;
	const name = `${entry.name}-geometry`;
	companions.set(entry.name, name);
	cases.push({
		...entry,
		name,
		options: [`${entry.name}.geometry`],
		storyboard: {
			...entry.storyboard,
			hideBase: false,
			bgColor: entry.name === "video-overlap-motion" ? "#193456" : "#ffffff",
			scenes: [{ image: "", durationSec: 2, transition: "cut" }],
		},
	});
}
for (const entry of cases) {
	storyboardSchema.parse(entry.storyboard);
	const dir = resolve(output, entry.name);
	mkdirSync(resolve(dir, "media"), { recursive: true });
	mkdirSync(resolve(dir, "frames"), { recursive: true });
	copyFileSync(movie, resolve(dir, url));
	const samples = Array.from({ length: 24 }, (_, i) => {
		const file = `frames/${String(i).padStart(2, "0")}.png`;
		copyFileSync(resolve(source, `${String(i).padStart(2, "0")}.png`), resolve(dir, file));
		return { start: positions[i], end: positions[i + 1] ?? 2, file };
	});
	writeFileSync(
		resolve(dir, "storyboard.json"),
		`${JSON.stringify(entry.storyboard, null, "\t")}\n`,
	);
	writeFileSync(
		resolve(dir, "case.json"),
		`${JSON.stringify({ width: 1080, height: 1920, frames: entry.frames, options: entry.options, geometry: companions.has(entry.name) ? { case: companions.get(entry.name), reason: "Transparent straight-RGB ink changes with subpixel alpha and dark encoded cells. Opaque high-contrast backdrop retains identical video, layout and timing for the original two-pixel geometry gate; all original SSIM checks remain." } : undefined, regions: [{ name: "video", rect: [0, 0, 1080, 1920] }], videoFrames: [{ url, revision, frames: samples }] }, null, "\t")}\n`,
	);
}
writeFileSync(
	resolve(output, "provenance.json"),
	`${JSON.stringify({ ffmpeg: execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split("\n")[0], encode, revision, width, height, count: 24, rate: 12, cases: cases.map(({ name, options, frames }) => ({ name, options, frames })) }, null, "\t")}\n`,
);
console.log(`Verified 24 numbered frames; wrote ${cases.length} video cases to ${output}`);
