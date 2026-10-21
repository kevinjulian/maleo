import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { effectiveMediaImportLimits } from "@maleo/shared";
import { MEDIA_INPUT_OPTIONS, probeImportedMedia, runMediaCommand } from "../processing/probe.ts";
import sharp from "sharp";

export async function videoSourceAspect(blob: Blob): Promise<string> {
	const image = await sharp(Buffer.from(await blob.arrayBuffer()), {
		limitInputPixels: 3840 * 2160,
	}).metadata();
	if (!image.width || !image.height)
		throw new Error("Video source image dimensions are unavailable");
	return `${image.width}:${image.height}`;
}

export function videoBinariesAvailable(): boolean {
	const path = process.env.PATH ?? "";
	return Boolean(Bun.which("ffmpeg", { PATH: path }) && Bun.which("ffprobe", { PATH: path }));
}

export async function measureGeneratedVideo(path: string, signal: AbortSignal) {
	const size = (await stat(path)).size;
	const limits = effectiveMediaImportLimits();
	if (!size || size > limits.maxFileBytes)
		throw new Error("Generated video is empty or exceeds media size limit");
	return probeImportedMedia(
		path,
		{ kind: "video", originalFilename: basename(path) },
		size,
		limits,
		signal,
	);
}

export async function prepareGeneratedVideo(
	input: string,
	directory: string,
	signal: AbortSignal,
): Promise<{ video: string; poster: string | null }> {
	signal.throwIfAborted();
	const source = await measureGeneratedVideo(input, signal);
	const video = join(directory, "output.mp4");
	const poster = join(directory, "poster.jpg");
	const limits = effectiveMediaImportLimits();
	const outputLimit = Math.min(
		limits.maxFileBytes,
		limits.maxScratchBytes - source.byteSize - 8 * 1024 * 1024,
	);
	if (outputLimit <= 0) throw new Error("Generated video exceeds scratch space limit");
	const command = (path: string, args: string[]) =>
		runMediaCommand(
			"ffmpeg",
			[
				"-nostdin",
				"-hide_banner",
				"-v",
				"error",
				...MEDIA_INPUT_OPTIONS,
				"-i",
				path,
				"-map_metadata",
				"-1",
				"-threads",
				"1",
				"-filter_threads",
				"1",
				...args,
			],
			signal,
		);
	await command(input, [
		"-map",
		"0:V:0",
		"-map",
		"0:a:0?",
		...(source.videoCodec === "h264"
			? ["-c", "copy"]
			: [
					"-vf",
					"vfrdet,pad=ceil(iw/2)*2:ceil(ih/2)*2",
					"-c:v",
					"libx264",
					"-preset",
					"veryfast",
					"-crf",
					"20",
					"-pix_fmt",
					"yuv420p",
					"-fps_mode",
					"vfr",
					"-enc_time_base",
					"1:90000",
					"-c:a",
					"aac",
					"-b:a",
					"192k",
				]),
		"-movflags",
		"+faststart",
		"-fs",
		String(outputLimit),
		"-y",
		video,
	]);
	const prepared = await measureGeneratedVideo(video, signal);
	if (Math.abs(prepared.duration! - source.duration!) > 0.1)
		throw new Error("Prepared video duration differs from source");
	try {
		await command(video, [
			"-map",
			"0:V:0",
			"-frames:v",
			"1",
			"-vf",
			"scale=640:640:force_original_aspect_ratio=decrease",
			"-q:v",
			"3",
			"-y",
			poster,
		]);
		if (!(await stat(poster)).size) throw new Error("Generated poster is empty");
		signal.throwIfAborted();
		return { video, poster };
	} catch (error) {
		signal.throwIfAborted();
		console.warn("Generated video poster extraction failed", error);
		return { video, poster: null };
	}
}
