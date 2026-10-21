import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import {
	CAPTION_JOB_LIMITS,
	effectiveMediaImportLimits,
	timelineAudioGain,
	type CaptionSourceManifest,
} from "@maleo/shared";
import { processSourceAudio } from "./audio.ts";
import { MEDIA_INPUT_OPTIONS, probeImportedMedia, runMediaCommand } from "./probe.ts";

const SAMPLE_RATE = 16000;

/** Gaps separate recognition passes; overlapping sources still share one mix. */
export function captionAudioRanges(manifest: CaptionSourceManifest) {
	const ranges: Array<{ startSec: number; endSec: number }> = [];
	for (const source of [...manifest.sources].sort(
		(a, b) => a.timelineStartSec - b.timelineStartSec,
	)) {
		const startSec = source.timelineStartSec;
		const endSec = startSec + source.durationSec;
		const previous = ranges.at(-1);
		if (previous && startSec <= previous.endSec)
			previous.endSec = Math.max(previous.endSec, endSec);
		else ranges.push({ startSec, endSec });
	}
	return ranges;
}

/** Mix once in timeline time, using production frame gain and preserving silence. */
export async function prepareCaptionAudio(
	manifest: CaptionSourceManifest,
	inputs: readonly string[],
	directory: string,
	signal: AbortSignal,
): Promise<string> {
	if (inputs.length !== manifest.sources.length) throw new Error("Caption source count changed");
	const duration = manifest.endSec - manifest.startSec;
	const mix = new Float32Array(Math.ceil(duration * SAMPLE_RATE));
	const voiceoverRanges = manifest.sources
		.filter((source) => source.role === "voiceover")
		.map((source) => ({
			startSec: source.timelineStartSec,
			endSec: source.timelineStartSec + source.durationSec,
		}));
	const limits = effectiveMediaImportLimits({
		maxScratchBytes: CAPTION_JOB_LIMITS.maxScratchBytes,
		maxSourceDurationSec: CAPTION_JOB_LIMITS.maxDurationSec * 4,
	});
	let bytes =
		[...new Set(inputs)].reduce((sum, file) => sum + Bun.file(file).size, 0) + mix.byteLength * 2;
	for (const [index, source] of manifest.sources.entries()) {
		signal.throwIfAborted();
		const input = inputs[index]!,
			raw = join(directory, `source-${index}.pcm`);
		const size = (await stat(input)).size;
		const metadata = await probeImportedMedia(
			input,
			{ kind: source.kind, originalFilename: "Caption source" },
			size,
			limits,
			signal,
		);
		if (
			!metadata.hasAudio ||
			!metadata.duration ||
			source.binding.sourceStartSec >= metadata.duration ||
			// Match API admission tolerance for rounded browser and generated-audio durations.
			source.binding.sourceEndSec > metadata.duration + 0.05
		)
			throw new Error("Caption source has no audio or selected interval changed");
		const sourceDuration =
			Math.min(source.binding.sourceEndSec, metadata.duration) - source.binding.sourceStartSec;
		const retimed = source.playbackRate !== 1 || source.reverse;
		let selected = input;
		if (retimed) {
			selected = join(directory, `source-${index}.m4a`);
			await processSourceAudio(
				input,
				selected,
				metadata,
				{
					type: "audio",
					startSec: source.binding.sourceStartSec,
					durationSec: sourceDuration,
					playbackRate: source.playbackRate,
					preservePitch: source.preservePitch,
					reverse: source.reverse,
				},
				{ ...limits, maxScratchBytes: CAPTION_JOB_LIMITS.maxScratchBytes - bytes },
				signal,
			);
		}
		const decodeDuration = source.loop ? sourceDuration : source.durationSec;
		await runMediaCommand(
			"ffmpeg",
			[
				"-nostdin",
				"-v",
				"error",
				...MEDIA_INPUT_OPTIONS,
				"-ss",
				String(retimed ? 0 : source.binding.sourceStartSec),
				"-i",
				selected,
				"-t",
				String(decodeDuration),
				"-vn",
				"-map",
				"0:a:0",
				"-ar",
				String(SAMPLE_RATE),
				"-ac",
				"1",
				"-c:a",
				"pcm_f32le",
				"-f",
				"f32le",
				"-fs",
				String(Math.ceil(decodeDuration * SAMPLE_RATE + SAMPLE_RATE) * 4),
				raw,
			],
			signal,
		);
		const buffer = await readFile(raw);
		if (!buffer.length || buffer.length % 4) throw new Error("Caption audio decode failed");
		bytes += buffer.length + (retimed ? (await stat(selected)).size : 0);
		if (bytes > CAPTION_JOB_LIMITS.maxScratchBytes)
			throw new Error("Caption preparation exceeds scratch limit");
		const start = Math.floor((source.timelineStartSec - manifest.startSec) * SAMPLE_RATE);
		const count = Math.min(mix.length - start, Math.floor(source.durationSec * SAMPLE_RATE));
		const samples = buffer.length / 4;
		const clip = {
			kind: source.role,
			startSec: source.timelineStartSec,
			durationSec: source.durationSec,
			volume: source.volume,
			fadeInSec: source.fadeInSec,
			fadeOutSec: source.fadeOutSec,
			duckUnderVoice: source.duckUnderVoice,
			animation: source.animation,
		};
		let gain = 1,
			previousFrame = -1;
		for (let sample = 0; sample < count; sample++) {
			if (sample % 64000 === 0) await setImmediate();
			const frame = Math.floor((sample / SAMPLE_RATE) * 30);
			if (frame !== previousFrame) {
				signal.throwIfAborted();
				gain = timelineAudioGain(clip, frame, 30, voiceoverRanges);
				previousFrame = frame;
			}
			if (source.loop || sample < samples)
				mix[start + sample] =
					mix[start + sample]! +
					buffer.readFloatLE((source.loop ? sample % samples : sample) * 4) * gain;
		}
		await rm(raw);
		if (retimed) await rm(selected);
	}
	// PCM WAV keeps silence and absolute placement; clamp only at final output, as audio playback does.
	const output = Buffer.alloc(44 + mix.length * 2);
	output.write("RIFF", 0);
	output.writeUInt32LE(output.length - 8, 4);
	output.write("WAVEfmt ", 8);
	output.writeUInt32LE(16, 16);
	output.writeUInt16LE(1, 20);
	output.writeUInt16LE(1, 22);
	output.writeUInt32LE(SAMPLE_RATE, 24);
	output.writeUInt32LE(SAMPLE_RATE * 2, 28);
	output.writeUInt16LE(2, 32);
	output.writeUInt16LE(16, 34);
	output.write("data", 36);
	output.writeUInt32LE(mix.length * 2, 40);
	for (let sample = 0; sample < mix.length; sample++) {
		if (sample % 64000 === 0) {
			await setImmediate();
			signal.throwIfAborted();
		}
		output.writeInt16LE(
			Math.round(Math.max(-1, Math.min(1, mix[sample]!)) * 32767),
			44 + sample * 2,
		);
	}
	signal.throwIfAborted();
	const path = join(directory, "caption-mix.wav");
	await writeFile(path, output);
	return path;
}
