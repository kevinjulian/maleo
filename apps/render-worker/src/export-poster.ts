import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rm } from "node:fs/promises";
import { putMedia, type StoredMedia } from "@maleo/storage";

/** A preview failure must never discard a successfully rendered video. */
export async function publishExportPoster(input: {
	path: string;
	workspace: string;
	project: string | null;
	jobId: string;
}): Promise<StoredMedia | null> {
	const poster = `${input.path}.jpg`;
	try {
		await promisify(execFile)(
			"ffmpeg",
			[
				"-nostdin",
				"-v",
				"error",
				"-i",
				input.path,
				"-frames:v",
				"1",
				"-vf",
				"scale=w='min(640,iw)':h=-2",
				"-q:v",
				"3",
				"-y",
				poster,
			],
			{ timeout: 15000, maxBuffer: 128 * 1024 },
		);
		return await putMedia({
			workspace: input.workspace,
			project: input.project,
			kind: "image",
			body: Bun.file(poster),
			contentType: "image/jpeg",
			filename: `render-${input.jobId}.jpg`,
		});
	} catch (error) {
		console.warn(
			`[worker] poster unavailable for ${input.jobId}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return null;
	} finally {
		await rm(poster, { force: true }).catch(() => {});
	}
}
