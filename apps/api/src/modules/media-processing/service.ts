import { projectMediaLibrary } from "@maleo/db/project-media-assets";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { getContentProject } from "@maleo/db/project-detail";
import { readyProjectImportByUrl } from "@maleo/db/media-imports";
import { getMediaObject, registerMediaObject, mediaObjectUrl } from "@maleo/db/media-objects";
import { getMedia } from "@maleo/storage";
import {
	createMediaClient,
	type MediaProcessingJob,
	isCaptionProcessingJob,
	type ProcessingMediaClient,
} from "@maleo/media/api";
import {
	ImportedMediaSourceSchema,
	ImportedMediaMetadataSchema,
	ProjectMediaProcessingResponseSchema,
	type ProjectMediaProcessingResponse,
} from "@maleo/shared";
import { configuredServiceToken } from "../../lib/service-token.ts";
import type { ImportSourceScope } from "../media-import/model.ts";
import type { ProcessMediaBody } from "./model.ts";

export interface MediaProcessingOptions {
	client?: ProcessingMediaClient;
}
function client(options: MediaProcessingOptions): ProcessingMediaClient {
	if (options.client) return options.client;
	const baseUrl = process.env.MALEO_GEN_WORKER_URL?.trim(),
		token = configuredServiceToken();
	if (!baseUrl || !token)
		throw new HTTPException(503, {
			message: "Configure media worker and matching service token for source edits",
		});
	return createMediaClient({ baseUrl, token });
}
const assetSchema = z
	.object({
		url: z.string(),
		label: z.string().optional(),
		kind: z.string(),
		importedSource: ImportedMediaSourceSchema.optional(),
		metadata: ImportedMediaMetadataSchema.optional(),
		dur: z.number().finite().positive().optional(),
	})
	.passthrough();

export async function sourceMedia(id: string, scope: ImportSourceScope) {
	const detail = await getContentProject(scope.project);
	const media = await getMediaObject(id);
	if (
		!detail ||
		detail.project.workspace !== scope.workspace ||
		!media ||
		media.workspace !== scope.workspace ||
		!["video", "audio"].includes(media.kind)
	)
		throw new HTTPException(404, { message: "Managed media source not found" });
	const saved = (await projectMediaLibrary(detail.project.id))
		.map((value) => assetSchema.safeParse(value))
		.find((value) => value.success && value.data.url === mediaObjectUrl(id));
	const asset = saved?.success
		? saved
		: assetSchema.safeParse(
				await readyProjectImportByUrl(scope.workspace, scope.project, mediaObjectUrl(id)),
			);
	if (
		!asset?.success ||
		asset.data.kind !== media.kind ||
		(asset.data.importedSource?.revision ?? id) !== scope.revision
	)
		throw new HTTPException(409, {
			message: "Source revision changed or is not admitted to this project",
		});
	return { media, asset: asset.data };
}

export async function authorizedProcessingSource(
	id: string,
	scope: ImportSourceScope,
): Promise<Blob | null> {
	try {
		const { media } = await sourceMedia(id, scope);
		const source = await getMedia(media.storage_key);
		if (source.size !== media.size) throw new Error("Managed source bytes changed");
		return source;
	} catch (error) {
		if (error instanceof HTTPException) return null;
		throw error;
	}
}

export async function submitSourceProcessing(
	projectId: string,
	workspace: string,
	input: ProcessMediaBody,
	options: MediaProcessingOptions,
): Promise<string> {
	const { media, asset } = await sourceMedia(input.sourceMediaId, {
		workspace,
		project: projectId,
		revision: input.sourceRevision,
	});
	if (input.operation.type === "reverse" && media.kind !== "video")
		throw new HTTPException(400, { message: "Reverse requires video source" });
	return client(options).submitProcessing({
		importId: input.requestKey,
		idempotencyKey: input.requestKey,
		workspaceId: workspace,
		projectId,
		sourceMediaId: media.id,
		sourceRevision: input.sourceRevision,
		fingerprint: media.hash,
		originalFilename: asset.label || "Media source",
		kind: media.kind === "audio" ? "audio" : "video",
		operation: input.operation,
	});
}

async function scopedJob(
	id: string,
	projectId: string,
	workspace: string,
	options: MediaProcessingOptions,
): Promise<MediaProcessingJob> {
	const job = await client(options).pollProcessing(id, { workspaceId: workspace, projectId });
	if (
		isCaptionProcessingJob(job) ||
		job.request.workspaceId !== workspace ||
		job.request.projectId !== projectId ||
		!job.request.operation ||
		!job.request.sourceMediaId
	)
		throw new HTTPException(404, { message: "Source processing not found" });
	return job;
}

export async function pollSourceProcessing(
	id: string,
	projectId: string,
	workspace: string,
	options: MediaProcessingOptions,
): Promise<ProjectMediaProcessingResponse> {
	const job = await scopedJob(id, projectId, workspace, options);
	const request = job.request;
	const { media } = await sourceMedia(request.sourceMediaId!, {
		workspace,
		project: projectId,
		revision: request.sourceRevision,
	});
	if (media.hash !== request.fingerprint)
		throw new HTTPException(409, { message: "Processing source changed" });
	let url: string | undefined;
	if (job.status === "done") {
		const result = job.result,
			derivative = result?.derivative;
		const outputKind = request.operation!.type === "audio" ? "audio" : "video";
		const expectedDuration =
			request.operation!.durationSec /
			(request.operation!.type === "audio" ? request.operation!.playbackRate : 1);
		if (
			!result ||
			!derivative ||
			result.sourceRevision !== request.sourceRevision ||
			JSON.stringify(derivative.operation) !== JSON.stringify(request.operation) ||
			result.metadata.kind !== media.kind ||
			result.metadata.byteSize !== media.size ||
			result.metadata.originalFilename !== request.originalFilename ||
			result.compatibility.preview.status !== "supported" ||
			result.compatibility.render.status !== "supported" ||
			result.playback.contentType !== `${outputKind}/mp4` ||
			derivative.metadata.kind !== outputKind ||
			!derivative.metadata.duration ||
			Math.abs(derivative.metadata.duration - expectedDuration) > 0.1 ||
			!result.playback.key.startsWith(`workspaces/${workspace}/${outputKind}/${projectId}/`)
		)
			throw new Error("Processing result does not match selected managed source");
		if ((await getMedia(result.playback.key)).size !== result.playback.size)
			throw new Error("Processing output size changed");
		url = mediaObjectUrl(
			(
				await registerMediaObject({
					workspace,
					kind: outputKind,
					hash: result.playback.hash,
					storage_key: result.playback.key,
					content_type: result.playback.contentType,
					size: result.playback.size,
				})
			).id,
		);
	}
	return ProjectMediaProcessingResponseSchema.parse({
		id: job.id,
		status: job.status === "done" ? "ready" : job.status,
		sourceMediaId: request.sourceMediaId,
		sourceRevision: request.sourceRevision,
		operation: request.operation,
		error: job.error,
		...(url ? { url, metadata: job.result!.derivative!.metadata } : {}),
	});
}

export async function cancelSourceProcessing(
	id: string,
	projectId: string,
	workspace: string,
	options: MediaProcessingOptions,
): Promise<void> {
	await scopedJob(id, projectId, workspace, options);
	await client(options).cancelProcessing(id, { workspaceId: workspace, projectId });
}
