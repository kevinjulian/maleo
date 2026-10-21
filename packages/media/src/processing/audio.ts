import { z } from "zod";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	MediaAudioOperationSchema,
	type ImportedMediaMetadata,
	type MediaAudioOperation,
	type MediaImportLimits,
} from "@maleo/shared";
import { MEDIA_INPUT_OPTIONS, runMediaCommand } from "./probe.ts";

/** Streaming retime; reverse buffers at most thirty seconds of stereo PCM. */
export async function processSourceAudio(
	input: string,
	output: string,
	metadata: ImportedMediaMetadata,
	operation: MediaAudioOperation,
	limits: MediaImportLimits,
	signal: AbortSignal,
): Promise<void> {
	// Public routes retain their 30-minute bound; caption retiming admits up to 900s at 4x.
	const selected = MediaAudioOperationSchema.extend({
		durationSec: z.number().finite().positive().max(limits.maxSourceDurationSec),
	}).parse(operation);
	if (
		!metadata.hasAudio ||
		!metadata.duration ||
		selected.startSec + selected.durationSec > metadata.duration + 1e-6
	)
		throw new Error("Selected source has no audio or interval exceeds measured duration");
	const directory = dirname(output),
		reserve = 8 * 1024 * 1024;
	let used = (await stat(input)).size;
	const available = () => {
		const bytes = limits.maxScratchBytes - used - reserve;
		if (bytes <= 0) throw new Error("Audio processing exceeds scratch limit");
		return bytes;
	};
	const check = async (path: string, limit: number) => {
		const bytes = (await stat(path)).size;
		if (!bytes || bytes >= limit) throw new Error("Audio processing exceeds scratch limit");
		used += bytes;
	};
	let source = [
		...MEDIA_INPUT_OPTIONS,
		"-ss",
		String(selected.startSec),
		"-t",
		String(selected.durationSec),
		"-i",
		input,
	];
	if (selected.reverse) {
		const chunks: string[] = [];
		for (let end = selected.durationSec; end > 1e-6;) {
			signal.throwIfAborted();
			const duration = Math.min(30, end),
				start = end - duration;
			const name = `audio-reverse-${chunks.length}.wav`,
				path = join(directory, name),
				limit = available();
			await runMediaCommand(
				"ffmpeg",
				[
					"-nostdin",
					"-hide_banner",
					"-v",
					"error",
					...MEDIA_INPUT_OPTIONS,
					"-ss",
					String(selected.startSec + start),
					"-t",
					String(duration),
					"-i",
					input,
					"-map",
					"0:a:0",
					"-vn",
					"-map_metadata",
					"-1",
					"-threads",
					"1",
					"-filter_threads",
					"1",
					"-af",
					`aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,atrim=duration=${duration},areverse,asetpts=PTS-STARTPTS`,
					"-c:a",
					"pcm_s16le",
					"-ar",
					"48000",
					"-ac",
					"2",
					"-fs",
					String(limit),
					"-y",
					path,
				],
				signal,
			);
			await check(path, limit);
			chunks.push(name);
			end = start;
		}
		const list = join(directory, "audio-reverse-chunks.txt");
		await Bun.write(list, chunks.map((name) => `file '${name}'`).join("\n"));
		source = [
			...MEDIA_INPUT_OPTIONS,
			"-format_whitelist",
			"concat,wav",
			"-f",
			"concat",
			"-safe",
			"1",
			"-i",
			list,
		];
	}
	const rate = selected.playbackRate;
	// Older packaged FFmpeg supports atempo 0.5..2; chain factors for full range.
	const tempo =
		rate < 0.5
			? `atempo=0.5,atempo=${rate / 0.5}`
			: rate > 2
				? `atempo=2,atempo=${rate / 2}`
				: `atempo=${rate}`;
	// Silence flushes atempo's analysis window; trim output back to exact selected time.
	const filter = `aresample=48000,${selected.preservePitch ? `apad=pad_dur=0.2,${tempo}` : `asetrate=${48000 * rate},aresample=48000`},atrim=duration=${selected.durationSec / rate},asetpts=PTS-STARTPTS`;
	const limit = available();
	await runMediaCommand(
		"ffmpeg",
		[
			"-nostdin",
			"-hide_banner",
			"-v",
			"error",
			"-xerror",
			...source,
			"-map",
			"0:a:0",
			"-vn",
			"-map_metadata",
			"-1",
			"-threads",
			"1",
			"-filter_threads",
			"1",
			"-af",
			filter,
			"-c:a",
			"aac",
			"-b:a",
			"192k",
			"-ar",
			"48000",
			"-ac",
			"2",
			"-movflags",
			"+faststart",
			"-fs",
			String(limit),
			"-y",
			output,
		],
		signal,
	);
	await check(output, limit);
}
