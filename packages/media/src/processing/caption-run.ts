import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
	CAPTION_JOB_LIMITS,
	CaptionProcessingResultSchema,
	groupCaptionWords,
	type CaptionProcessingResult,
	type CaptionSourceManifest,
	type CaptionSourceBinding,
	type CaptionPhrase,
} from "@maleo/shared";
import { isCaptionProcessingJob } from "../api/processing.ts";
import {
	cancelProcessingJob,
	failProcessingJob,
	finishProcessingJob,
	getProcessingJob,
	setProcessingStage,
	startProcessingJob,
} from "../generation/store.ts";
import { mediaWorkerCacheDir } from "../paths.ts";
import type { ProcessingOptions } from "./run.ts";
import { bounded, downloadSource } from "./source-download.ts";
import { captionAudioRanges, prepareCaptionAudio } from "./caption-audio.ts";
import { runMediaCommand } from "./probe.ts";
import { transcribeLocalWhisper, whisperModel } from "./whisper.ts";

function cueSources(
	manifest: CaptionSourceManifest,
	start: number,
	end: number,
): CaptionSourceBinding[] {
	return manifest.sources.flatMap((source) => {
		const left = Math.max(start, source.timelineStartSec),
			right = Math.min(end, source.timelineStartSec + source.durationSec);
		if (right <= left) return [];
		const binding = source.binding;
		if (source.loop) return [binding];
		const a = (left - source.timelineStartSec) * source.playbackRate;
		const b = (right - source.timelineStartSec) * source.playbackRate;
		return [
			{
				...binding,
				sourceStartSec: source.reverse ? binding.sourceEndSec - b : binding.sourceStartSec + a,
				sourceEndSec: source.reverse ? binding.sourceEndSec - a : binding.sourceStartSec + b,
			},
		];
	});
}

export async function runCaptionJob(
	jobId: string,
	options: ProcessingOptions,
): Promise<CaptionProcessingResult | null> {
	const job = getProcessingJob(jobId);
	if (!job || !isCaptionProcessingJob(job)) throw new Error("Caption job not found");
	if (job.status === "done") return job.result;
	if (job.status === "cancelled") return null;
	if (!options.apiBaseUrl || !options.serviceToken)
		throw new Error("Caption processing requires authenticated API access");
	if (!startProcessingJob(jobId)) return null;
	const remaining =
		(getProcessingJob(jobId)!.startedAt ?? Date.now()) +
		Math.min(
			CAPTION_JOB_LIMITS.timeoutMs,
			options.limits?.processingTimeoutMs ?? CAPTION_JOB_LIMITS.timeoutMs,
		) -
		Date.now();
	if (remaining <= 0) {
		failProcessingJob(jobId, "Caption processing deadline exceeded");
		throw new Error("Caption processing deadline exceeded");
	}
	const cancelled = new AbortController(),
		deadline = AbortSignal.timeout(remaining);
	const signal = AbortSignal.any([cancelled.signal, deadline]);
	const timer = setInterval(() => {
		if (getProcessingJob(jobId)?.status === "cancelled")
			cancelled.abort(new Error("Captions cancelled"));
	}, 100);
	let directory: string | undefined;
	try {
		const { request } = job,
			{ manifest } = request;
		if (
			createHash("sha256").update(JSON.stringify(manifest)).digest("hex") !== request.manifestHash
		)
			throw new Error("Caption manifest identity changed");
		const root = new URL(options.apiBaseUrl);
		if (!["http:", "https:"].includes(root.protocol) || root.username || root.password)
			throw new Error("Invalid caption authorization endpoint");
		const authorize = async (index: number, method: "GET" | "HEAD") => {
			const source = manifest.sources[index]!;
			const url = new URL(
				`/internal/media-processing/${encodeURIComponent(source.mediaId)}/source`,
				root,
			);
			url.searchParams.set("workspace", request.workspaceId);
			url.searchParams.set("project", request.projectId);
			url.searchParams.set("revision", source.sourceRevision);
			const response = await bounded(
				(options.fetch ?? fetch)(url, {
					method,
					redirect: "error",
					signal,
					headers: { authorization: `Bearer ${options.serviceToken}` },
				}),
				signal,
			);
			if (!response.ok)
				throw new Error("Caption source authorization changed; regenerate captions");
			return response;
		};
		setProcessingStage(jobId, "preparing-audio");
		const cache = mediaWorkerCacheDir();
		await mkdir(cache, { recursive: true });
		directory = await mkdtemp(join(cache, "captions-"));
		const paths: string[] = [];
		const downloaded = new Map<string, string>();
		let inputBytes = 0;
		for (const [index, source] of manifest.sources.entries()) {
			const identity = JSON.stringify([source.mediaId, source.sourceRevision, source.fingerprint]);
			const existing = downloaded.get(identity);
			if (existing) {
				paths.push(existing);
				continue;
			}
			const path = join(directory, `input-${index}.bin`);
			inputBytes += await downloadSource(
				await authorize(index, "GET"),
				path,
				CAPTION_JOB_LIMITS.maxInputBytes - inputBytes,
				source.fingerprint,
				signal,
			);
			paths.push(path);
			downloaded.set(identity, path);
		}
		const audioPath = await prepareCaptionAudio(manifest, paths, directory, signal);
		setProcessingStage(jobId, "recognizing-speech");
		const phrases: CaptionPhrase[] = [];
		let detectedLanguage: string | undefined;
		let fromCache = true;
		for (const [index, range] of captionAudioRanges(manifest).entries()) {
			const duration = range.endSec - range.startSec;
			let input = audioPath;
			if (range.startSec !== manifest.startSec || range.endSec !== manifest.endSec) {
				input = join(directory, `recognition-${index}.wav`);
				await runMediaCommand(
					"ffmpeg",
					[
						"-nostdin",
						"-v",
						"error",
						"-ss",
						String(range.startSec - manifest.startSec),
						"-i",
						audioPath,
						"-t",
						String(duration),
						"-c:a",
						"pcm_s16le",
						input,
					],
					signal,
				);
			}
			const transcript = await transcribeLocalWhisper({
				audioPath: input,
				language: request.language,
				force: true,
				signal,
			});
			fromCache &&= transcript?.cached ?? false;
			detectedLanguage ??= transcript?.detectedLanguage;
			const words = (transcript?.words ?? []).flatMap((word) => {
				const startSec = Math.max(0, word.startSec),
					endSec = Math.min(duration, word.endSec);
				return endSec > startSec ? [{ ...word, startSec, endSec }] : [];
			});
			phrases.push(
				...groupCaptionWords(words).map((phrase) => ({
					...phrase,
					startSec: range.startSec + phrase.startSec,
					endSec: range.startSec + phrase.endSec,
				})),
			);
			if (input !== audioPath) await rm(input);
		}
		signal.throwIfAborted();
		setProcessingStage(jobId, "building-captions");
		const model = whisperModel();
		const cues = phrases.flatMap((phrase, index) => {
			const startSec = phrase.startSec;
			const endSec = phrase.endSec;
			const sources = cueSources(manifest, startSec, endSec);
			if (!sources.length || endSec <= startSec || phrase.endSec > manifest.endSec + 0.001)
				return [];
			return [
				{
					id: `caption:${jobId}:${index}`,
					type: "caption" as const,
					startSec,
					durationSec: endSec - startSec,
					track: request.captionTrack,
					caption: {
						text: phrase.text,
						words: phrase.words.map((word) => ({
							...word,
							endSec: Math.min(word.endSec, endSec - startSec),
						})),
						provenance: {
							origin: "recognized" as const,
							wordTimingOrigin: phrase.estimatedWordTiming
								? ("estimated" as const)
								: ("recognized" as const),
							engine: "whisper.cpp",
							model,
							runId: jobId,
						},
						sources,
						protection: { text: false, timing: false, segmentation: false, style: false },
						revision: 0,
						groupId: jobId,
						status: "current" as const,
					},
				},
			];
		});
		for (let index = 0; index < manifest.sources.length; index++) await authorize(index, "HEAD");
		signal.throwIfAborted();
		const result = CaptionProcessingResultSchema.parse({
			type: "captions",
			cues,
			language: request.language,
			...(detectedLanguage ? { detectedLanguage } : {}),
			engine: "whisper.cpp",
			model,
			fromCache,
		});
		if (!finishProcessingJob(jobId, result)) throw new Error("Caption result no longer current");
		return result;
	} catch (error) {
		if (cancelled.signal.aborted) cancelProcessingJob(jobId);
		else
			failProcessingJob(
				jobId,
				deadline.aborted
					? "Caption processing deadline exceeded"
					: "Caption processing failed; check source and worker readiness, then retry",
			);
		throw error;
	} finally {
		clearInterval(timer);
		if (directory) await rm(directory, { recursive: true, force: true });
	}
}
