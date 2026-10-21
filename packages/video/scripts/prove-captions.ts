#!/usr/bin/env bun
/* Real worker candidates → shared preview/export projection → production Remotion MP4/SRT. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { z } from "zod";
import {
	CaptionProcessingResultSchema,
	DEFAULT_CAPTIONS,
	buildRenderStoryboardFromDoc,
	renderCaptionClips,
	readStoryboardDocument,
	type Clip,
} from "@maleo/shared";
import { captionClipsToSrt, parseSrt } from "../../../apps/web/src/models/captions/srt.ts";
import { storyboardSchema } from "../src/schema.ts";

const [proofPath, audioDirectory, destination, documentPath] = process.argv.slice(2);
if (!proofPath || !audioDirectory || !destination)
	throw new Error("Expected runtime-proof.json, licensed WAV directory and output directory");
const proof = z
	.object({
		proof: z.array(
			z.object({
				sample: z.string(),
				durationSec: z.number().positive(),
				result: CaptionProcessingResultSchema,
			}),
		),
	})
	.parse(await Bun.file(proofPath).json());
const sample = proof.proof.find((entry) => entry.sample === "en_us");
assert(sample && sample.result.cues.length, "English worker candidate proof missing");
const authored = documentPath
	? readStoryboardDocument(await Bun.file(documentPath).json()).doc
	: null;
const output = resolve(destination);
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "maleo-caption-render-"));
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: (request) =>
		["/speech.wav", "/speech.mp4"].includes(new URL(request.url).pathname)
			? new Response(Bun.file(join(audioDirectory, authored ? "talking-head.mp4" : "en_us.wav")), {
					headers: { "content-type": authored ? "video/mp4" : "audio/wav" },
				})
			: new Response(null, { status: 404 }),
});
try {
	const duration = authored
		? Math.max(...authored.clips.map((clip) => clip.startSec + clip.durationSec))
		: sample.durationSec + 3;
	const black =
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='black'/%3E%3C/svg%3E";
	const scene: Clip = {
		id: "scene:1",
		type: "image",
		startSec: 0,
		durationSec: duration,
		track: -1,
		scene: {
			id: 1,
			dur: duration,
			name: "Caption proof",
			shot: "Wide",
			move: "Static",
			vis: "",
			vo: "",
			img: true,
			src: black,
		},
	};
	const audio: Clip = {
		id: "audio:7",
		type: "audio",
		startSec: 2,
		durationSec: sample.durationSec,
		track: 0,
		audio: {
			id: 7,
			kind: "voiceover",
			content: "",
			url: new URL("/speech.wav", server.url).href,
			start: 2,
			dur: sample.durationSec,
			track: 0,
			originalDur: sample.durationSec,
		},
	};
	const captions = authored?.captions ?? {
		...DEFAULT_CAPTIONS,
		enabled: true,
		style: "Standard",
		motion: "None" as const,
		fontFamily: "Arial",
		fontSize: 48,
		fill: "#ffffff",
		stroke: "transparent",
		background: "transparent",
		shadowOpacity: 0,
	};
	const doc = authored
		? {
				...authored,
				captionSet: authored.captionSet ?? undefined,
				captions,
				chapters: authored.chapters ?? undefined,
				bookmarks: authored.bookmarks ?? undefined,
				clips: authored.clips.map((clip) =>
					clip.video
						? { ...clip, video: { ...clip.video, url: new URL("/speech.mp4", server.url).href } }
						: clip,
				),
			}
		: {
				schemaVersion: 2 as const,
				clips: [scene, audio, ...sample.result.cues],
				markers: [],
				captions,
			};
	const preview = renderCaptionClips(doc.clips, captions);
	const projected = buildRenderStoryboardFromDoc(
		{ format: "16:9" },
		{ images: [], notes: [], speakers: [], style: { tone: "", palette: "", music: "" } },
		doc,
		{ captions, backgroundFill: "#000000" },
	).storyboard;
	assert.deepEqual(projected.captionCues, preview);
	const props = storyboardSchema.parse(projected);
	assert.deepEqual(props.captionCues, preview);
	const srt = captionClipsToSrt(doc.clips);
	await Bun.write(join(output, "captions.srt"), srt);
	const parsed = parseSrt(srt);
	assert.equal(parsed.cues.length, preview.length);
	for (const [index, cue] of preview.entries()) {
		assert.equal(parsed.cues[index]!.text, cue.caption.text);
		assert(Math.abs(parsed.cues[index]!.startSec - cue.startSec) <= 0.0005);
		assert(Math.abs(parsed.cues[index]!.endSec - cue.startSec - cue.durationSec) <= 0.0005);
	}
	const serveUrl = await bundle({
		entryPoint: new URL("../src/index.ts", import.meta.url).pathname,
		outDir: join(directory, "bundle"),
	});
	const composition = await selectComposition({
		serveUrl,
		id: "StoryboardWide",
		inputProps: props,
	});
	const mp4 = join(output, "captions.mp4");
	await renderMedia({
		serveUrl,
		composition: { ...composition, width: 640, height: 360 },
		inputProps: props,
		codec: "h264",
		outputLocation: mp4,
		concurrency: 1,
	});
	const frame = (second: number) =>
		execFileSync("ffmpeg", [
			"-v",
			"error",
			"-ss",
			String(second),
			"-i",
			mp4,
			"-frames:v",
			"1",
			"-vf",
			"format=gray",
			"-f",
			"rawvideo",
			"pipe:1",
		]);
	const silence = frame(0.5),
		active = frame(preview[0]!.startSec + preview[0]!.durationSec / 2);
	if (!authored)
		assert.equal(
			silence.filter((value) => value > 32).length,
			0,
			"Captions appeared before first cue",
		);
	if (!authored)
		assert(
			active.filter((value) => value > 200).length > 20,
			"Production output contains no caption pixels",
		);
	const pcm = execFileSync(
		"ffmpeg",
		["-v", "error", "-i", mp4, "-vn", "-ar", "16000", "-ac", "1", "-f", "f32le", "pipe:1"],
		{ maxBuffer: 8 * 1024 * 1024 },
	);
	let earlyPeak = 0,
		speechPeak = 0;
	for (let index = 0; index < pcm.length / 4; index++) {
		const sample = Math.abs(pcm.readFloatLE(index * 4));
		if (index < 16000) earlyPeak = Math.max(earlyPeak, sample);
		else if (index > 32000) speechPeak = Math.max(speechPeak, sample);
	}
	assert(
		(authored || earlyPeak < 0.0001) && speechPeak > 0.01,
		"Speech placement or soundtrack changed",
	);
	const measured = Number(
		execFileSync(
			"ffprobe",
			["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", mp4],
			{ encoding: "utf8" },
		),
	);
	assert(Math.abs(measured - duration) < 0.1);
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-ss",
		String(preview[0]!.startSec + preview[0]!.durationSec / 2),
		"-i",
		mp4,
		"-frames:v",
		"1",
		"-y",
		join(output, "caption.png"),
	]);
	const evidence = {
		composition: composition.id,
		resolution: "640x360",
		durationSec: measured,
		cueCount: preview.length,
		text: preview.map((cue) => cue.caption.text),
		intervals: preview.map((cue) => [cue.startSec, cue.startSec + cue.durationSec]),
		activeCaptionPixels: authored ? null : active.filter((value) => value > 200).length,
		silenceCaptionPixels: authored ? null : 0,
		earlyPeak,
		speechPeak,
		source: proofPath,
		...(documentPath ? { document: documentPath } : {}),
		output: mp4,
	};
	await Bun.write(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
	console.log(JSON.stringify(evidence));
} finally {
	await server.stop(true);
	await rm(directory, { recursive: true, force: true });
}
