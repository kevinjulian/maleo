/* What `@maleo/video` sends back, as parsers rather than claims.
 *
 * These are a COPY of the service's own types, not an import. `@maleo/video`
 * cannot import `@maleo/shared` (see `packages/video/src/exports.ts`), and the
 * API talks to it over HTTP, so there is no module the two sides can share.
 * `video-response-schemas.test.ts` is what keeps the copy honest: it asserts
 * these parsers still accept the shapes the service's `Job` type produces, and
 * fails if either side changes alone.
 *
 * Every object here PASSES THROUGH unknown keys, which is deliberate and is not
 * laziness. `routes/video.ts` forwards these bodies to the web client with
 * `c.json(job)`, so stripping a field the service added but this file has not
 * heard of would silently delete it from the browser's copy. Passthrough
 * validates what we declare and forwards the rest untouched — which is exactly
 * what the assertions these replace were doing, minus the pretending.
 */
import { z } from "zod";

export const renderJobStatusSchema = z.enum([
	"queued",
	"running",
	"done",
	"done_with_fallback",
	"error",
	"cancelled",
]);

export const renderJobPhaseSchema = z.enum([
	"queued",
	"validating",
	"preparing_images",
	"synthesizing_audio",
	"bundling",
	"rendering",
	"finalizing",
	"done",
	"failed",
]);

/* Optional where the API's `RenderJob` declares the field optional, because the
 * client's consumers already handle those being absent. Required where the
 * service always sends one and the API type says so — `id`, `preset`, `status`,
 * `progress`, `backend` and the timestamps. A response missing one of those is
 * not a render job, and treating it as one is the bug this parse exists to
 * catch. */
export const renderJobSchema = z
	.object({
		id: z.string(),
		product_json: z.string(),
		preset: z.string(),
		status: renderJobStatusSchema,
		phase: renderJobPhaseSchema.optional(),
		phase_detail: z.string().nullable().optional(),
		output_path: z.string().nullable(),
		output_url: z.string().nullable().optional(),
		thumbnail_path: z.string().nullable().optional(),
		thumbnail_storage: z.string().nullable().optional(),
		thumbnail_url: z.string().nullable().optional(),
		manifest_path: z.string().nullable().optional(),
		image_status: z.string().nullable().optional(),
		duration_sec: z.number().nullable().optional(),
		error: z.string().nullable(),
		error_code: z.string().nullable().optional(),
		cost_usd: z.number().nullable(),
		progress: z.number(),
		backend: z.enum(["local", "lambda"]),
		attempts: z.number().optional(),
		max_attempts: z.number().optional(),
		created_at: z.number(),
		started_at: z.number().nullable(),
		finished_at: z.number().nullable(),
		workspace: z.string().nullable().optional(),
		project_id: z.string().nullable().optional(),
		output_storage: z.string().nullable().optional(),
		manifest_storage: z.string().nullable().optional(),
	})
	.passthrough();

export const videoPresetSchema = z
	.object({
		id: z.string(),
		compositionId: z.string(),
		maxDurationSec: z.number(),
		codec: z.string(),
		videoBitrate: z.string(),
		label: z.string().optional(),
		aspect: z.enum(["vertical", "square", "horizontal"]).optional(),
		aspectRatio: z.string().optional(),
		hint: z.string().optional(),
	})
	.passthrough();

export const videoTemplateSchema = z
	.object({
		id: z.enum(["classic", "split-screen", "before-after", "testimonial"]),
		label: z.string(),
	})
	.passthrough();

export const presetsResponseSchema = z.object({ items: z.array(videoPresetSchema) }).passthrough();
export const templatesResponseSchema = z
	.object({ items: z.array(videoTemplateSchema) })
	.passthrough();

/* The paging fields are optional here for the same reason the old assertion
 * wrote `Partial<VideoJobsPage> & { items: RenderJob[] }`: the client derives
 * every one of them from `items.length` when absent. `items` is the only field
 * it cannot derive. */
export const jobsPageResponseSchema = z
	.object({
		items: z.array(renderJobSchema),
		project_ids: z.array(z.string()).optional(),
		legacy_job_ids: z.array(z.string()).optional(),
		total: z.number().optional(),
		limit: z.number().optional(),
		offset: z.number().optional(),
		has_more: z.boolean().optional(),
		next_offset: z.number().nullable().optional(),
	})
	.passthrough();
