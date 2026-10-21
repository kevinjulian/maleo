import { z } from "zod";
import {
	ImportedMediaKindSchema,
	ImportedMediaMetadataSchema,
	MediaCompatibilitySchema,
	StoredImportMediaSchema,
	MediaImportReadinessSchema,
	MediaProcessingOperationSchema,
	CaptionSourceManifestSchema,
	CaptionLanguageSchema,
	CaptionProcessingResultSchema,
	CaptionEngineReadinessSchema,
	CAPTION_JOB_LIMITS,
} from "@maleo/shared";

const identity = z.string().min(1).max(160);

/** API-owned import identity; neither URLs, paths nor storage keys are accepted. */
export const MediaProcessingRequestSchema = z
	.object({
		importId: identity,
		workspaceId: identity,
		projectId: identity,
		sourceRevision: identity,
		fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
		originalFilename: z.string().min(1).max(1024),
		kind: ImportedMediaKindSchema,
		idempotencyKey: identity,
		operation: MediaProcessingOperationSchema.optional(),
		sourceMediaId: z.string().uuid().optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (
			Boolean(value.operation) !== Boolean(value.sourceMediaId) ||
			(value.operation &&
				(value.kind === "image" || (value.operation.type === "reverse" && value.kind !== "video")))
		)
			ctx.addIssue({
				code: "custom",
				message: "Source processing requires managed compatible media identity",
			});
	});
export const CaptionProcessingRequestSchema = z
	.object({
		type: z.literal("captions"),
		workspaceId: identity,
		projectId: identity,
		idempotencyKey: identity,
		manifest: CaptionSourceManifestSchema,
		manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
		language: CaptionLanguageSchema,
		captionTrack: z.number().int().nonnegative(),
		// API-authored immutable apply evidence; worker stores and echoes it without interpretation.
		applyContext: z.string().min(2).max(CAPTION_JOB_LIMITS.maxBodyBytes),
	})
	.strict();
export const ProcessingRequestSchema = z.union([
	MediaProcessingRequestSchema,
	CaptionProcessingRequestSchema,
]);
export type MediaProcessingRequest = z.infer<typeof MediaProcessingRequestSchema>;
export type CaptionProcessingRequest = z.infer<typeof CaptionProcessingRequestSchema>;
export type ProcessingRequest = z.infer<typeof ProcessingRequestSchema>;

export const MediaProcessingResultSchema = z.object({
	sourceRevision: identity,
	metadata: ImportedMediaMetadataSchema,
	compatibility: MediaCompatibilitySchema,
	playback: StoredImportMediaSchema,
	thumbnail: StoredImportMediaSchema.optional(),
	derivative: z
		.object({ operation: MediaProcessingOperationSchema, metadata: ImportedMediaMetadataSchema })
		.optional(),
});
export const ProcessingResultSchema = z.union([
	MediaProcessingResultSchema,
	CaptionProcessingResultSchema,
]);
export type MediaProcessingResult = z.infer<typeof MediaProcessingResultSchema>;
export type ProcessingResult = z.infer<typeof ProcessingResultSchema>;

export const ProcessingStageSchema = z.enum([
	"preparing-audio",
	"recognizing-speech",
	"building-captions",
	"ready",
]);
const jobFields = {
	id: identity,
	status: z.enum(["queued", "processing", "done", "failed", "cancelled"]),
	stage: ProcessingStageSchema.nullable().optional(),
	error: z.string().nullable(),
	createdAt: z.number(),
	startedAt: z.number().nullable(),
	finishedAt: z.number().nullable(),
};
export const MediaProcessingJobSchema = z.object({
	...jobFields,
	request: MediaProcessingRequestSchema,
	result: MediaProcessingResultSchema.nullable(),
});
export const CaptionProcessingJobSchema = z.object({
	...jobFields,
	request: CaptionProcessingRequestSchema,
	result: CaptionProcessingResultSchema.nullable(),
});
export const ProcessingJobSchema = z.union([MediaProcessingJobSchema, CaptionProcessingJobSchema]);
export type ProcessingJob = z.infer<typeof ProcessingJobSchema>;
export type CaptionProcessingJob = z.infer<typeof CaptionProcessingJobSchema>;
export type MediaProcessingJob = z.infer<typeof MediaProcessingJobSchema>;
export function isCaptionProcessingJob(job: ProcessingJob): job is CaptionProcessingJob {
	return "type" in job.request && job.request.type === "captions";
}

export const ProcessingReadinessSchema = MediaImportReadinessSchema.extend({
	captions: CaptionEngineReadinessSchema.optional(),
});
export type ProcessingReadiness = z.infer<typeof ProcessingReadinessSchema>;
