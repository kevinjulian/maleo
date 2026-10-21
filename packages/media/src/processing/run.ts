import { bounded, downloadSource } from "./source-download.ts";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { effectiveMediaImportLimits, type MediaImportLimits } from "@maleo/shared";
import { isCaptionProcessingJob, type MediaProcessingResult } from "../api/processing.ts";
import {
	cancelProcessingJob,
	failProcessingJob,
	finishProcessingJob,
	getProcessingJob,
	startProcessingJob,
} from "../generation/store.ts";
import { mediaWorkerCacheDir } from "../paths.ts";
import { deleteMedia, putMedia, type StoredMedia } from "@maleo/storage";
import { MEDIA_INPUT_OPTIONS, probeImportedMedia, runMediaCommand } from "./probe.ts";
import { reverseSelectedSource } from "./reverse.ts";
import { processSourceAudio } from "./audio.ts";

export interface ProcessingOptions {
	apiBaseUrl: string;
	serviceToken: string;
	limits?: Partial<MediaImportLimits>;
	fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
	put?: typeof putMedia;
	remove?: typeof deleteMedia;
}

export async function runProcessingJob(
	jobId: string,
	options: ProcessingOptions,
): Promise<MediaProcessingResult | null> {
	const job = getProcessingJob(jobId);
	if (!job) throw new Error("Processing job not found");
	if (isCaptionProcessingJob(job)) throw new Error("Expected media processing job");
	if (job.status === "done") return job.result;
	if (job.status === "cancelled") return null;
	if (!options.apiBaseUrl || !options.serviceToken)
		throw new Error("Import processing requires authenticated API source access");
	const limits = effectiveMediaImportLimits(options.limits);
	if (!startProcessingJob(jobId)) return null;
	const deadlineAt =
		(getProcessingJob(jobId)!.startedAt ?? Date.now()) + limits.processingTimeoutMs;
	const remaining = deadlineAt - Date.now();
	if (remaining <= 0) {
		failProcessingJob(jobId, "Import processing deadline exceeded");
		throw new Error("Import processing deadline exceeded");
	}
	const cancelled = new AbortController();
	const deadline = AbortSignal.timeout(remaining);
	const signal = AbortSignal.any([cancelled.signal, deadline]);
	const timer = setInterval(() => {
		if (getProcessingJob(jobId)?.status === "cancelled")
			cancelled.abort(new Error("Import cancelled"));
	}, 100);
	const published: StoredMedia[] = [];
	const remove = options.remove ?? deleteMedia;
	let directory: string | undefined;
	try {
		const root = new URL(options.apiBaseUrl);
		if (!["http:", "https:"].includes(root.protocol) || root.username || root.password)
			throw new Error("Invalid import authorization endpoint");
		const { request } = job;
		const source = new URL(
			request.operation
				? `/internal/media-processing/${encodeURIComponent(request.sourceMediaId!)}/source`
				: `/internal/media-imports/${encodeURIComponent(request.importId)}/source`,
			root,
		);
		source.searchParams.set("workspace", request.workspaceId);
		source.searchParams.set("project", request.projectId);
		source.searchParams.set("revision", request.sourceRevision);
		const authorize = async (method: "GET" | "HEAD") => {
			const response = await bounded(
				(options.fetch ?? fetch)(source, {
					method,
					headers: { authorization: `Bearer ${options.serviceToken}` },
					signal,
					redirect: "error",
				}),
				signal,
			);
			if (!response.ok) throw new Error(`Import source authorization failed: ${response.status}`);
			return response;
		};
		const response = await authorize("GET");
		const cache = mediaWorkerCacheDir();
		await mkdir(cache, { recursive: true });
		directory = await mkdtemp(join(cache, "import-"));
		const input = join(directory, "source.bin");
		const size = await downloadSource(
			response,
			input,
			Math.min(limits.maxFileBytes, limits.maxScratchBytes),
			request.fingerprint,
			signal,
		);
		const metadata = await probeImportedMedia(input, request, size, limits, signal);
		const outputKind = request.operation?.type === "audio" ? "audio" : request.kind;
		const extension = outputKind === "video" ? "mp4" : outputKind === "audio" ? "m4a" : "png";
		const contentType =
			outputKind === "video" ? "video/mp4" : outputKind === "audio" ? "audio/mp4" : "image/png";
		const output = join(directory, `playback.${extension}`);
		const outputLimit = limits.maxScratchBytes - size - 8 * 1024 * 1024;
		if (outputLimit <= 0) throw new Error("Import scratch limit leaves no room for conversion");
		const conversion =
			request.kind === "image"
				? ["-map", "0:V:0", "-frames:v", "1", "-c:v", "png"]
				: request.kind === "audio"
					? [
							"-map",
							"0:a:0",
							"-vn",
							"-c:a",
							"aac",
							"-b:a",
							"192k",
							"-ac",
							"2",
							"-ar",
							"48000",
							"-movflags",
							"+faststart",
						]
					: [
							"-map",
							"0:V:0",
							"-map",
							"0:a:0?",
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
							"-movflags",
							"+faststart",
						];
		const converted = request.operation
			? (await (request.operation.type === "reverse"
					? reverseSelectedSource(input, output, metadata, request.operation, limits, signal)
					: processSourceAudio(input, output, metadata, request.operation, limits, signal)),
				undefined)
			: await runMediaCommand(
					"ffmpeg",
					[
						"-nostdin",
						"-hide_banner",
						"-v",
						request.kind === "video" ? "info" : "error",
						...MEDIA_INPUT_OPTIONS,
						"-i",
						input,
						"-map_metadata",
						"-1",
						"-threads",
						"1",
						"-filter_threads",
						"1",
						...conversion,
						"-fs",
						String(outputLimit),
						"-y",
						output,
					],
					signal,
				);
		if (metadata.frameRate && converted) {
			const variation = converted.stderr.match(/VFR:([\d.]+)/)?.[1];
			metadata.frameRate.mode =
				variation === undefined ? "unknown" : Number(variation) > 0 ? "variable" : "constant";
		}
		const outputSize = (await stat(output)).size;
		if (!outputSize || outputSize >= outputLimit)
			throw new Error("Converted media exceeds scratch limit");
		// Re-probe derivative before publication: a truncated conversion must never be ready.
		const expectedDuration = request.operation
			? request.operation.durationSec /
				(request.operation.type === "audio" ? request.operation.playbackRate : 1)
			: metadata.duration;
		const verified = await probeImportedMedia(
			output,
			{ ...request, kind: outputKind },
			outputSize,
			{
				...limits,
				maxSourceDurationSec:
					limits.maxSourceDurationSec * (request.operation?.type === "audio" ? 4 : 1),
			},
			signal,
		);
		if (
			expectedDuration &&
			(!verified.duration ||
				Math.abs(expectedDuration - verified.duration) > (request.operation ? 0.1 : 0.25))
		)
			throw new Error("Converted media did not retain complete source duration");
		// Authored ranges address admitted playback bytes, not input container padding.
		// Keep original codec/size provenance, but bound edits to the verified source.
		if (!request.operation && verified.duration) metadata.duration = verified.duration;
		let thumbnail: string | undefined;
		if (outputKind !== "audio") {
			thumbnail = join(directory, "thumbnail.png");
			await runMediaCommand(
				"ffmpeg",
				[
					"-nostdin",
					"-hide_banner",
					"-v",
					"error",
					...MEDIA_INPUT_OPTIONS,
					"-i",
					output,
					"-frames:v",
					"1",
					"-vf",
					"scale=320:320:force_original_aspect_ratio=decrease",
					"-threads",
					"1",
					"-fs",
					"8388608",
					"-y",
					thumbnail,
				],
				signal,
			);
			if (size + outputSize + (await stat(thumbnail)).size > limits.maxScratchBytes)
				throw new Error("Import scratch limit exceeded");
		}
		await authorize("HEAD");
		const publish = async (
			path: string,
			kind: "image" | "audio" | "video",
			type: string,
		): Promise<StoredMedia> => {
			signal.throwIfAborted();
			const pending = (options.put ?? putMedia)({
				workspace: request.workspaceId,
				project: request.projectId,
				kind,
				body: Bun.file(path),
				contentType: type,
				filename: path.split("/").at(-1),
			});
			void pending
				.then((stored) => (signal.aborted ? remove(stored.key) : undefined))
				.catch(() => {});
			const stored = await bounded(pending, signal);
			published.push(stored);
			return stored;
		};
		const playback = await publish(output, outputKind, contentType);
		const poster = thumbnail ? await publish(thumbnail, "image", "image/png") : undefined;
		await authorize("HEAD");
		signal.throwIfAborted();
		if (getProcessingJob(jobId)?.status === "cancelled") throw new Error("Import cancelled");
		const result: MediaProcessingResult = {
			sourceRevision: request.sourceRevision,
			metadata,
			compatibility: { preview: { status: "supported" }, render: { status: "supported" } },
			playback,
			...(poster ? { thumbnail: poster } : {}),
			...(request.operation
				? { derivative: { operation: request.operation, metadata: verified } }
				: {}),
		};
		if (!finishProcessingJob(jobId, result)) throw new Error("Import result no longer current");
		return result;
	} catch (error) {
		if (cancelled.signal.aborted) cancelProcessingJob(jobId);
		else
			failProcessingJob(
				jobId,
				deadline.aborted
					? "Import processing deadline exceeded"
					: error instanceof Error
						? error.message
						: "Import processing failed",
			);
		// Cleanup may finish after timeout; failed objects remain unpublished and
		// discoverable by the existing managed-store orphan inventory.
		await bounded(
			Promise.allSettled(published.map((stored) => remove(stored.key))),
			AbortSignal.timeout(Math.max(1, deadlineAt - Date.now())),
		).catch(() => {});
		throw error;
	} finally {
		clearInterval(timer);
		if (directory) await rm(directory, { recursive: true, force: true });
	}
}
