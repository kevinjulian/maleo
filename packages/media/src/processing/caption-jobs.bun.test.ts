import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { CAPTION_JOB_LIMITS } from "@maleo/shared";
import { CaptionProcessingRequestSchema, isCaptionProcessingJob } from "../api/processing.ts";
import {
	cancelProcessingJob,
	createProcessingJob,
	failProcessingJob,
	finishProcessingJob,
	getProcessingJob,
	setProcessingStage,
	startProcessingJob,
} from "../generation/store.ts";

function request() {
	const mediaId = randomUUID();
	return CaptionProcessingRequestSchema.parse({
		type: "captions",
		workspaceId: "captions-proof",
		projectId: randomUUID(),
		idempotencyKey: randomUUID(),
		language: "id",
		captionTrack: 2,
		manifestHash: "a".repeat(64),
		applyContext: "{}",
		manifest: {
			version: 1,
			startSec: 0,
			endSec: 3,
			sources: [
				{
					binding: {
						clipId: "video:1",
						mediaId,
						mediaRevision: "r1",
						sourceStartSec: 1,
						sourceEndSec: 4,
					},
					mediaId,
					sourceRevision: "r1",
					fingerprint: "b".repeat(64),
					kind: "video",
					role: "sfx",
					timelineStartSec: 0,
					durationSec: 3,
					sourceDurationSec: 10,
					playbackRate: 1,
					preservePitch: true,
					reverse: false,
					volume: 1,
					fadeInSec: 0,
					fadeOutSec: 0,
					loop: false,
				},
			],
		},
	});
}
const result = {
	type: "captions" as const,
	cues: [],
	language: "id",
	engine: "whisper.cpp",
	model: "base",
	fromCache: false,
};

test("caption contracts refuse paths, identity mismatches and unbounded manifests", () => {
	const input = request(),
		source = input.manifest.sources[0]!;
	expect(
		CaptionProcessingRequestSchema.safeParse({ ...input, url: "https://untrusted.test" }).success,
	).toBe(false);
	for (const change of [
		{ mediaId: randomUUID() },
		{ sourceDurationSec: 2 },
		{ durationSec: 4 },
		{ path: "/tmp/audio.wav" },
		{ volume: Infinity },
	]) {
		expect(
			CaptionProcessingRequestSchema.safeParse({
				...input,
				manifest: {
					...input.manifest,
					sources: [{ ...source, ...change }],
				},
			}).success,
		).toBe(false);
	}
	expect(
		CaptionProcessingRequestSchema.safeParse({
			...input,
			manifest: {
				...input.manifest,
				endSec: CAPTION_JOB_LIMITS.maxDurationSec + 1,
			},
		}).success,
	).toBe(false);
	expect(
		CaptionProcessingRequestSchema.safeParse({
			...input,
			manifest: {
				...input.manifest,
				sources: Array.from({ length: CAPTION_JOB_LIMITS.maxSources + 1 }, () => source),
			},
		}).success,
	).toBe(false);
});

test("caption jobs freeze retry identity, scope concurrency and persist stages/results", () => {
	const input = request(),
		job = createProcessingJob(input);
	expect(isCaptionProcessingJob(job)).toBe(true);
	expect(createProcessingJob(input).id).toBe(job.id);
	expect(() => createProcessingJob({ ...input, language: "en" })).toThrow("does not match");
	expect(() => createProcessingJob({ ...input, idempotencyKey: randomUUID() })).toThrow(
		"already active",
	);
	const other = createProcessingJob({ ...input, projectId: randomUUID() });
	cancelProcessingJob(other.id);
	expect(startProcessingJob(job.id)).toBe(true);
	const started = getProcessingJob(job.id)!.startedAt;
	expect(setProcessingStage(job.id, "recognizing-speech")).toBe(true);
	failProcessingJob(job.id, "temporary process failure");
	expect(startProcessingJob(job.id)).toBe(true);
	expect(getProcessingJob(job.id)).toMatchObject({
		stage: "recognizing-speech",
		startedAt: started,
	});
	expect(finishProcessingJob(job.id, result)).toBe(true);
	expect(getProcessingJob(job.id)).toMatchObject({ status: "done", stage: "ready", result });
	expect(startProcessingJob(job.id)).toBe(false);
	expect(finishProcessingJob(job.id, result)).toBe(false);
});

test("cancellation stays terminal before start, during processing and after completion", () => {
	for (const state of ["queued", "processing", "done"]) {
		const job = createProcessingJob(request());
		if (state !== "queued") startProcessingJob(job.id);
		if (state === "done") finishProcessingJob(job.id, result);
		expect(cancelProcessingJob(job.id)).toBe(true);
		expect(startProcessingJob(job.id)).toBe(false);
		expect(setProcessingStage(job.id, "recognizing-speech")).toBe(false);
		expect(finishProcessingJob(job.id, result)).toBe(false);
		failProcessingJob(job.id, "late failure");
		expect(getProcessingJob(job.id)).toMatchObject({ status: "cancelled", result: null });
	}
});

test("a delayed durable retry cannot exceed project caption concurrency", () => {
	const input = request(),
		first = createProcessingJob(input);
	startProcessingJob(first.id);
	failProcessingJob(first.id, "retry pending");
	const next = createProcessingJob({ ...input, idempotencyKey: randomUUID() });
	expect(startProcessingJob(first.id)).toBe(false);
	expect(startProcessingJob(next.id)).toBe(true);
	cancelProcessingJob(next.id);
	expect(startProcessingJob(first.id)).toBe(true);
	cancelProcessingJob(first.id);
});
