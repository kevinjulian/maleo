import { z } from "zod";
import { generatedVideoSchema, type GeneratedVideo } from "@maleo/shared";
import { getGlobalSetting } from "@maleo/db/global-settings";
import { getContentProject } from "@maleo/db/project-detail";
import {
	getLegacyMediaLink,
	getMediaObject,
	mediaObjectUrl,
	registerMediaObject,
} from "@maleo/db/media-objects";
import { getMedia } from "@maleo/storage";
import { resolveProvider, videoSourceAspect } from "@maleo/media/providers";
import { getMediaClient } from "../image-gen-client.ts";
import { meter } from "../metering/meter.ts";

export const VIDEO_PROVIDER_SETTING = "media.provider.video";
const inputSchema = z.object({
	imageUrl: z.string().min(1),
	prompt: z.string().max(20000),
	durationSec: z.number().finite().positive().max(60),
});

/** Shared editor/agent animation. Caller context, never model arguments, decides ownership. */
export async function generateVideo(
	input: z.infer<typeof inputSchema>,
	context: { workspace: string; projectId?: string | null },
): Promise<GeneratedVideo> {
	inputSchema.parse(input);
	if (!context.workspace) throw new Error("Video generation requires a workspace");
	if (context.projectId) {
		const project = await getContentProject(context.projectId);
		if (!project || project.project.workspace !== context.workspace)
			throw new Error("Video project owner mismatch");
	}
	const id =
		/^\/api\/media\/([0-9a-f-]{36})$/.exec(input.imageUrl)?.[1] ??
		(await getLegacyMediaLink(input.imageUrl, context.workspace));
	const source = id ? await getMediaObject(id) : null;
	if (!source || source.workspace !== context.workspace || source.kind !== "image")
		throw new Error("Video source is not owned managed image");
	const blob = await getMedia(source.storage_key);
	const aspect = await videoSourceAspect(blob);
	const media = getMediaClient();
	if (!media) throw new Error("media worker not configured");
	const stored = await getGlobalSetting(VIDEO_PROVIDER_SETTING);
	const provider = resolveProvider("video", stored ? { workspace: { video: stored } } : {});
	const readiness = await media.videoReadiness();
	if (readiness[provider.meta.id] !== "ready")
		throw new Error(
			`selected video provider "${provider.meta.id}" is ${readiness[provider.meta.id] ?? "unconfigured"} on media worker`,
		);
	const model = provider.meta.models?.video;
	if (!model) throw new Error(`video provider "${provider.meta.id}" declares no model`);
	const selectedSource = stored
		? stored === provider.meta.id
			? "workspace"
			: "default"
		: process.env.MALEO_PROVIDER_VIDEO?.trim()
			? "env"
			: "default";
	return meter({
		operation: "video",
		quantity: provider.meta.id === "sandbox" ? 4 : Math.max(1, Math.round(input.durationSec)),
		provider: provider.meta.id,
		model,
		reference: "video:animate",
		workspace: context.workspace,
		metadata: {
			requestedDurationSec: input.durationSec,
			projectId: context.projectId,
			sourceMediaId: source.id,
		},
		identity: [
			source.id,
			input.prompt,
			input.durationSec,
			provider.meta.id,
			model,
			context.projectId,
		],
		run: async (idempotencyKey) => {
			const jobId = await media.submitVideo({
				imageUrl: source.storage_key,
				prompt: input.prompt,
				durationSec: input.durationSec,
				aspect,
				workspaceId: context.workspace,
				projectId: context.projectId ?? undefined,
				providerId: provider.meta.id,
				providerSource: selectedSource,
				idempotencyKey,
			});
			for (let attempt = 0; attempt < 200; attempt++) {
				const job = await media.poll(jobId);
				if (job.status === "failed") throw new Error(job.error || "Video generation failed");
				if (job.status === "done") {
					if (
						job.kind !== "video" ||
						!job.stored ||
						job.providerId !== provider.meta.id ||
						!job.durationSec ||
						!job.model ||
						!job.stored.key.startsWith(`workspaces/${context.workspace}/video/`) ||
						job.stored.contentType !== "video/mp4"
					)
						throw new Error("Invalid video job result or storage owner mismatch");
					const file = await getMedia(job.stored.key);
					if (file.size !== job.stored.size) throw new Error("Video job output size changed");
					let posterUrl: string | undefined;
					if (job.poster) {
						if (
							!job.poster.key.startsWith(`workspaces/${context.workspace}/image/`) ||
							job.poster.contentType !== "image/jpeg"
						)
							throw new Error("Invalid video poster or storage owner mismatch");
						const posterFile = await getMedia(job.poster.key);
						if (posterFile.size !== job.poster.size) throw new Error("Video poster size changed");
						const poster = await registerMediaObject({
							workspace: context.workspace,
							kind: "image",
							hash: job.poster.hash,
							storage_key: job.poster.key,
							content_type: job.poster.contentType,
							size: job.poster.size,
						});
						posterUrl = mediaObjectUrl(poster.id);
					}
					const object = await registerMediaObject({
						workspace: context.workspace,
						kind: "video",
						hash: job.stored.hash,
						storage_key: job.stored.key,
						content_type: job.stored.contentType,
						size: job.stored.size,
					});
					return generatedVideoSchema.parse({
						url: mediaObjectUrl(object.id),
						...(posterUrl ? { posterUrl } : {}),
						durationSec: job.durationSec,
						providerId: job.providerId,
						model: job.model,
					});
				}
				await new Promise((resolve) => setTimeout(resolve, 1500));
			}
			throw new Error("Video generation timed out");
		},
	});
}
