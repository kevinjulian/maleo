import { z } from "zod";
const positive = z.number().int().positive();
const identity = { sourceId: z.string().min(1), revision: z.string().min(1) };
const presentation = z
	.tuple([z.number().finite(), z.number().finite()])
	.refine(([start, end]) => end > start);
export const visualRequestSchema = z.object({
	consumer: z.string().min(1),
	generation: z.number().int().nonnegative(),
	sequence: z.number().int().nonnegative(),
	...identity,
	time: z.number().finite(),
	width: positive,
	height: positive,
	kind: z.enum(["image", "video"]),
});
export const visualLeaseSchema = z.object({
	id: positive,
	bytes: positive,
	request: visualRequestSchema,
});
export const videoLeaseSchema = visualLeaseSchema.extend({
	request: visualRequestSchema.extend({ kind: z.literal("video") }),
});
export const frameIdentitySchema = z.object({
	...identity,
	start: z.number().finite(),
	end: z.number().finite(),
	presentation: presentation.optional(),
	width: positive,
	height: positive,
});
export const videoMetadataSchema = z.object({
	width: positive,
	height: positive,
	slots: z.union([z.literal(1), z.literal(2)]),
	firstTimestamp: z.number().finite(),
});
export type VideoLease = z.infer<typeof videoLeaseSchema>;
export type VisualLease = z.infer<typeof visualLeaseSchema>;
export type VideoMetadata = z.infer<typeof videoMetadataSchema>;
export interface LocalVideoSource {
	id: string;
	revision: string;
	file: File;
	metadata: VideoMetadata;
}
export const videoRequestSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("init"),
		source: z.object({
			id: z.string().min(1),
			revision: z.string().min(1),
			file: z.instanceof(File),
			metadata: videoMetadataSchema,
		}),
	}),
	z.object({ type: z.literal("grant"), slots: z.union([z.literal(1), z.literal(2)]) }),
	z.object({ type: z.literal("frame"), requestId: positive, lease: videoLeaseSchema }),
	z.object({
		type: z.literal("reservation"),
		requestId: positive,
		accepted: z.boolean(),
		message: z.string().optional(),
		/** Refused because the request went stale, not because the budget failed. */
		cancelled: z.boolean().optional(),
	}),
	z.object({ type: z.literal("cancel") }),
	z.object({ type: z.literal("dispose") }),
]);
export const videoReplySchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("metadata"), metadata: videoMetadataSchema }),
	z.object({
		type: z.literal("reserve"),
		requestId: positive,
		width: positive,
		height: positive,
		bytes: positive,
	}),
	z.object({
		type: z.literal("frame"),
		requestId: positive,
		lease: positive,
		identity: frameIdentitySchema.extend({ presentation }),
		/** A transferred `VideoFrame` for the GPU copy, or straight RGBA when the source needs a canvas (rotation). */
		pixels: z.union([
			z.instanceof(Uint8Array),
			z.custom<VideoFrame>(
				(value) => typeof VideoFrame !== "undefined" && value instanceof VideoFrame,
			),
		]),
	}),
	z.object({
		type: z.literal("failed"),
		requestId: positive,
		message: z.string(),
		cancelled: z.boolean(),
	}),
	z.object({ type: z.literal("fatal"), message: z.string() }),
	z.object({ type: z.literal("disposed") }),
]);
export type DecodedVideoFrame = Extract<z.infer<typeof videoReplySchema>, { type: "frame" }>;
