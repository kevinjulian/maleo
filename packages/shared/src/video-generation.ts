import { z } from "zod";

/** Actual source metadata; timeline placement duration is owned by the caller. */
export const generatedVideoSchema = z.object({
	url: z.string().min(1),
	posterUrl: z.string().min(1).optional(),
	durationSec: z.number().finite().positive(),
	providerId: z.string().min(1),
	model: z.string().min(1),
});
export type GeneratedVideo = z.infer<typeof generatedVideoSchema>;
