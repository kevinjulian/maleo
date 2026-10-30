import { z } from "zod";
const identity = { sourceId: z.string().min(1), revision: z.string().min(1) };
export const audioMetadataSchema = z
	.object({
		sampleRate: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
		channels: z.number().int().positive(),
		firstTimestamp: z.number().finite(),
		frames: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	})
	.strict();
export type AudioMetadata = z.infer<typeof audioMetadataSchema>;
export const audioDecodeRequest = z
	.object({
		...identity,
		file: z.instanceof(File),
		start: z.number().finite().nonnegative(),
		end: z.number().finite().positive(),
		/** Validated source length; skips a duration scan that can read the whole file. */
		frames: z.number().int().positive().optional(),
	})
	.strict()
	.refine((request) => request.end > request.start && request.end - request.start <= 2);
export type AudioDecodeRequest = z.infer<typeof audioDecodeRequest>;
export const audioWindowMetadata = z
	.object({
		...identity,
		...audioMetadataSchema.shape,
		sampleRate: z.number().int().min(8000).max(192000),
		channels: z.union([z.literal(1), z.literal(2)]),
		start: z.number().int().nonnegative(),
		count: z.number().int().positive(),
	})
	.strict()
	.refine(
		(metadata) =>
			metadata.start + metadata.count <= metadata.frames &&
			metadata.count <= metadata.sampleRate * 2,
	);
export const audioDecodeReply = z.discriminatedUnion("type", [
	z.object({ type: z.literal("reserve"), metadata: audioWindowMetadata }).strict(),
	z
		.object({
			type: z.literal("decoded"),
			metadata: audioWindowMetadata,
			pcm: z.instanceof(Float32Array),
		})
		.strict(),
	z.object({ type: z.literal("failed"), message: z.string().min(1) }).strict(),
]);
export type AudioWindowMetadata = z.infer<typeof audioWindowMetadata>;
