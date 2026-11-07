#!/usr/bin/env bun
/* Calibrates the encoding allowance of `comparison.json` (OpenSpec p2-export task 4.2).
 *
 * For each named corpus case, it renders the Remotion MP4 the worker exports
 * (the composition's preset codec and bitrate), re-encodes that MP4 with the
 * Rust host's encoder settings in the render-host image (libopenh264 at the
 * host bitrate, 2 s GOP, AAC 192 kbit/s), and scores the two at the
 * comparison's sample frames. The lowest score is the SSIM one extra H.264
 * generation loses.
 *
 *   bun scripts/calibrate-comparison.ts <out dir> [case ...]
 *
 * Under Bun 1.3.1, Remotion's CPU probe after the first render can break the
 * browser connection, so run one case per process for a full set.
 *
 * MALEO_CALIBRATION_IMAGE names the image (default `maleo-render-host:p2`).
 * Needs Docker, FFmpeg and the built host (`cargo build -p maleo-render-host`). */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { aspectMap, storyboardSchema } from "@maleo/video/schema";
import { PRESETS } from "@maleo/video/lib/presets";
import { VIDEO_ENTRY } from "@maleo/video/paths";
import { compareOutputs, loadComparisonConfig } from "../src/comparison";

const DEFAULT_CASES = [
	"combined-project",
	"caption-combined-a",
	"camera-preset-ken-burns",
	"image-scene-full",
	"transition-series-fade",
	"video-scene-transition",
	"video-overlay-mask-color",
	"reveal-texture-paper",
	"decoration-grain-repeat",
	"text-plain-styled",
];
const PRESET_OF: Record<string, string> = {
	StoryboardReel: "storyboard-tiktok",
	StoryboardSquare: "storyboard-square",
	StoryboardWide: "storyboard-wide",
};
const COMPOSITIONS: Record<string, string> = {
	[`${aspectMap.vertical.width}x${aspectMap.vertical.height}`]: "StoryboardReel",
	[`${aspectMap.square.width}x${aspectMap.square.height}`]: "StoryboardSquare",
	[`${aspectMap.horizontal.width}x${aspectMap.horizontal.height}`]: "StoryboardWide",
};
const MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".wav": "audio/wav",
	".mp3": "audio/mpeg",
};
const corpus = resolve(import.meta.dir, "..", "..", "..", "crates", "renderer", "corpus");
const host = resolve(import.meta.dir, "..", "..", "..", "target", "debug", "maleo-render");
const image = process.env.MALEO_CALIBRATION_IMAGE ?? "maleo-render-host:p2";

function inlineMedia(value: unknown, dir: string): unknown {
	if (typeof value === "string" && value.startsWith("media/")) {
		const mime = MIME[extname(value).toLowerCase()];
		if (!mime) throw new Error(`${dir}: unsupported media ${value}`);
		return `data:${mime};base64,${readFileSync(join(dir, value)).toString("base64")}`;
	}
	if (Array.isArray(value)) return value.map((item) => inlineMedia(item, dir));
	if (value && typeof value === "object")
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inlineMedia(v, dir)]));
	return value;
}

/** `video_bitrate` in crates/render-host/src/encode.rs. */
function hostBitrate(width: number, height: number): number {
	return Math.max(500_000, Math.round((8_000_000 * width * height) / (1920 * 1080)));
}

const [outArg, ...named] = process.argv.slice(2);
if (!outArg) throw new Error("usage: calibrate-comparison.ts <out dir> [case ...]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const cases = named.length > 0 ? named : DEFAULT_CASES;
// Every frame scores; nothing fails on SSIM, so each score is reported.
const config = {
	...(await loadComparisonConfig()),
	encodingAllowance: { value: 1, reason: "calibration" },
};
const serveUrl = await bundle({ entryPoint: VIDEO_ENTRY });
const rows: { case: string; min: number; mean: number; frames: number; audio: string[] }[] = [];
for (const name of cases) {
	const dir = join(corpus, name);
	// SAFETY: case.json and storyboard.json are the corpus's own files.
	const spec = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as {
		width: number;
		height: number;
	};
	const id = COMPOSITIONS[`${spec.width}x${spec.height}`];
	if (!id) throw new Error(`${name}: no composition is ${spec.width}x${spec.height}`);
	const preset = PRESETS[PRESET_OF[id]!]!;
	const raw = JSON.parse(readFileSync(join(dir, "storyboard.json"), "utf8"));
	const inputProps = storyboardSchema.parse(inlineMedia(raw, dir));
	const composition = await selectComposition({
		serveUrl,
		id,
		inputProps,
	});
	const remotion = join(out, `${name}.remotion.mp4`);
	await renderMedia({
		composition,
		serveUrl,
		codec: preset.codec,
		outputLocation: remotion,
		inputProps,
		videoBitrate: preset.videoBitrate,
		audioBitrate: preset.audioBitrate,
		pixelFormat: preset.pixelFormat,
		concurrency: 1,
	});
	const reencoded = join(out, `${name}.openh264.mp4`);
	execFileSync("docker", [
		"run",
		"--rm",
		"-v",
		`${out}:/w`,
		"--entrypoint",
		"/opt/ffmpeg-lgpl/bin/ffmpeg",
		image,
		"-v",
		"error",
		"-y",
		"-i",
		`/w/${name}.remotion.mp4`,
		"-map",
		"0:v:0",
		"-map",
		"0:a:0?",
		"-c:v",
		"libopenh264",
		"-b:v",
		String(hostBitrate(spec.width, spec.height)),
		"-g",
		"60",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-b:a",
		"192000",
		"-movflags",
		"+faststart",
		`/w/${name}.openh264.mp4`,
	]);
	const result = await compareOutputs({
		reference: remotion,
		candidate: reencoded,
		storyboard: storyboardSchema.parse(raw),
		compositionId: id,
		dir: join(out, "comparisons", name),
		config,
		run: { command: [host] },
	});
	const scores = result.frames.map((frame) => frame.ssim);
	rows.push({
		case: name,
		min: Math.min(...scores),
		mean: scores.reduce((sum, value) => sum + value, 0) / scores.length,
		frames: scores.length,
		audio: result.failures.filter((failure) => !failure.startsWith("frame ")),
	});
	console.log(JSON.stringify(rows.at(-1)));
}
writeFileSync(join(out, "calibration.json"), JSON.stringify(rows, null, 2));
console.log(`lowest ${Math.min(...rows.map((row) => row.min)).toFixed(4)}`);
