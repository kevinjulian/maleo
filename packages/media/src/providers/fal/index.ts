import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { mediaWorkerCacheDir } from "../../paths.ts";
import { resolveConfig } from "../config.ts";
import { measureGeneratedVideo, videoBinariesAvailable } from "../video-output.ts";
import type { ContentProvider } from "../types.ts";
import { addressMedia } from "@maleo/storage";

const DEFAULT_MODEL = "fal-ai/ltx-video-13b-distilled/image-to-video";
const responseSchema = z.object({ video: z.object({ url: z.string().url() }) });

export const falProvider: ContentProvider = {
	meta: {
		id: "fal",
		label: "Fal",
		capabilities: ["video"],
		config: [
			{ key: "FAL_KEY", label: "API key", kind: "secret", required: true },
			{
				key: "FAL_I2V_MODEL",
				label: "Image-to-video model",
				kind: "text",
				required: false,
				help: `Defaults to ${DEFAULT_MODEL}.`,
			},
		],
		get models() {
			return { video: resolveConfig("FAL_I2V_MODEL") || DEFAULT_MODEL };
		},
		async health(capability) {
			if (capability && capability !== "video") return "unconfigured";
			return resolveConfig("FAL_KEY") && videoBinariesAvailable() ? "ready" : "unconfigured";
		},
	},
	video: {
		async generate(input, ctx) {
			const key = resolveConfig("FAL_KEY");
			if (!key) throw new Error("Fal video generation requires FAL_KEY");
			const model = falProvider.meta.models?.video ?? DEFAULT_MODEL;
			if (!/^[a-z0-9/_-]+$/i.test(model)) throw new Error("Invalid Fal video model");
			const deadline = AbortSignal.timeout(180_000);
			const signal = ctx.signal ? AbortSignal.any([ctx.signal, deadline]) : deadline;
			let imageUrl = input.imageUrl;
			if (!imageUrl.startsWith("https://")) {
				if (!imageUrl.startsWith(`workspaces/${ctx.workspaceId}/image/`))
					throw new Error("Video source storage owner mismatch");
				const signed = addressMedia(imageUrl, "GET", 3600);
				if (!signed) throw new Error("External video generation requires reachable object storage");
				imageUrl = signed;
			}
			const response = await fetch(`https://fal.run/${model}`, {
				method: "POST",
				headers: { authorization: `Key ${key}`, "content-type": "application/json" },
				body: JSON.stringify({
					image_url: imageUrl,
					prompt: input.prompt,
					num_frames: Math.max(24, Math.round(input.durationSec * 24)),
				}),
				signal,
			});
			if (!response.ok) throw new Error(`fal ${response.status}`);
			const result = responseSchema.parse(await response.json());
			const url = new URL(result.video.url);
			// The generated file is vendor-owned; never fetch an arbitrary response URL or redirect.
			if (
				url.protocol !== "https:" ||
				url.username ||
				url.password ||
				url.port ||
				!(url.hostname === "fal.media" || url.hostname.endsWith(".fal.media"))
			)
				throw new Error("Fal returned an unsafe video URL");
			const download = await fetch(url, { signal, redirect: "error" });
			if (!download.ok || !download.body)
				throw new Error(`Fal video download failed (${download.status})`);
			const maxBytes = 50 * 1024 * 1024;
			const cache = mediaWorkerCacheDir();
			await mkdir(cache, { recursive: true });
			const path = join(cache, `fal-video-${randomUUID()}.mp4`);
			try {
				const file = await open(path, "wx");
				const reader = download.body.getReader();
				let size = 0;
				try {
					for (;;) {
						signal.throwIfAborted();
						const { done, value } = await reader.read();
						if (done) break;
						size += value.byteLength;
						if (size > maxBytes) throw new Error("Fal video exceeds media size limit");
						await file.writeFile(value);
					}
				} finally {
					try {
						await reader.cancel();
					} finally {
						await file.close();
					}
				}
				const metadata = await measureGeneratedVideo(path, signal);
				if (metadata.videoCodec !== "h264" || !metadata.container?.includes("mp4"))
					throw new Error("Fal returned a video that is not browser-playable MP4");
				return { path, durationSec: metadata.duration!, fromCache: false };
			} catch (error) {
				await rm(path, { force: true });
				throw error;
			}
		},
	},
};
