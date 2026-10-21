import { z } from "zod";
import { MediaProcessingOperationSchema } from "@maleo/shared";

export const ProcessMediaBodySchema = z
	.object({
		sourceMediaId: z.string().uuid(),
		sourceRevision: z.string().min(1).max(160),
		requestKey: z
			.string()
			.min(1)
			.max(160)
			.regex(/^[A-Za-z0-9_-]+$/),
		operation: MediaProcessingOperationSchema,
	})
	.strict();
export type ProcessMediaBody = z.infer<typeof ProcessMediaBodySchema>;
