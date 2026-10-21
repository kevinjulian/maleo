/* Media worker — the durable, provider-based generation host (ADR 0001 phase 5 +
 * ADR 0002). Hosts the generation-run Inngest function + a thin producer/poll API
 * and holds the BrowserOS provider sessions. A producer POSTs /generate or /tts →
 * a job row + a generation/requested event; the function resolves the selected
 * provider, runs it, writes the result; the producer polls /jobs/:id.
 *
 * Deployed as apps/media-worker (a thin shell that calls startMediaWorker). This
 * is the permanent home for durable generation; it depends on the media providers,
 * never on the legacy packages/image. */
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import type { BlankEnv } from "hono/types";
import { serve as inngestServe } from "inngest/hono";
import { z } from "zod";
import { imagePromptIntentSchema } from "@maleo/shared";
import { generationRequestedEvent, inngest } from "@maleo/inngest";
import { mediaFunctions } from "./generation/function.ts";
import { registerWorkerRuntime } from "./generation/impl.ts";
import { createJob, getJob, listProviderMetrics } from "./generation/store.ts";
import { refreshConfig, setConfigSource } from "./providers/config.ts";
import { createHttpConfigSource } from "./providers/http-config-source.ts";
import { assertMediaStorageConfigured, verifyMediaStorageReady } from "@maleo/storage";
import { processingRoutes } from "./processing/routes.ts";
import { speechRoutes } from "./processing/speech-routes.ts";
import { processingReadiness } from "./processing/readiness.ts";
import { requireMediaService } from "./worker-auth.ts";
import { providersFor } from "./providers/index.ts";
import { bodyLimit } from "hono/body-limit";

// Provider selection carried on every producer request so the run is
// project/workspace-aware (selection.ts precedence applies downstream).
const SelectionSchema = {
	workspace_id: z.string().optional(),
	project_id: z.string().optional(),
	provider_id: z.string().optional(),
	provider_source: z.enum(["project", "workspace", "env", "default"]).optional(),
};
const GenerateSchema = z
	.object({
		prompt: z.string().min(3).max(20000).optional(),
		aspect: z.string().optional(),
		reference_urls: z.array(z.string()).max(4).optional(),
		intent: imagePromptIntentSchema.optional(),
		...SelectionSchema,
	})
	.refine((value) => Boolean(value.prompt?.trim() || value.intent), {
		message: "prompt or intent is required",
		path: ["prompt"],
	});
const TtsSchema = z.object({
	text: z.string().min(1).max(20000),
	voice: z.string().max(120).optional(),
	language: z.string().max(40).optional(),
	/* Resolved by the API from the voice id; the worker only forwards it. It is
	 * still validated as a managed file at the provider, because a URL reaching
	 * this process decides which bytes on disk a provider may read. */
	voice_ref_url: z.string().max(2000).optional(),
	...SelectionSchema,
});

interface Selection {
	workspace_id?: string;
	project_id?: string;
	provider_id?: string;
	provider_source?: "project" | "workspace" | "env" | "default";
	idempotency_key?: string;
}

async function enqueue(
	kind: "image" | "tts" | "video",
	prompt: string,
	styleJson: string | undefined,
	sel: Selection,
): Promise<string> {
	const job = createJob(kind, prompt, styleJson, {
		providerId: sel.provider_id,
		providerSource: sel.provider_source,
		idempotencyKey: sel.idempotency_key
			? JSON.stringify([sel.workspace_id, sel.project_id, sel.idempotency_key])
			: undefined,
	});
	if (job.status === "done") return job.id;
	await inngest.send(
		generationRequestedEvent.create({
			jobId: job.id,
			kind,
			prompt,
			styleJson,
			idempotencyKey: job.id,
			workspaceId: sel.workspace_id ?? "default",
			projectId: sel.project_id,
			providerId: sel.provider_id,
			providerSource: sel.provider_source,
		}),
	);
	return job.id;
}

export function buildMediaApp(): Hono {
	registerWorkerRuntime();
	const app = new Hono();
	app.route("/processing", processingRoutes());
	app.route("/speech", speechRoutes());

	app.get("/health", async (c) => {
		const providers = providersFor("video");
		let video;
		try {
			await refreshConfig();
			video = Object.fromEntries(
				await Promise.all(
					providers.map(async (provider) => [
						provider.meta.id,
						await provider.meta.health("video"),
					]),
				),
			);
		} catch {
			video = Object.fromEntries(providers.map((provider) => [provider.meta.id, "down"]));
		}
		return c.json({
			ok: true,
			ts: new Date().toISOString(),
			processing: await processingReadiness(),
			video,
		});
	});
	app.get("/metrics/providers", (c) => c.json({ providers: listProviderMetrics() }));

	// Inngest sync endpoint — the Inngest server invokes generation-run here.
	const handler = inngestServe({ client: inngest, functions: mediaFunctions });
	app.on(["GET", "POST", "PUT"], "/api/inngest", (c) => handler(c));

	app.post("/generate", async (c) => {
		const parsed = GenerateSchema.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid", details: parsed.error.flatten() }, 400);
		const style: Record<string, unknown> = {};
		if (parsed.data.aspect) style.aspect = parsed.data.aspect;
		if (parsed.data.reference_urls?.length) style.reference_urls = parsed.data.reference_urls;
		if (parsed.data.intent) style.intent = parsed.data.intent;
		const styleJson = Object.keys(style).length ? JSON.stringify(style) : undefined;
		const prompt =
			parsed.data.prompt?.trim() || parsed.data.intent?.scene.visualMoment || "image generation";
		const id = await enqueue("image", prompt, styleJson, parsed.data);
		return c.json({ job_id: id, status: "queued" }, 202);
	});

	app.post("/tts", async (c) => {
		const parsed = TtsSchema.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid", details: parsed.error.flatten() }, 400);
		const style = {
			voice: parsed.data.voice,
			language: parsed.data.language,
			voice_ref_url: parsed.data.voice_ref_url,
		};
		const styleJson =
			style.voice || style.language || style.voice_ref_url ? JSON.stringify(style) : undefined;
		const id = await enqueue("tts", parsed.data.text, styleJson, parsed.data);
		return c.json({ job_id: id, status: "queued" }, 202);
	});

	app.post("/video", requireMediaService, bodyLimit({ maxSize: 32768 }), async (c) => {
		const schema = z.object({
			image_url: z.string().min(1).max(2000),
			prompt: z.string().max(20000),
			duration_sec: z.number().finite().positive().max(60),
			aspect: z
				.string()
				.regex(/^[1-9]\d{0,3}:[1-9]\d{0,3}$/)
				.optional(),
			...SelectionSchema,
			workspace_id: z.string().min(1),
			idempotency_key: z.string().min(1).max(500).optional(),
		});
		const parsed = schema.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ error: "invalid_video_request" }, 400);
		const input = parsed.data;
		if (!input.image_url.startsWith(`workspaces/${input.workspace_id}/image/`))
			return c.json({ error: "video_source_owner_mismatch" }, 400);
		const style = JSON.stringify({
			image_url: input.image_url,
			duration_sec: input.duration_sec,
			aspect: input.aspect,
		});
		try {
			const id = await enqueue("video", input.prompt, style, input);
			return c.json({ job_id: id, status: getJob(id)?.status }, 202);
		} catch (error) {
			return c.json(
				{ error: error instanceof Error ? error.message : "Video submission failed" },
				409,
			);
		}
	});
	app.use("/jobs/:id", (c: Context<BlankEnv, "/jobs/:id">, next) =>
		getJob(c.req.param("id"))?.kind === "video" ? requireMediaService(c, next) : next(),
	);

	// Drop-in shape for the legacy image service (dashboard needs only a base-URL switch).
	app.get("/jobs/:id", (c) => {
		const job = getJob(c.req.param("id"));
		if (!job) return c.json({ error: "not_found" }, 404);
		return c.json({
			id: job.id,
			kind: job.kind,
			status: job.status,
			image_url: null,
			audio_url: null,
			image_path: null,
			storage_key: job.storage_key,
			storage_hash: job.storage_hash,
			storage_size: job.storage_size,
			storage_content_type: job.storage_content_type,
			poster_storage_key: job.poster_storage_key,
			poster_storage_hash: job.poster_storage_hash,
			poster_storage_size: job.poster_storage_size,
			poster_storage_content_type: job.poster_storage_content_type,

			from_cache: Boolean(job.from_cache),
			provider_id: job.provider_id,
			provider_source: job.provider_source,
			model: job.model,
			cost: job.cost,
			latency_ms: job.latency_ms,
			...(job.duration_sec != null ? { duration_sec: job.duration_sec } : {}),
			error: job.error,
			created_at: job.created_at,
			started_at: job.started_at,
			finished_at: job.finished_at,
		});
	});

	return app;
}

export const API_URL_ENV = "MALEO_API_URL";
export const SERVICE_TOKEN_ENV = "MALEO_SERVICE_TOKEN";

/* Point this process's provider configuration at the API, when it has been told
 * where the API is.
 *
 * With both set, a credential entered in Settings reaches the process that
 * actually generates. With either missing, configuration resolves from this
 * process's own environment exactly as it did before — so an existing worker
 * deployment is unchanged until it opts in, and there is no flag day. */
export function installWorkerConfigSource(): void {
	const baseUrl = process.env[API_URL_ENV]?.trim();
	const token = process.env[SERVICE_TOKEN_ENV]?.trim();
	if (!baseUrl || !token) {
		console.log(
			`[config] resolving provider configuration from this process's environment ` +
				`(set ${API_URL_ENV} and ${SERVICE_TOKEN_ENV} to read it from the API instead)`,
		);
		return;
	}
	setConfigSource(createHttpConfigSource({ baseUrl, token }));
	console.log(`[config] resolving provider configuration from ${baseUrl}`);
}

export async function startMediaWorker(): Promise<void> {
	assertMediaStorageConfigured();
	await verifyMediaStorageReady();
	installWorkerConfigSource();
	const PORT = Number(process.env.MALEO_MEDIA_WORKER_PORT ?? process.env.PORT ?? 7071);
	console.log(`maleo-media-worker listening on http://localhost:${PORT}`);
	serve({ fetch: buildMediaApp().fetch, port: PORT });
}
