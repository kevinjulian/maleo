import { z } from "zod";
const generation = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const audioOutputRequest = z.discriminatedUnion("type", [
	z.object({ type: z.literal("block"), id, generation, pcm: z.instanceof(Float32Array) }).strict(),
	z.object({ type: z.literal("play"), generation }).strict(),
	z.object({ type: z.literal("flush"), generation }).strict(),
	z.object({ type: z.literal("dispose") }).strict(),
]);
export const audioOutputReply = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("position"),
			generation,
			frames: generation,
			renderFrame: generation,
			state: z.enum(["paused", "playing", "buffering"]),
		})
		.strict(),
	z.object({ type: z.literal("released"), ids: z.array(id) }).strict(),
	z.object({ type: z.literal("flushed"), generation, ids: z.array(id) }).strict(),
	z.object({ type: z.literal("failed"), message: z.string().min(1) }).strict(),
]);
export type AudioOutputPosition = Extract<z.infer<typeof audioOutputReply>, { type: "position" }>;
