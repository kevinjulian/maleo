import { mediaObjectUrl, registerMediaObject } from "@maleo/db/media-objects";
import { getMedia, MediaObjectMissingError, type StoredMedia } from "@maleo/storage";
import type { RenderJob } from "./video-client.ts";
import type { Db } from "@maleo/db/handle";

async function register(
	raw: string | null | undefined,
	workspace: string,
	kind: "video" | "manifest" | "image",
	db?: Db,
): Promise<string | null> {
	if (!raw) return null;
	// SAFETY: this is an untrusted service response. Fields are checked below;
	// registerMediaObject then validates hash, workspace key, and size together.
	const stored = JSON.parse(raw) as StoredMedia;
	if (
		typeof stored.key !== "string" ||
		typeof stored.hash !== "string" ||
		typeof stored.size !== "number" ||
		typeof stored.contentType !== "string"
	)
		throw new Error("invalid render storage metadata");
	await getMedia(stored.key);
	return mediaObjectUrl(
		(
			await registerMediaObject(
				{
					workspace,
					kind,
					hash: stored.hash,
					storage_key: stored.key,
					content_type: stored.contentType,
					size: stored.size,
				},
				db,
			)
		).id,
	);
}

export async function resolveRenderMedia(job: RenderJob, db?: Db): Promise<RenderJob> {
	if (!job.workspace || !job.output_storage) return job;
	const allowMissing = (error: unknown): null => {
		if (error instanceof MediaObjectMissingError) return null;
		throw error;
	};
	const output = await register(job.output_storage, job.workspace, "video", db).catch(allowMissing);
	const manifest = await register(job.manifest_storage, job.workspace, "manifest", db).catch(
		allowMissing,
	);
	const thumbnail = await register(job.thumbnail_storage, job.workspace, "image", db).catch(
		() => null,
	);
	return {
		...job,
		output_url: output,
		output_path: null,
		manifest_path: manifest,
		thumbnail_url: thumbnail,
	};
}
