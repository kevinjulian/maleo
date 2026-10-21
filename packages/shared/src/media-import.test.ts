import { expect, test } from "vite-plus/test";
import {
	DEFAULT_MEDIA_IMPORT_LIMITS,
	effectiveMediaImportLimits,
	ImportedMediaMetadataSchema,
	mediaImportFilenameKind,
	parseImportedMediaFields,
	MediaReverseOperationSchema,
	ProjectMediaProcessingResponseSchema,
} from "./media-import.ts";

test("import metadata stays measured, distinguishes variable timing, and leaves legacy data neutral", () => {
	const metadata = ImportedMediaMetadataSchema.parse({
		originalFilename: "Camera take.MOV",
		byteSize: 128,
		kind: "video",
		frameRate: { mode: "variable", nominal: { numerator: 30000, denominator: 1001 } },
	});
	expect(metadata.originalFilename).toBe("Camera take.MOV");
	expect(metadata.frameRate?.mode).toBe("variable");
	expect(metadata.duration).toBeUndefined();
	expect(metadata.hasAudio).toBeUndefined();
	expect(parseImportedMediaFields({})).toEqual({});
	expect(parseImportedMediaFields({ metadata: { ...metadata, duration: -1 } })).toEqual({});
	expect(parseImportedMediaFields({ metadata })).toEqual({ metadata });
	expect(
		ImportedMediaMetadataSchema.safeParse({
			...metadata,
			frameRate: {
				mode: "constant",
				average: { numerator: 30, denominator: 0 },
			},
		}).success,
	).toBe(false);
});

test("reverse DTO rejects arbitrary filters and requires durable verified video before readiness", () => {
	const operation = { type: "reverse", startSec: 0.5, durationSec: 1 };
	for (const invalid of [
		{ ...operation, startSec: -1 },
		{ ...operation, durationSec: 0 },
		{ ...operation, startSec: Infinity },
		{ ...operation, durationSec: 1801 },
		{
			...operation,
			filter: "untrusted",
		},
	])
		expect(MediaReverseOperationSchema.safeParse(invalid).success).toBe(false);
	const pending = {
		id: "job",
		status: "processing",
		sourceMediaId: "00000000-0000-0000-0000-000000000098",
		sourceRevision: "r1",
		operation,
		error: null,
	};
	expect(ProjectMediaProcessingResponseSchema.safeParse(pending).success).toBe(true);
	expect(
		ProjectMediaProcessingResponseSchema.safeParse({ ...pending, status: "ready" }).success,
	).toBe(false);
	const ready = {
		...pending,
		status: "ready",
		url: "/api/media/00000000-0000-0000-0000-000000000099",
		metadata: { originalFilename: "Source", byteSize: 10, kind: "video", duration: 1 },
	};
	expect(ProjectMediaProcessingResponseSchema.safeParse(ready).success).toBe(true);
	expect(
		ProjectMediaProcessingResponseSchema.safeParse({
			...ready,
			metadata: { ...ready.metadata, kind: "audio" },
		}).success,
	).toBe(false);
	expect(
		ProjectMediaProcessingResponseSchema.safeParse({ ...ready, url: "https://untrusted.test" })
			.success,
	).toBe(false);
});

test("effective import limits cannot widen deployment ceilings; filename hints are not detection", () => {
	expect(effectiveMediaImportLimits()).toEqual(DEFAULT_MEDIA_IMPORT_LIMITS);
	expect(
		effectiveMediaImportLimits({ maxFileBytes: 1024, maxConcurrentProcessing: 10 }),
	).toMatchObject({ maxFileBytes: 1024, maxConcurrentProcessing: 1 });
	expect(() => effectiveMediaImportLimits({ processingTimeoutMs: 0 })).toThrow();
	expect(mediaImportFilenameKind("Camera.MOV")).toBe("video");
	expect(mediaImportFilenameKind("voice.flac")).toBe("audio");
	expect(mediaImportFilenameKind("picture.avif")).toBe("image");
	expect(mediaImportFilenameKind("video.mp4.exe")).toBeUndefined();
});
