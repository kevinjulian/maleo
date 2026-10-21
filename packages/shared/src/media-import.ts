import { z } from "zod";

export const ImportedMediaKindSchema = z.enum(["image", "video", "audio"]);
export type ImportedMediaKind = z.infer<typeof ImportedMediaKindSchema>;

/** Selected original-source seconds; processing never accepts arbitrary filters. */
export const MediaReverseOperationSchema = z
	.object({
		type: z.literal("reverse"),
		startSec: z.number().finite().min(0),
		durationSec: z
			.number()
			.finite()
			.positive()
			.max(30 * 60),
	})
	.strict();
export type MediaReverseOperation = z.infer<typeof MediaReverseOperationSchema>;

/** Fixed source-audio extraction/retime request; filters stay worker-owned. */
export const MediaAudioOperationSchema = z
	.object({
		type: z.literal("audio"),
		startSec: z.number().finite().min(0),
		durationSec: z
			.number()
			.finite()
			.positive()
			.max(30 * 60),
		playbackRate: z.number().finite().min(0.25).max(4),
		preservePitch: z.boolean(),
		reverse: z.boolean(),
	})
	.strict();
export type MediaAudioOperation = z.infer<typeof MediaAudioOperationSchema>;
export const MediaProcessingOperationSchema = z.discriminatedUnion("type", [
	MediaReverseOperationSchema,
	MediaAudioOperationSchema,
]);
export type MediaProcessingOperation = z.infer<typeof MediaProcessingOperationSchema>;

export const MediaImportStateSchema = z.enum([
	"queued",
	"uploading",
	"processing",
	"ready",
	"failed",
	"cancelled",
]);
export type MediaImportState = z.infer<typeof MediaImportStateSchema>;

const positive = z.number().finite().positive();
const rationalRate = z.object({ numerator: positive.int(), denominator: positive.int() });

/** Nominal and measured average rates do not establish constant frame timing. */
export const MediaFrameRateSchema = z.object({
	mode: z.enum(["constant", "variable", "unknown"]),
	nominal: rationalRate.optional(),
	average: rationalRate.optional(),
});
export type MediaFrameRate = z.infer<typeof MediaFrameRateSchema>;

export const ImportedMediaMetadataSchema = z.object({
	originalFilename: z.string().min(1).max(1024),
	byteSize: z.number().int().nonnegative(),
	kind: ImportedMediaKindSchema,
	container: z.string().min(1).optional(),
	videoCodec: z.string().min(1).optional(),
	audioCodec: z.string().min(1).optional(),
	width: positive.int().optional(),
	height: positive.int().optional(),
	duration: positive.optional(),
	frameRate: MediaFrameRateSchema.optional(),
	hasAudio: z.boolean().optional(),
});
export type ImportedMediaMetadata = z.infer<typeof ImportedMediaMetadataSchema>;

const compatibilityPath = z.object({
	status: z.enum(["unknown", "supported", "unsupported", "processing", "failed"]),
	reason: z.string().min(1).optional(),
});
export const MediaCompatibilitySchema = z.object({
	preview: compatibilityPath,
	render: compatibilityPath,
});
export type MediaCompatibility = z.infer<typeof MediaCompatibilitySchema>;

/** Unknown legacy sources retain their prior path; known failures stay blocked. */
export function mediaCompatibilityReason(
	compatibility: MediaCompatibility | undefined,
	path: "preview" | "render",
): string | undefined {
	const value = compatibility?.[path];
	return value && !["unknown", "supported"].includes(value.status)
		? (value.reason ?? `Media ${path} ${value.status}`)
		: undefined;
}

/** References are stable API media IDs, never caller-supplied storage keys. */
const sourceRevisionSchema = z.object({
	revision: z.string().min(1),
	fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
	originalMediaId: z.string().min(1),
	playbackMediaId: z.string().min(1).optional(),
	thumbnailMediaId: z.string().min(1).optional(),
});
export const ImportedMediaSourceSchema = sourceRevisionSchema.extend({
	/** Earlier immutable sources remain addressable without changing project identity. */
	history: z
		.array(
			z.object({
				url: z.string(),
				metadata: ImportedMediaMetadataSchema.optional(),
				source: sourceRevisionSchema.optional(),
			}),
		)
		.optional(),
});
export type ImportedMediaSource = z.infer<typeof ImportedMediaSourceSchema>;

export const ImportedMediaFieldsSchema = z.object({
	metadata: ImportedMediaMetadataSchema.optional(),
	compatibility: MediaCompatibilitySchema.optional(),
	importedSource: ImportedMediaSourceSchema.optional(),
});
export type ImportedMediaFields = z.infer<typeof ImportedMediaFieldsSchema>;

export const StoredImportMediaSchema = z.object({
	key: z.string().min(1),
	hash: z.string().regex(/^[a-f0-9]{64}$/),
	size: z.number().int().nonnegative(),
	contentType: z.string().min(1),
});
export type StoredImportMedia = z.infer<typeof StoredImportMediaSchema>;

export const ReadyImportedMediaSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	url: z.string().regex(/^\/api\/media\/[0-9a-f-]{36}$/),
	kind: ImportedMediaKindSchema,
	source: z.literal("upload"),
	dur: positive.optional(),
	thumb: z
		.string()
		.regex(/^\/api\/media\/[0-9a-f-]{36}$/)
		.optional(),
	metadata: ImportedMediaMetadataSchema,
	compatibility: MediaCompatibilitySchema,
	importedSource: ImportedMediaSourceSchema,
});
export type ReadyImportedMedia = z.infer<typeof ReadyImportedMediaSchema>;

export const ProjectMediaImportResponseSchema = z
	.object({
		id: z.string().min(1),
		filename: z.string().min(1),
		status: MediaImportStateSchema,
		asset: ReadyImportedMediaSchema.nullable(),
		error: z.string().nullable(),
	})
	.refine(
		(value) => value.status !== "ready" || value.asset !== null,
		"Ready import requires asset",
	);
export type ProjectMediaImportResponse = z.infer<typeof ProjectMediaImportResponseSchema>;

export const ProjectMediaProcessingResponseSchema = z
	.object({
		id: z.string().min(1),
		status: z.enum(["queued", "processing", "ready", "failed", "cancelled"]),
		sourceMediaId: z.string().uuid(),
		sourceRevision: z.string().min(1),
		operation: MediaProcessingOperationSchema,
		error: z.string().nullable(),
		url: z
			.string()
			.regex(/^\/api\/media\/[0-9a-f-]{36}$/)
			.optional(),
		metadata: ImportedMediaMetadataSchema.optional(),
	})
	.refine(
		(value) =>
			value.status !== "ready" ||
			Boolean(
				value.url &&
				value.metadata?.kind === (value.operation.type === "audio" ? "audio" : "video") &&
				value.metadata.duration,
			),
		"Ready processing requires verified derivative output",
	);
export type ProjectMediaProcessingResponse = z.infer<typeof ProjectMediaProcessingResponseSchema>;

export const ProjectMediaImportPageSchema = z.object({
	items: z.array(z.object({ requestKey: z.string(), import: ProjectMediaImportResponseSchema })),
	nextCursor: z.string().nullable(),
});
export type ProjectMediaImportPage = z.infer<typeof ProjectMediaImportPageSchema>;

export const MediaImportLimitsSchema = z.object({
	maxFileBytes: positive.int(),
	maxBatchFiles: positive.int(),
	maxConcurrentUploads: positive.int(),
	maxConcurrentProcessing: positive.int(),
	processingTimeoutMs: positive.int(),
	maxSourceDurationSec: positive,
	maxWidth: positive.int(),
	maxHeight: positive.int(),
	maxScratchBytes: positive.int(),
});
export type MediaImportLimits = z.infer<typeof MediaImportLimitsSchema>;

export const MediaImportReadinessSchema = z.object({
	available: z.boolean(),
	limits: MediaImportLimitsSchema,
	reason: z.string().optional(),
});
export type MediaImportReadiness = z.infer<typeof MediaImportReadinessSchema>;

export const DEFAULT_MEDIA_IMPORT_LIMITS: Readonly<MediaImportLimits> = Object.freeze({
	// Under the 100 MB request-body cap Cloudflare puts in front of the deployed app (use-media-while-uploading 1.7).
	maxFileBytes: 50 * 1024 * 1024,
	maxBatchFiles: 50,
	maxConcurrentUploads: 2,
	maxConcurrentProcessing: 1,
	processingTimeoutMs: 10 * 60 * 1000,
	maxSourceDurationSec: 30 * 60,
	maxWidth: 3840,
	maxHeight: 2160,
	maxScratchBytes: 2 * 1024 * 1024 * 1024,
});

/** Deployment may tighten ceilings. Invalid configuration fails at its boundary. */
/** Server request-body ceiling for import uploads. Bun defaults to 128 MiB, below the
 *  import limit; one MiB of headroom lets the import route answer oversize files itself. */
export const MAX_IMPORT_REQUEST_BYTES = DEFAULT_MEDIA_IMPORT_LIMITS.maxFileBytes + 1024 * 1024;

export function effectiveMediaImportLimits(
	overrides: Partial<MediaImportLimits> = {},
): MediaImportLimits {
	const configured = MediaImportLimitsSchema.parse({
		...DEFAULT_MEDIA_IMPORT_LIMITS,
		...overrides,
	});
	return MediaImportLimitsSchema.parse(
		Object.fromEntries(
			MediaImportLimitsSchema.keyof().options.map((key) => [
				key,
				Math.min(configured[key], DEFAULT_MEDIA_IMPORT_LIMITS[key]),
			]),
		),
	);
}

export const SUPPORTED_MEDIA_IMPORT_EXTENSIONS = Object.freeze({
	image: ["png", "jpg", "jpeg", "webp", "avif"],
	video: ["mp4", "mov", "webm"],
	audio: ["wav", "mp3", "m4a", "aac", "flac", "ogg"],
});

/** Picker hint only; worker must establish actual kind from file bytes. */
export function mediaImportFilenameKind(filename: string): ImportedMediaKind | undefined {
	const extension = filename.split(".").at(-1)?.toLowerCase();
	if (!extension || !filename.includes(".")) return undefined;
	return ImportedMediaKindSchema.options.find((kind) =>
		SUPPORTED_MEDIA_IMPORT_EXTENSIONS[kind].includes(extension),
	);
}

/** Optional imported fields do not fabricate metadata for older library assets. */
export function parseImportedMediaFields(value: {
	metadata?: unknown;
	compatibility?: unknown;
	importedSource?: unknown;
}): ImportedMediaFields {
	const metadata = ImportedMediaMetadataSchema.safeParse(value.metadata);
	const compatibility = MediaCompatibilitySchema.safeParse(value.compatibility);
	const source = ImportedMediaSourceSchema.safeParse(value.importedSource);
	return {
		...(metadata.success ? { metadata: metadata.data } : {}),
		...(compatibility.success ? { compatibility: compatibility.data } : {}),
		...(source.success ? { importedSource: source.data } : {}),
	};
}
