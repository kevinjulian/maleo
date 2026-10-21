/* GenerationRuntime — the concrete work the Inngest generation-run function calls.
 * Resolves the selected provider per capability (../providers) and runs it,
 * then records the result in the store. Provider = what generates; Inngest = the
 * durable orchestration (retry / idempotency / concurrency). */
import { registerGenerationRuntime } from "./runtime.ts";
import { selectReadyProvider, type ProviderCtx } from "../providers/index.ts";
import { markStarted, markProviderSelected, markDone, markFailed } from "./store.ts";
import { imagePromptIntentSchema, type ImagePromptIntent } from "@maleo/shared";
import { compileImagePrompt } from "./image-prompt.ts";
import type { ImageGenInput, ImageReferenceSupport } from "../providers/types.ts";
import { z } from "zod";
import { putMedia } from "@maleo/storage";
import { basename, extname, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { materializeManagedReferences } from "./references.ts";
import { measureGeneratedVideo, prepareGeneratedVideo } from "../providers/video-output.ts";

interface StyleBundle {
	aspect?: string;
	voice?: string;
	language?: string;
	voice_ref_url?: string;
	reference_urls?: string[];
	intent?: ImagePromptIntent;
	image_url?: string;
	duration_sec?: number;
}

const styleBundleSchema = z
	.object({
		aspect: z.string().optional(),
		voice: z.string().optional(),
		language: z.string().optional(),
		voice_ref_url: z.string().optional(),
		reference_urls: z.array(z.string()).optional(),
		intent: z.unknown().optional(),
		image_url: z.string().optional(),
		duration_sec: z.number().positive().finite().optional(),
	})
	.passthrough();

function parseStyle(styleJson?: string): StyleBundle {
	if (!styleJson) return {};
	const parsed = styleBundleSchema.parse(JSON.parse(styleJson));
	return {
		...parsed,
		intent: parsed.intent === undefined ? undefined : imagePromptIntentSchema.parse(parsed.intent),
	};
}

export function buildProviderImageInput(
	prompt: string,
	styleJson: string | undefined,
	support: ImageReferenceSupport,
): ImageGenInput {
	const style = parseStyle(styleJson);
	const compiled = style.intent
		? compileImagePrompt(style.intent, support)
		: { prompt, referenceUrls: style.reference_urls };
	return {
		prompt: compiled.prompt,
		aspect: style.aspect ?? style.intent?.output.aspect,
		referenceUrls: compiled.referenceUrls,
	};
}

export function registerWorkerRuntime(): void {
	registerGenerationRuntime({
		async generate({
			jobId,
			kind,
			prompt,
			styleJson,
			idempotencyKey,
			workspaceId,
			projectId,
			providerId,
			providerSource,
		}) {
			markStarted(jobId);
			const startedAt = Date.now();
			const references = await materializeManagedReferences(styleJson, workspaceId);
			try {
				const style = parseStyle(references.styleJson);
				const ctx: ProviderCtx = { workspaceId, projectId, idempotencyKey };
				// A job-level providerId is a project override for this capability; the
				// registry default applies when absent (selection precedence in selection.ts).
				const selection = providerId ? { project: { [kind]: providerId } } : {};

				if (kind === "video") {
					if (!style.image_url || !style.duration_sec)
						throw new Error("Video job requires image and duration");
					const { provider, source: selectedSource } = await selectReadyProvider(
						"video",
						selection,
					);
					const source = providerSource ?? selectedSource;
					markProviderSelected(jobId, provider.meta.id, source);
					if (!provider.video) throw new Error(`provider ${provider.meta.id} has no video impl`);
					const result = await provider.video.generate(
						{
							imageUrl: style.image_url,
							prompt,
							durationSec: style.duration_sec,
							aspect: style.aspect,
						},
						ctx,
					);
					return {
						...result,
						providerId: provider.meta.id,
						providerSource: source,
						model: provider.meta.models?.video,
						cost: provider.meta.id === "sandbox" ? 0 : undefined,
						latencyMs: Date.now() - startedAt,
					};
				}

				if (kind === "tts") {
					const { provider, source: selectedSource } = await selectReadyProvider("tts", selection);
					const source = providerSource ?? selectedSource;
					markProviderSelected(jobId, provider.meta.id, source);
					if (!provider.tts) throw new Error(`provider ${provider.meta.id} has no tts impl`);
					const r = await provider.tts.synthesize(
						{
							text: prompt,
							voice: style.voice,
							language: style.language,
							voiceRefUrl: style.voice_ref_url,
						},
						ctx,
					);
					return {
						path: r.path,
						fromCache: r.fromCache,
						providerId: provider.meta.id,
						providerSource: source,
						model: provider.meta.models?.tts,
						cost: provider.meta.id === "sandbox" ? 0 : undefined,
						latencyMs: Date.now() - startedAt,
					};
				}

				const { provider, source: selectedSource } = await selectReadyProvider("image", selection);
				const source = providerSource ?? selectedSource;
				markProviderSelected(jobId, provider.meta.id, source);
				if (!provider.image) throw new Error(`provider ${provider.meta.id} has no image impl`);
				const r = await provider.image.generate(
					buildProviderImageInput(
						prompt,
						references.styleJson,
						provider.meta.image?.references ?? { mode: "none" },
					),
					ctx,
				);
				return {
					url: r.url,
					fromCache: r.fromCache,
					providerId: provider.meta.id,
					providerSource: source,
					model: provider.meta.models?.image,
					cost: provider.meta.id === "sandbox" ? 0 : undefined,
					latencyMs: Date.now() - startedAt,
				};
			} finally {
				await references.cleanup();
			}
		},

		async persist({ jobId, workspaceId, result }) {
			const path = result.path ?? result.url;
			if (!path) throw new Error(`generation ${jobId} returned no file`);
			const file = Bun.file(path);
			if (!(await file.exists())) throw new Error(`generation ${jobId} output is missing`);
			const ext = extname(path).toLowerCase();
			const audio = [".mp3", ".wav", ".ogg", ".webm", ".flac", ".m4a"].includes(ext);
			const video = ext === ".mp4";
			let directory: string | undefined;
			try {
				let output: Awaited<ReturnType<typeof prepareGeneratedVideo>> = {
					video: path,
					poster: null,
				};
				let durationSec = result.durationSec;
				if (video) {
					const metadata = await measureGeneratedVideo(path, AbortSignal.timeout(10_000));
					if (result.durationSec !== metadata.duration)
						throw new Error("Video duration metadata mismatch");
					directory = await mkdtemp(join(tmpdir(), "generated-video-"));
					const signal = AbortSignal.timeout(120_000);
					output = await prepareGeneratedVideo(path, directory, signal);
					durationSec = (await measureGeneratedVideo(output.video, signal)).duration;
				}
				const contentType = video
					? "video/mp4"
					: ext === ".mp3"
						? "audio/mpeg"
						: ext === ".m4a"
							? "audio/mp4"
							: file.type || (audio ? "audio/wav" : "image/png");
				const stored = await putMedia({
					workspace: workspaceId,
					kind: video ? "video" : audio ? "audio" : "image",
					body: video ? Bun.file(output.video) : file,
					contentType,
					filename: basename(path),
				});
				const poster = output.poster
					? await putMedia({
							workspace: workspaceId,
							kind: "image",
							body: Bun.file(output.poster),
							contentType: "image/jpeg",
							filename: "poster.jpg",
						})
					: undefined;
				markDone(jobId, path, Boolean(result.fromCache), {
					providerId: result.providerId,
					providerSource: result.providerSource,
					latencyMs: result.latencyMs,
					cost: result.cost,
					model: result.model,
					durationSec,
					stored,
					poster,
				});
			} finally {
				if (directory) await rm(directory, { recursive: true, force: true });
			}
		},

		async fail({ jobId, error }) {
			markFailed(jobId, error);
		},
	});
}
