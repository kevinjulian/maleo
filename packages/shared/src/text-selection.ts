import { z } from "zod";

export const THINKING_LEVELS = ["off", "low", "medium", "high", "max"] as const;
export const thinkingLevelSchema = z.enum(THINKING_LEVELS);
export type ThinkingLevel = z.infer<typeof thinkingLevelSchema>;

export const textModelIdSchema = z
	.string()
	.min(1)
	.max(256)
	.regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]*$/);

/** Public model choice. Endpoint configuration belongs only to the server. */
export const textSelectionSchema = z
	.object({
		providerId: z
			.string()
			.min(1)
			.max(64)
			.regex(/^[a-z][a-z0-9-]*$/),
		model: textModelIdSchema,
		thinking: thinkingLevelSchema.optional(),
	})
	.strict();

export type TextSelection = z.infer<typeof textSelectionSchema>;

/** Server-owned capture. Identity binds the run to an endpoint without its URL or key. */
export const capturedTextSelectionSchema = z
	.object({
		selection: textSelectionSchema,
		endpointIdentity: z.string().regex(/^[a-f0-9]{64}$/),
	})
	.strict();

export type CapturedTextSelection = z.infer<typeof capturedTextSelectionSchema>;
