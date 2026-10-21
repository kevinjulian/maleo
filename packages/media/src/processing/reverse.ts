import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	MediaReverseOperationSchema,
	type ImportedMediaMetadata,
	type MediaReverseOperation,
	type MediaImportLimits,
} from "@maleo/shared";
import { MEDIA_INPUT_OPTIONS, runMediaCommand } from "./probe.ts";

/** Reverse short bounded chunks, then concatenate in reverse order. */
export async function reverseSelectedSource(
	input: string,
	output: string,
	metadata: ImportedMediaMetadata,
	operation: MediaReverseOperation,
	limits: MediaImportLimits,
	signal: AbortSignal,
): Promise<void> {
	const selected = MediaReverseOperationSchema.parse(operation);
	if (
		metadata.kind !== "video" ||
		!metadata.width ||
		!metadata.height ||
		!metadata.duration ||
		selected.startSec + selected.durationSec > metadata.duration + 1e-6
	)
		throw new Error("Reverse interval exceeds measured video source");
	const fps = 30;
	const frames = Math.max(1, Math.round(selected.durationSec * fps));
	// Bound reverse's buffered decoded frames; never buffer the whole source.
	const chunkFrames = Math.max(
		1,
		Math.min(300, Math.floor((128 * 1024 * 1024) / (metadata.width * metadata.height * 4))),
	);
	const directory = dirname(output),
		chunks: string[] = [];
	let used = (await stat(input)).size;
	const reserve = 8 * 1024 * 1024;
	for (let end = frames; end > 0;) {
		signal.throwIfAborted();
		const count = Math.min(chunkFrames, end),
			start = end - count;
		const name = `reverse-chunk-${chunks.length}.mkv`,
			path = join(directory, name);
		const available = limits.maxScratchBytes - used - reserve;
		if (available <= 0) throw new Error("Reverse exceeds scratch limit");
		await runMediaCommand(
			"ffmpeg",
			[
				"-nostdin",
				"-hide_banner",
				"-v",
				"error",
				...MEDIA_INPUT_OPTIONS,
				"-ss",
				String(selected.startSec + start / fps),
				"-t",
				String(count / fps),
				"-i",
				input,
				"-map",
				"0:V:0",
				"-map",
				"0:a:0?",
				"-map_metadata",
				"-1",
				"-threads",
				"1",
				"-filter_threads",
				"1",
				"-vf",
				`fps=${fps},trim=end_frame=${count},format=yuv420p,reverse,setpts=PTS-STARTPTS,pad=ceil(iw/2)*2:ceil(ih/2)*2`,
				"-af",
				`aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,atrim=duration=${count / fps},areverse,asetpts=PTS-STARTPTS`,
				"-c:v",
				"libx264",
				"-preset",
				"veryfast",
				"-crf",
				"18",
				"-pix_fmt",
				"yuv420p",
				"-c:a",
				"pcm_s16le",
				"-ac",
				"2",
				"-fs",
				String(available),
				"-y",
				path,
			],
			signal,
		);
		const size = (await stat(path)).size;
		if (!size || size >= available) throw new Error("Reverse chunk exceeds scratch limit");
		used += size;
		chunks.push(name);
		end = start;
	}
	const list = join(directory, "reverse-chunks.txt");
	await Bun.write(list, chunks.map((name) => `file '${name}'`).join("\n"));
	const available = limits.maxScratchBytes - used - reserve;
	if (available <= 0) throw new Error("Reverse exceeds scratch limit");
	await runMediaCommand(
		"ffmpeg",
		[
			"-nostdin",
			"-hide_banner",
			"-v",
			"error",
			...MEDIA_INPUT_OPTIONS,
			"-format_whitelist",
			"concat,matroska",
			"-f",
			"concat",
			"-safe",
			"1",
			"-i",
			list,
			"-map",
			"0:v:0",
			"-map",
			"0:a:0?",
			"-map_metadata",
			"-1",
			"-threads",
			"1",
			"-c:v",
			"copy",
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
			String(available),
			"-y",
			output,
		],
		signal,
	);
	const size = (await stat(output)).size;
	if (!size || size >= available) throw new Error("Reverse output exceeds scratch limit");
}
