import { createHash } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
	CAPTION_JOB_LIMITS,
	CaptionApplyContextSchema,
	CaptionJobResponseSchema,
	CaptionLanguageSchema,
	CaptionSourceManifestSchema,
	captureCaptionResult,
	timelineAudioSources,
	type CaptionAudioSource,
} from "@maleo/shared";
import type { EditScope } from "@maleo/shared/editor";
import {
	createMediaClient,
	isCaptionProcessingJob,
	MediaWorkerHttpError,
	type CaptionProcessingJob,
	type ProcessingMediaClient,
} from "@maleo/media/api";
import { activeCaller, activeWorkspace } from "../../lib/active-workspace.ts";
import { editorEngine } from "../../lib/editor-engine.ts";
import { configuredServiceToken } from "../../lib/service-token.ts";
import { assertImportProject } from "../media-import/service.ts";
import { sourceMedia, type MediaProcessingOptions } from "./service.ts";

const requestSchema = z
	.object({
		requestKey: z
			.string()
			.min(1)
			.max(160)
			.regex(/^[A-Za-z0-9_-]+$/),
		doc: z.record(z.unknown()),
		source: z.union([
			z.literal("all"),
			z.object({ clipId: z.string().min(1), visualId: z.string().min(1).optional() }).strict(),
		]),
		sourceRevisions: z
			.record(z.string().uuid(), z.string().min(1).max(160))
			.refine((value) => Object.keys(value).length <= CAPTION_JOB_LIMITS.maxSources),
		language: CaptionLanguageSchema,
		captionTrack: z.number().int().nonnegative(),
		replaceEdited: z.boolean().default(false),
	})
	.strict();
type CaptionRequest = z.infer<typeof requestSchema>;
function client(options: MediaProcessingOptions): ProcessingMediaClient {
	if (options.client) return options.client;
	const baseUrl = process.env.MALEO_GEN_WORKER_URL?.trim(),
		token = configuredServiceToken();
	if (!baseUrl || !token)
		throw new HTTPException(503, {
			message: "Configure media worker and service token for captions",
		});
	return createMediaClient({ baseUrl, token });
}

export async function submitCaptions(
	projectId: string,
	workspaceId: string,
	input: CaptionRequest,
	options: MediaProcessingOptions,
): Promise<string> {
	const admitted = editorEngine().executeOnce(
		JSON.stringify({ doc: input.doc, mediaAssets: [], slides: [], posts: [] }),
		'{"type":"noop"}',
	);
	if (!admitted.ok) throw new HTTPException(400, { message: "Invalid caption source document" });
	// SAFETY: Rust admitted the complete document and returned its canonical editor wire type.
	const scope = (JSON.parse(admitted.value) as { scope: EditScope }).scope;
	const selection = input.source;
	const selected = timelineAudioSources(scope.doc, scope.doc.trackFlags).filter(
		(source) =>
			selection === "all" ||
			(source.clipId === selection.clipId &&
				(!selection.visualId || source.visualId === selection.visualId)),
	);
	if (!selected.length)
		throw new HTTPException(400, { message: "Select an audible audio or video source" });
	if (selected.length > CAPTION_JOB_LIMITS.maxSources)
		throw new HTTPException(413, { message: "Caption source count exceeds limit" });
	const sources: CaptionAudioSource[] = [];
	for (const source of selected) {
		const mediaId = /^\/api\/media\/([0-9a-f-]{36})$/.exec(source.url)?.[1];
		if (!mediaId)
			throw new HTTPException(400, { message: "Captions require media admitted to this project" });
		const revision = input.sourceRevisions[mediaId];
		if (!revision)
			throw new HTTPException(409, {
				message: "Source revision missing; reload media and retry captions",
			});
		const { media, asset } = await sourceMedia(mediaId, {
			workspace: workspaceId,
			project: projectId,
			revision,
		});
		if (asset.metadata?.hasAudio === false) continue;
		const sourceDurationSec = asset.metadata?.duration ?? asset.dur;
		if (!sourceDurationSec)
			throw new HTTPException(409, {
				message: "Source duration unavailable; re-import media before generating captions",
			});
		const owner = scope.doc.clips.find((clip) => clip.id === source.clipId);
		if (
			!source.loop &&
			!owner?.scene &&
			// Browser duration can include a final codec packet; manifest below clamps to measured media.
			source.mediaStartSec + source.durationSec * source.playbackRate > sourceDurationSec + 0.05
		)
			throw new HTTPException(400, {
				message:
					"Selected clip exceeds admitted source duration; trim it before generating captions",
			});
		const durationSec = source.loop
			? source.durationSec
			: Math.min(
					source.durationSec,
					(sourceDurationSec - source.mediaStartSec) / source.playbackRate,
				);
		if (durationSec <= 0)
			throw new HTTPException(400, { message: "Selected source interval is empty" });
		const sourceEndSec = source.loop
			? sourceDurationSec
			: source.mediaStartSec + durationSec * source.playbackRate;
		sources.push({
			binding: {
				clipId: source.clipId,
				...(source.visualId ? { visualId: source.visualId } : {}),
				mediaId,
				mediaRevision: revision,
				sourceStartSec: source.mediaStartSec,
				sourceEndSec,
			},
			mediaId,
			sourceRevision: revision,
			fingerprint: media.hash,
			kind: media.kind === "audio" ? "audio" : "video",
			role: source.kind,
			timelineStartSec: source.startSec,
			durationSec,
			sourceDurationSec,
			playbackRate: source.playbackRate,
			preservePitch: source.preservePitch,
			reverse: source.reverse,
			volume: source.volume,
			fadeInSec: source.fadeInSec,
			fadeOutSec: source.fadeOutSec,
			duckUnderVoice: source.duckUnderVoice,
			animation: source.animation,
			loop: source.loop,
		});
	}
	if (!sources.length)
		throw new HTTPException(400, { message: "Selected sources contain no audible audio" });
	const startSec = Math.min(...sources.map((source) => source.timelineStartSec));
	const endSec = Math.max(...sources.map((source) => source.timelineStartSec + source.durationSec));
	const parsed = CaptionSourceManifestSchema.safeParse({ version: 1, startSec, endSec, sources });
	if (!parsed.success)
		throw new HTTPException(413, {
			message: "Caption source scope exceeds duration or manifest limits",
		});
	const manifest = parsed.data;
	const context = captureCaptionResult(scope.doc, {
		startSec,
		endSec,
		sources: sources.map((source) => source.binding),
	});
	const request = {
		type: "captions" as const,
		workspaceId,
		projectId,
		idempotencyKey: input.requestKey,
		manifest,
		manifestHash: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
		language: input.language,
		captionTrack: input.captionTrack,
		applyContext: JSON.stringify({ ...context, replaceEdited: input.replaceEdited }),
	};
	if (Buffer.byteLength(JSON.stringify(request)) > CAPTION_JOB_LIMITS.maxBodyBytes)
		throw new HTTPException(413, {
			message: "Caption request exceeds manifest size limit; select a smaller source scope",
		});
	return client(options).submitProcessing(request);
}

async function captionJob(
	id: string,
	projectId: string,
	workspaceId: string,
	options: MediaProcessingOptions,
): Promise<CaptionProcessingJob> {
	const job = await client(options).pollProcessing(id, { projectId, workspaceId });
	if (
		!isCaptionProcessingJob(job) ||
		job.request.projectId !== projectId ||
		job.request.workspaceId !== workspaceId
	)
		throw new HTTPException(404, { message: "Caption job not found" });
	return job;
}

export function projectCaptionRoutes(options: MediaProcessingOptions = {}): Hono {
	const app = new Hono();
	app.onError((error, c) => {
		if (error instanceof HTTPException)
			return c.json({ error: "caption_request_failed", message: error.message }, error.status);
		if (error instanceof MediaWorkerHttpError && error.status === 409)
			return c.json(
				{
					error: "caption_job_conflict",
					message:
						"Caption job already active or request changed; cancel it or retry with a new request",
				},
				409,
			);
		console.error("[captions]", error);
		return c.json(
			{
				error: "caption_request_failed",
				message: "Caption worker unavailable; check Settings and retry",
			},
			503,
		);
	});
	app.use(
		"/:id/captions/*",
		bodyLimit({ maxSize: CAPTION_JOB_LIMITS.maxBodyBytes }),
		async (c, next) => {
			await assertImportProject(
				c.req.param("id")!,
				activeWorkspace(c),
				activeCaller(c).userId,
				true,
			);
			await next();
		},
	);
	app.get("/:id/captions/readiness", async (c) =>
		c.json(await client(options).processingReadiness("captions")),
	);
	app.post("/:id/captions/jobs", async (c) => {
		const input = requestSchema.safeParse(await c.req.json().catch(() => null));
		if (!input.success) return c.json({ error: "invalid_caption_request" }, 400);
		return c.json(
			{ id: await submitCaptions(c.req.param("id"), activeWorkspace(c), input.data, options) },
			202,
		);
	});
	app.get("/:id/captions/jobs/:jobId", async (c) => {
		const job = await captionJob(
			c.req.param("jobId"),
			c.req.param("id"),
			activeWorkspace(c),
			options,
		);
		for (const source of job.request.manifest.sources) {
			const { media } = await sourceMedia(source.mediaId, {
				workspace: activeWorkspace(c),
				project: c.req.param("id"),
				revision: source.sourceRevision,
			});
			if (media.hash !== source.fingerprint)
				throw new HTTPException(409, { message: "Caption source changed; regenerate captions" });
		}
		return c.json(
			CaptionJobResponseSchema.parse({
				id: job.id,
				status: job.status,
				stage: job.stage ?? null,
				error: job.error,
				language: job.request.language,
				sourceCount: job.request.manifest.sources.length,
				result: job.result,
				context: CaptionApplyContextSchema.parse(JSON.parse(job.request.applyContext)),
			}),
		);
	});
	app.delete("/:id/captions/jobs/:jobId", async (c) => {
		const job = await captionJob(
			c.req.param("jobId"),
			c.req.param("id"),
			activeWorkspace(c),
			options,
		);
		await client(options).cancelProcessing(job.id, {
			projectId: c.req.param("id"),
			workspaceId: activeWorkspace(c),
		});
		return c.json({ ok: true });
	});
	return app;
}
