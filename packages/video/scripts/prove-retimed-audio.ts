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
	DEFAULT_MEDIA_IMPORT_LIMITS,
	type AudioOverlay,
	type ClipLayout,
	type Scene,
} from "@maleo/shared";
import { processSourceAudio } from "../../media/src/processing/audio.ts";
import { reverseSelectedSource } from "../../media/src/processing/reverse.ts";
import { storyboardSchema } from "../src/schema.ts";
import { crossingsOf, decodePcm, peakSeconds } from "./pcm.ts";

const directory = await mkdtemp(join(tmpdir(), "maleo-retime-render-"));
const original = join(directory, "original.mp4"),
	sound = join(directory, "audio.m4a"),
	reversed = join(directory, "reversed.mp4");
let server: ReturnType<typeof Bun.serve> | undefined;
try {
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"color=c=blue:s=32x32:r=30:d=4",
		"-f",
		"lavfi",
		"-i",
		"aevalsrc=if(between(t\\,1.4\\,1.8)\\,0.125*sin(2*PI*880*t)\\,0):s=48000:d=4",
		"-vf",
		"drawbox=color=red:t=fill:enable='gte(t,3)'",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-y",
		original,
	]);
	const metadata = {
		kind: "video" as const,
		originalFilename: "Original.mp4",
		byteSize: Bun.file(original).size,
		width: 32,
		height: 32,
		duration: 4,
		hasAudio: true,
	};
	const sourceUrl = "/api/media/11111111-1111-4111-8111-111111111111",
		audioUrl = "/api/media/22222222-2222-4222-8222-222222222222",
		reversedUrl = "/api/media/33333333-3333-4333-8333-333333333333";
	server = Bun.serve({
		port: 0,
		fetch: (request) =>
			new Response(
				Bun.file(
					new URL(request.url).pathname === audioUrl
						? sound
						: new URL(request.url).pathname === reversedUrl
							? reversed
							: original,
				),
			),
	});
	const serveUrl = await bundle({
		entryPoint: new URL("../src/index.ts", import.meta.url).pathname,
		outDir: join(directory, "bundle"),
	});
	const refs = { images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } };
	for (const reverse of [false, true]) {
		await processSourceAudio(
			original,
			sound,
			metadata,
			{
				type: "audio",
				startSec: 1,
				durationSec: 2,
				playbackRate: 0.5,
				preservePitch: true,
				reverse,
			},
			DEFAULT_MEDIA_IMPORT_LIMITS,
			AbortSignal.timeout(60_000),
		);
		if (reverse)
			await reverseSelectedSource(
				original,
				reversed,
				metadata,
				{ type: "reverse", startSec: 1, durationSec: 2 },
				DEFAULT_MEDIA_IMPORT_LIMITS,
				AbortSignal.timeout(60_000),
			);
		const layout: ClipLayout = {
			xPct: 0,
			yPct: 0,
			widthPct: 100,
			heightPct: 100,
			fit: "stretch",
			playbackRate: 0.5,
			preservePitch: true,
			reverse,
			audioMedia: {
				url: audioUrl,
				sourceUrl,
				sourceRevision: "proof",
				startSec: 1,
				durationSec: 2,
				playbackRate: 0.5,
				preservePitch: true,
				reverse,
			},
			...(reverse
				? {
						reverseMedia: {
							url: reversedUrl,
							sourceUrl,
							sourceRevision: "proof",
							startSec: 1,
							durationSec: 2,
						},
					}
				: {}),
		};
		const visual = {
			id: "video",
			kind: "video" as const,
			url: sourceUrl,
			label: "Retime",
			startSec: 0,
			durationSec: 4,
			mediaStartSec: 1,
			primary: true,
			layout,
			volume: 0.6,
		};
		const scene: Scene = {
			id: 1,
			name: "Retime",
			shot: "Wide",
			move: "Static",
			vis: "",
			vo: "",
			img: true,
			src: "",
			dur: 4,
			visualClips: [visual],
		};
		for (const path of [
			"overlay",
			"single-scene",
			"multi-scene",
			"held-scene-in-timeline",
		] as const)
			for (const extracted of reverse ? [false, true] : [false]) {
				const image =
					"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><rect width='32' height='32'/></svg>";
				const scenes =
					path === "overlay"
						? [{ ...scene, visualClips: [], src: image }]
						: path === "single-scene"
							? [{ ...scene, dur: 6 }]
							: path === "held-scene-in-timeline"
								? [
										{ ...scene, dur: 6 },
										{
											...scene,
											id: 2,
											dur: 2,
											visualClips: [0, 1].map((startSec) => ({
												...visual,
												id: `image-${startSec}`,
												kind: "image" as const,
												url: image,
												startSec,
												durationSec: 1,
												primary: startSec === 0,
											})),
										},
									]
								: [
										{
											...scene,
											dur: 8,
											visualClips: [
												visual,
												{ ...visual, id: "second", startSec: 4, primary: false },
											],
										},
									];
				const audioClips: AudioOverlay[] = extracted
					? (path === "multi-scene" ? [0, 4] : [0]).map((start, id) => ({
							id: id + 1,
							kind: "sfx",
							content: "",
							url: audioUrl,
							start,
							dur: 4,
							volume: 0.6,
							duckUnderVoice: 1,
							mediaStartSec: 0,
						}))
					: [];
				const extractedLayout = (snapshot: AudioOverlay): ClipLayout => ({
					...layout,
					sourceAudioExtraction: {
						audioClipId: `audio:${snapshot.id}`,
						priorVolume: 0.6,
						source: {
							url: sourceUrl,
							startSec: 1,
							durationSec: 2,
							playbackRate: 0.5,
							preservePitch: true,
							reverse,
						},
						audioSnapshot: snapshot,
					},
				});
				const authoredScenes = extracted
					? scenes.map((s) => ({
							...s,
							visualClips: (s.visualClips ?? []).map((v, i) =>
								v.kind === "video"
									? { ...v, layout: extractedLayout(audioClips[i]!), volume: 1 }
									: v,
							),
						}))
					: scenes;
				const doc = toTimelineDoc(
					authoredScenes,
					path === "overlay"
						? [
								{
									id: 1,
									kind: "video",
									url: sourceUrl,
									start: 0,
									dur: 4,
									mediaStartSec: 1,
									layout: extracted ? extractedLayout(audioClips[0]!) : layout,
									volume: extracted ? 1 : 0.6,
								},
							]
						: [],
					[],
					audioClips,
				);
				const built = buildRenderStoryboardFromDoc({}, refs, JSON.parse(JSON.stringify(doc)), {
					captions: DEFAULT_CAPTIONS,
				}).storyboard;
				const props = storyboardSchema.parse(
					JSON.parse(
						JSON.stringify(built)
							.replaceAll(audioUrl, new URL(audioUrl, server.url).href)
							.replaceAll(reversedUrl, new URL(reversedUrl, server.url).href)
							.replaceAll(sourceUrl, new URL(sourceUrl, server.url).href),
					),
				);
				const selected = await selectComposition({
					serveUrl,
					id: "StoryboardWide",
					inputProps: props,
				});
				const composition = {
					...selected,
					width: 32,
					height: 32,
					durationInFrames:
						path === "multi-scene" || path === "held-scene-in-timeline"
							? 240
							: path === "single-scene"
								? 180
								: 120,
				};
				const output = join(directory, `${path}-${reverse}-${extracted}.mp4`);
				await renderMedia({
					serveUrl,
					composition,
					inputProps: props,
					codec: "h264",
					outputLocation: output,
					concurrency: 1,
				});
				const pcm = decodePcm(output);
				const from = reverse ? 2.5 : 0.9,
					to = from + 0.3;
				const audible = peakSeconds(pcm, from, to);
				assert(
					audible > 0.05 && audible < 0.105,
					`${path}/${reverse}: source gain applied twice or missing: ${audible}`,
				);
				assert(
					peakSeconds(pcm, 0.1, 0.3) < 0.005,
					`${path}/${reverse}: source trim/alignment drift`,
				);
				assert(
					peakSeconds(pcm, reverse ? 0.9 : 2.5, reverse ? 1.2 : 2.8) < 0.005,
					`${path}/${reverse}: wrong direction or doubled embedded soundtrack`,
				);
				const pitch =
					crossingsOf(pcm, Math.floor(from * 48000), Math.floor(to * 48000)) / (to - from);
				assert(Math.abs(pitch - 880) < 10, `${path}/${reverse}: preserved pitch ${pitch}`);
				if (path === "multi-scene")
					assert(peakSeconds(pcm, from + 4, to + 4) > 0.05, "Second visual lost aligned audio");
				if (path === "single-scene" || path === "held-scene-in-timeline") {
					assert(peakSeconds(pcm, 4.5, 5) < 0.005, "Narration hold repeated source sound");
					const frame = execFileSync("ffmpeg", [
						"-v",
						"error",
						"-ss",
						"4.5",
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
					const center = (16 * 32 + 16) * 3;
					assert(
						frame[center + 2]! > 240 && frame[center]! < 15,
						`Narration hold read beyond selected source endpoint instead of holding blue frame: RGB ${[...frame.subarray(center, center + 3)]}`,
					);
				}
				console.log(
					JSON.stringify({
						path,
						reverse,
						extracted,
						rate: 0.5,
						pitch,
						peak: audible,
						gain: 0.6,
						reloaded: true,
					}),
				);
			}
	}
} finally {
	void server?.stop(true);
	await rm(directory, { recursive: true, force: true });
}
