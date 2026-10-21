import { z } from "zod";
import { CaptionClipSchema, CaptionSourceBindingSchema } from "./caption-cues.ts";
import { audioAnimationSchema } from "./clip-animation.ts";
import { CaptionApplyContextSchema } from "./caption-results.ts";

export const CAPTION_JOB_LIMITS = {
	maxDurationSec: 900,
	maxSources: 32,
	maxBodyBytes: 512 * 1024,
	maxActivePerProject: 1,
	maxInputBytes: 1024 * 1024 * 1024,
	maxScratchBytes: 2 * 1024 * 1024 * 1024,
	timeoutMs: 30 * 60 * 1000,
} as const;

const seconds = z.number().finite().nonnegative();
export const CaptionLanguageSchema = z
	.string()
	.regex(/^(auto|[a-z]{2,3}(?:-[A-Za-z0-9]+)*)$/)
	.max(24);

/** An admitted immutable source and its audible placement. No URL or path crosses this boundary. */
export const CaptionAudioSourceSchema = z
	.object({
		binding: CaptionSourceBindingSchema,
		mediaId: z.string().uuid(),
		sourceRevision: z.string().min(1).max(160),
		fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
		kind: z.enum(["audio", "video"]),
		role: z.enum(["voiceover", "music", "sfx", "ambient", "accent_hit"]),
		timelineStartSec: seconds,
		durationSec: z.number().finite().positive().max(CAPTION_JOB_LIMITS.maxDurationSec),
		sourceDurationSec: z.number().finite().positive(),
		playbackRate: z.number().finite().min(0.25).max(4),
		preservePitch: z.boolean(),
		reverse: z.boolean(),
		volume: z.number().finite().min(0).max(4),
		fadeInSec: seconds,
		fadeOutSec: seconds,
		duckUnderVoice: z.number().finite().min(0).max(1).optional(),
		loop: z.boolean(),
		animation: audioAnimationSchema.optional(),
	})
	.strict()
	.superRefine((source, context) => {
		if (
			source.binding.mediaId !== source.mediaId ||
			source.binding.mediaRevision !== source.sourceRevision
		)
			context.addIssue({
				code: "custom",
				message: "Caption binding must match admitted source identity",
			});
		if (
			source.binding.sourceEndSec > source.sourceDurationSec + 1e-6 ||
			source.binding.sourceStartSec >= source.sourceDurationSec
		)
			context.addIssue({
				code: "custom",
				message: "Caption source interval exceeds admitted media",
			});
		if (
			!source.loop &&
			Math.abs(
				source.binding.sourceEndSec -
					source.binding.sourceStartSec -
					source.durationSec * source.playbackRate,
			) > 1e-6
		)
			context.addIssue({
				code: "custom",
				message: "Caption placement must retain original source interval",
			});
	});
export type CaptionAudioSource = z.infer<typeof CaptionAudioSourceSchema>;

export const CaptionSourceManifestSchema = z
	.object({
		version: z.literal(1),
		startSec: seconds,
		endSec: z.number().finite().positive(),
		sources: z.array(CaptionAudioSourceSchema).min(1).max(CAPTION_JOB_LIMITS.maxSources),
	})
	.strict()
	.superRefine((manifest, context) => {
		if (
			manifest.endSec <= manifest.startSec ||
			manifest.endSec - manifest.startSec > CAPTION_JOB_LIMITS.maxDurationSec
		)
			context.addIssue({ code: "custom", message: "Caption scope exceeds duration limit" });
		for (const source of manifest.sources) {
			if (
				source.timelineStartSec < manifest.startSec ||
				source.timelineStartSec + source.durationSec > manifest.endSec + 1e-6
			)
				context.addIssue({ code: "custom", message: "Caption source placement exceeds scope" });
		}
	});
export type CaptionSourceManifest = z.infer<typeof CaptionSourceManifestSchema>;

export const CaptionProcessingResultSchema = z
	.object({
		type: z.literal("captions"),
		cues: z.array(CaptionClipSchema).max(10_000),
		language: CaptionLanguageSchema,
		detectedLanguage: z.string().min(1).max(24).optional(),
		engine: z.string().min(1).max(160),
		model: z.string().min(1).max(160),
		fromCache: z.boolean(),
	})
	.strict();
export type CaptionProcessingResult = z.infer<typeof CaptionProcessingResultSchema>;

export const CaptionEngineReadinessSchema = z.object({
	available: z.boolean(),
	model: z.string(),
	runtime: z.string(),
	reason: z.string().optional(),
});
export type CaptionEngineReadiness = z.infer<typeof CaptionEngineReadinessSchema>;

/** Project API response; worker storage internals do not enter editor state. */
export const CaptionJobResponseSchema = z.object({
	id: z.string().min(1),
	status: z.enum(["queued", "processing", "done", "failed", "cancelled"]),
	stage: z.enum(["preparing-audio", "recognizing-speech", "building-captions", "ready"]).nullable(),
	error: z.string().nullable(),
	language: CaptionLanguageSchema,
	sourceCount: z.number().int().positive().max(CAPTION_JOB_LIMITS.maxSources),
	result: CaptionProcessingResultSchema.nullable(),
	context: CaptionApplyContextSchema,
});
export type CaptionJobResponse = z.infer<typeof CaptionJobResponseSchema>;
