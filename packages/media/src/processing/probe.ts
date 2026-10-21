import { execFile } from "node:child_process";
import { z } from "zod";
import {
	ImportedMediaMetadataSchema,
	type ImportedMediaMetadata,
	type MediaImportLimits,
	type MediaFrameRate,
} from "@maleo/shared";
import type { MediaProcessingRequest } from "../api/processing.ts";

export const MEDIA_INPUT_OPTIONS = [
	"-protocol_whitelist",
	"file,pipe",
	"-format_whitelist",
	"mov,matroska,webm,wav,mp3,aac,flac,ogg,png_pipe,jpeg_pipe,webp_pipe",
	"-max_alloc",
	"67108864",
	"-threads",
	"1",
];

/** Fixed argv, no shell; bounded logs and caller-owned total deadline. */
export interface MediaCommandOutput {
	stdout: string;
	stderr: string;
}
export async function runMediaCommand(
	binary: string,
	args: readonly string[],
	signal: AbortSignal,
): Promise<MediaCommandOutput> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		let output: MediaCommandOutput | undefined;
		let failure: Error | null = null;
		const child = execFile(
			binary,
			[...args],
			{
				signal,
				killSignal: "SIGKILL",
				maxBuffer: 1024 * 1024,
				encoding: "utf8",
			},
			(error, stdout, stderr) => {
				failure = error;
				output = { stdout, stderr };
			},
		);
		// Abort callbacks can precede process exit; cleanup must wait for owned child to close.
		child.once("close", () => {
			if (signal.aborted) reject(signal.reason);
			else if (failure) reject(failure);
			else if (output) resolve(output);
			else reject(new Error("Media process closed without output"));
		});
	});
}

const streamSchema = z.object({
	codec_type: z.string(),
	codec_name: z.string().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
	duration: z.string().optional(),
	avg_frame_rate: z.string().optional(),
	r_frame_rate: z.string().optional(),
	disposition: z.object({ attached_pic: z.number().optional() }).optional(),
});
const probeSchema = z.object({
	streams: z.array(streamSchema),
	format: z.object({
		format_name: z.string().optional(),
		duration: z.string().optional(),
		tags: z.object({ major_brand: z.string().optional() }).optional(),
	}),
});

function rate(raw: string | undefined): MediaFrameRate["nominal"] {
	const values = raw?.split("/").map(Number);
	if (!values || values.length !== 2) return undefined;
	const [numerator, denominator] = values;
	if (
		!numerator ||
		!denominator ||
		!Number.isInteger(numerator) ||
		!Number.isInteger(denominator) ||
		numerator < 0 ||
		denominator < 0
	)
		return undefined;
	return { numerator, denominator };
}

export async function probeImportedMedia(
	path: string,
	request: Pick<MediaProcessingRequest, "kind" | "originalFilename">,
	byteSize: number,
	limits: MediaImportLimits,
	signal: AbortSignal,
): Promise<ImportedMediaMetadata> {
	const result = await runMediaCommand(
		"ffprobe",
		[
			"-v",
			"error",
			...MEDIA_INPUT_OPTIONS,
			"-show_entries",
			"format=format_name,duration:format_tags=major_brand:stream=codec_type,codec_name,width,height,duration,avg_frame_rate,r_frame_rate:stream_disposition=attached_pic",
			"-of",
			"json",
			path,
		],
		signal,
	);
	const probe = probeSchema.parse(JSON.parse(result.stdout));
	const video = probe.streams.find(
		(stream) => stream.codec_type === "video" && !stream.disposition?.attached_pic,
	);
	const audio = probe.streams.find((stream) => stream.codec_type === "audio");
	const container = probe.format.format_name;
	const imageContainer =
		container?.endsWith("_pipe") ||
		container?.includes("image2") ||
		["avif", "avis"].includes(probe.format.tags?.major_brand ?? "");
	const kind = video ? (imageContainer ? "image" : "video") : audio ? "audio" : undefined;
	if (!kind || kind !== request.kind) throw new Error("File bytes do not match claimed media type");
	const duration = Number(probe.format.duration ?? video?.duration ?? audio?.duration);
	const nominal = rate(video?.r_frame_rate);
	const average = rate(video?.avg_frame_rate);
	const metadata = ImportedMediaMetadataSchema.parse({
		originalFilename: request.originalFilename,
		byteSize,
		kind,
		container,
		videoCodec: video?.codec_name,
		audioCodec: audio?.codec_name,
		width: video?.width,
		height: video?.height,
		duration: kind !== "image" && Number.isFinite(duration) && duration > 0 ? duration : undefined,
		hasAudio: Boolean(audio),
		frameRate: kind === "video" ? { mode: "unknown", nominal, average } : undefined,
	});
	if (
		metadata.width &&
		metadata.height &&
		(Math.max(metadata.width, metadata.height) > limits.maxWidth ||
			Math.min(metadata.width, metadata.height) > limits.maxHeight)
	)
		throw new Error(`Source exceeds ${limits.maxWidth}×${limits.maxHeight} decoded size limit`);
	if (metadata.duration && metadata.duration > limits.maxSourceDurationSec)
		throw new Error(`Source exceeds ${limits.maxSourceDurationSec / 60} minute duration limit`);
	if (kind !== "image" && !metadata.duration)
		throw new Error("Source duration could not be measured; re-export file");
	return metadata;
}
