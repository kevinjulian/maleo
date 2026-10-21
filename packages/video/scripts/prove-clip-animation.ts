#!/usr/bin/env bun
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import {
	buildRenderStoryboardFromDoc,
	toTimelineDoc,
	DEFAULT_CAPTIONS,
	type ClipAnimation,
	type Scene,
} from "@maleo/shared";
import { storyboardSchema } from "../src/schema.ts";
import { amplitudeAt, decodePcm } from "./pcm.ts";

const directory = await mkdtemp(join(tmpdir(), "maleo-clip-animation-"));
let server: ReturnType<typeof Bun.serve> | undefined;
try {
	const video = join(directory, "video.mp4"),
		music = join(directory, "music.wav"),
		silent = join(directory, "silent.wav"),
		processed = join(directory, "processed.wav");
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"color=c=blue:s=32x32:r=30:d=12",
		"-f",
		"lavfi",
		"-i",
		"aevalsrc=0.125*sin(2*PI*660*t):s=48000:d=12",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-y",
		video,
	]);
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-ss",
		"1",
		"-t",
		"8",
		"-i",
		video,
		"-vn",
		"-af",
		"atempo=2",
		"-y",
		processed,
	]);
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"aevalsrc=0.125*sin(2*PI*880*t):s=48000:d=6",
		"-y",
		music,
	]);
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"anullsrc=r=48000:cl=mono",
		"-t",
		"6",
		"-y",
		silent,
	]);
	const videoUrl = "/api/media/11111111-1111-4111-8111-111111111111",
		musicUrl = "/api/media/22222222-2222-4222-8222-222222222222",
		voiceUrl = "/api/media/33333333-3333-4333-8333-333333333333";
	const processedUrl = "/api/media/44444444-4444-4444-8444-444444444444";
	server = Bun.serve({
		port: 0,
		fetch: (req) =>
			new Response(
				Bun.file(
					new URL(req.url).pathname === videoUrl
						? video
						: new URL(req.url).pathname === musicUrl
							? music
							: new URL(req.url).pathname === processedUrl
								? processed
								: silent,
				),
			),
	});
	const serveUrl = await bundle({
		entryPoint: new URL("../src/index.ts", import.meta.url).pathname,
		outDir: join(directory, "bundle"),
	});
	const image =
			"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><rect width='32' height='32' fill='blue'/></svg>",
		black = image.replace("fill='blue'", "fill='black'");
	const refs = { images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } };
	const volume = [
		{ t: 0, v: 0.2 },
		{ t: 1, v: 0.2 },
		{ t: 1.01, v: 0.8 },
		{ t: 3, v: 0.8 },
		{ t: 3.01, v: 0.2 },
		{ t: 4, v: 0.2 },
	];
	const animation: ClipAnimation = {
		tracks: {
			xPct: [
				{ t: 0, v: 0 },
				{ t: 4, v: 50 },
			],
			scale: [
				{ t: 0, v: 1 },
				{ t: 4, v: 1.5 },
			],
			rotationDeg: [
				{ t: 0, v: 0 },
				{ t: 4, v: 180 },
			],
			opacity: [
				{ t: 0, v: 1 },
				{ t: 4, v: 0.2 },
			],
		},
	};
	for (const kind of ["image", "video"] as const)
		for (const path of ["overlay", "single-scene", "multi-scene"] as const)
			for (const retimed of kind === "video" ? [false, true] : [false])
				for (const muted of kind === "video" && path === "overlay" ? [false, true] : [false]) {
					const layout = {
						xPct: 0,
						yPct: 25,
						widthPct: 25,
						heightPct: 25,
						fit: "stretch" as const,
						animation: { tracks: { ...animation.tracks, ...(kind === "video" ? { volume } : {}) } },
						...(retimed
							? {
									playbackRate: 2,
									preservePitch: true,
									audioMedia: {
										url: processedUrl,
										sourceUrl: videoUrl,
										sourceRevision: "fixture",
										startSec: 1,
										durationSec: 8,
										playbackRate: 2,
										preservePitch: true,
										reverse: false,
									},
								}
							: {}),
					};
					const visual = {
						id: "visual",
						kind,
						url: kind === "video" ? videoUrl : image,
						label: "Animated",
						startSec: 0,
						durationSec: 4,
						primary: true,
						mediaStartSec: 1,
						volume: 0,
						layout,
					};
					const scene: Scene = {
						id: 1,
						name: "Scene",
						shot: "Wide",
						move: "Static",
						vis: "",
						vo: "",
						img: true,
						src: black,
						dur: 4,
						visualClips: [],
					};
					const scenes =
						path === "overlay"
							? [scene]
							: [
									{
										...scene,
										src: "",
										dur: path === "multi-scene" ? 5 : 4,
										visualClips:
											path === "multi-scene"
												? [
														visual,
														{
															...visual,
															id: "next",
															kind: "image" as const,
															url: black,
															primary: false,
															startSec: 4,
															durationSec: 1,
															layout: undefined,
														},
													]
												: [visual],
									},
								];
					const doc = toTimelineDoc(
						scenes,
						path === "overlay"
							? [
									{
										id: 1,
										kind,
										url: visual.url,
										start: 0,
										dur: 4,
										track: 1,
										mediaStartSec: 1,
										volume: 0,
										layout,
									},
								]
							: [],
						[],
						[
							{
								id: 2,
								kind: "music",
								content: "Bed",
								url: musicUrl,
								start: 0,
								dur: 4,
								track: 2,
								volume: 1,
								fadeIn: 1,
								fadeOut: 1,
								duckUnderVoice: 0.5,
								animation: { tracks: { volume } },
							},
							{
								id: 3,
								kind: "voiceover",
								content: "Quiet narrator",
								url: voiceUrl,
								start: 1,
								dur: 2,
								track: 3,
								volume: 0,
							},
						],
					);
					const built = buildRenderStoryboardFromDoc({}, refs, JSON.parse(JSON.stringify(doc)), {
						captions: { ...DEFAULT_CAPTIONS, enabled: false },
						trackFlags: muted ? { 1: { muted: true } } : undefined,
					}).storyboard;
					const props = storyboardSchema.parse(
						JSON.parse(
							JSON.stringify(built)
								.replaceAll(videoUrl, new URL(videoUrl, server.url).href)
								.replaceAll(musicUrl, new URL(musicUrl, server.url).href)
								.replaceAll(voiceUrl, new URL(voiceUrl, server.url).href)
								.replaceAll(processedUrl, new URL(processedUrl, server.url).href),
						),
					);
					const selected = await selectComposition({
						serveUrl,
						id: "StoryboardWide",
						inputProps: props,
					});
					const output = join(directory, `${kind}-${path}-${retimed}-${muted}.mp4`);
					await renderMedia({
						serveUrl,
						composition: { ...selected, width: 128, height: 128, durationInFrames: 120 },
						inputProps: props,
						codec: "h264",
						outputLocation: output,
						concurrency: 1,
					});
					for (const [time, centerX, blue] of [
						[1, 8, 204],
						[3, 16, 102],
					] as const) {
						const pixels = execFileSync("ffmpeg", [
							"-v",
							"error",
							"-ss",
							String(time),
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
						const at = (x: number, y: number) => pixels[(y * 128 + x) * 3 + 2]!;
						assert(
							Math.abs(at(centerX * 4, 48) - blue) < 25,
							`${kind}/${path}: keyed position/opacity mismatch ${at(centerX * 4, 48)}`,
						);
						assert(
							at(centerX * 4 + (time === 1 ? 16 : 20), 48 + (time === 1 ? 12 : 16)) < 30,
							`${kind}/${path}: keyed rotation ignored`,
						);
						assert(
							at(centerX * 4 + 24, 48) > 30,
							`${kind}/${path}: keyed scale ignored at ${time}s (${at(centerX * 4 + 24, 48)})`,
						);
					}
					const pcm = decodePcm(output);
					const bed = [
						amplitudeAt(pcm, 880, 0.5),
						amplitudeAt(pcm, 880, 2),
						amplitudeAt(pcm, 880, 3.5),
					];
					for (const [index, expected] of [0.01375, 0.05, 0.01125].entries())
						assert(
							Math.abs(bed[index]! - expected) < 0.005,
							`${kind}/${path}: keys/fade/duck order ${bed}`,
						);
					const source = [
						amplitudeAt(pcm, 660, 0.5),
						amplitudeAt(pcm, 660, 2),
						amplitudeAt(pcm, 660, 3.5),
					];
					if (kind === "video" && !muted)
						for (const [index, expected] of [0.025, 0.1, 0.025].entries())
							assert(
								Math.abs(source[index]! - expected) < 0.008,
								`${path}: keyed source gain timing ${source}`,
							);
					else
						assert(
							source.every((value) => value < 0.003),
							`${kind}/${path}: source/track mute bypassed by keyed gain ${source}`,
						);
					console.log(
						JSON.stringify({
							kind,
							path,
							retimed,
							muted,
							reloaded: true,
							pixelTolerance: 25,
							bed,
							source,
						}),
					);
				}
} finally {
	void server?.stop(true);
	await rm(directory, { recursive: true, force: true });
}
