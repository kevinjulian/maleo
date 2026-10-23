import { z } from "zod";
import { ImportedMediaKindSchema, MediaIdSchema } from "@maleo/shared";

export const ImportSourceScopeSchema = z.object({
	workspace: z.string().min(1).max(160),
	project: z.string().min(1).max(160),
	revision: z.string().min(1).max(160),
});
export type ImportSourceScope = z.infer<typeof ImportSourceScopeSchema>;

export const ImportUploadHeadersSchema = z.object({
	/** The client-minted media identity the import publishes under. */
	requestKey: MediaIdSchema,
	filename: z.string().min(1).max(1024),
	kind: ImportedMediaKindSchema,
	batchSize: z.number().int().positive().max(50).default(1),
	/** Client-declared file size. Proxies may re-chunk the body and drop Content-Length,
	 *  so this is the only way the API can tell a truncated upload from a complete one. */
	declaredBytes: z.number().int().positive().optional(),
});
export type ImportUploadHeaders = z.infer<typeof ImportUploadHeadersSchema>;
