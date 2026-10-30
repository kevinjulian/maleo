import {
	PREVIEW_AUDIO_WORKER_URL,
	PREVIEW_AUDIO_WORKLET_URL,
	PREVIEW_MEDIA_WORKER_URL,
	PREVIEW_VIDEO_WORKER_URL,
} from "@services/preview-media/script-urls.ts";
/** Lightweight media worker, available independently of renderer WASM. */
export function previewMediaRoutes() {
	return Object.fromEntries(
		Object.entries({
			[PREVIEW_MEDIA_WORKER_URL]: "worker.ts",
			[PREVIEW_VIDEO_WORKER_URL]: "video-worker.ts",
			[PREVIEW_AUDIO_WORKER_URL]: "audio-worker.ts",
			[PREVIEW_AUDIO_WORKLET_URL]: "audio-worklet.ts",
		}).map(([path, entry]) => {
			let bundle: Promise<Response> | undefined;
			return [
				path,
				async () => {
					bundle ??= Bun.build({
						entrypoints: [new URL(`../services/preview-media/${entry}`, import.meta.url).pathname],
						target: "browser",
						minify: true,
					})
						.then((build) => {
							if (!build.success || !build.outputs[0])
								throw new AggregateError(build.logs, "Preview media worker build failed");
							return new Response(build.outputs[0], {
								headers: { "content-type": "text/javascript; charset=utf-8" },
							});
						})
						.catch((error: unknown) => {
							bundle = undefined;
							throw error;
						});
					return (await bundle).clone();
				},
			];
		}),
	);
}
