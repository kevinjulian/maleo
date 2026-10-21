/* Durable generation run — a `generation/requested` event drives one generation
 * (image or tts) with retry + backoff + idempotency + concurrency, replacing the
 * legacy SQLite poll-worker. The concrete work is delegated to the injected
 * GenerationRuntime (resolve provider → run → persist). Concurrency is capped per
 * kind. Default is 1 because browser-session providers (BrowserOS) hold one
 * canvas at a time; set MALEO_GENERATION_CONCURRENCY_PER_KIND to raise it.
 *
 * Uses the shared Inngest client from @maleo/inngest (which owns the event
 * schemas); the function + seam live here in the media domain. */
import { fieldOf } from "@maleo/shared";
import { generationRequestedEvent, inngest } from "@maleo/inngest";
import { getGenerationRuntime } from "./runtime.ts";
import { refreshConfig } from "../providers/config.ts";
import { mediaProcessingRun } from "../processing/function.ts";

export function generationConcurrencyPerKind(): number {
	const raw = Number(process.env.MALEO_GENERATION_CONCURRENCY_PER_KIND ?? "1");
	return Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 1;
}

export const generationRun = inngest.createFunction(
	{
		id: "generation-run",
		concurrency: { key: "event.data.kind", limit: generationConcurrencyPerKind() },
		idempotency: "event.data.idempotencyKey",
		retries: 3,
		onFailure: async ({ event, error }) => {
			const runtime = getGenerationRuntime();
			if (!runtime.fail) return;
			// Inngest wraps the original event under `inngest/function.failed`:
			// event.data.event is the trigger. Access defensively so a shape drift
			// never throws inside the failure handler itself.
			const jobId = fieldOf(fieldOf(fieldOf(event.data, "event"), "data"), "jobId");
			if (typeof jobId === "string" && jobId) await runtime.fail({ jobId, error: error.message });
		},
		triggers: [generationRequestedEvent],
	},
	async ({ event, step }) => {
		const runtime = getGenerationRuntime();
		const {
			jobId,
			kind,
			prompt,
			styleJson,
			idempotencyKey,
			workspaceId,
			projectId,
			providerId,
			providerSource,
		} = event.data;

		/* Load configuration before resolving a provider, not per read.
		 *
		 * This is the async boundary the synchronous resolver seam is refreshed at.
		 * A failure here is deliberately NOT swallowed: running on an empty snapshot
		 * would make every provider look unconfigured, and the registry's last
		 * provider fabricates output and wins exactly when everything above it is
		 * unconfigured. Failing the job names the configuration service; failing
		 * open would produce fake media nothing downstream could tell from real.
		 *
		 * Cached with a TTL, so this costs one request per TTL, not per job. */
		await step.run("load-config", async () => {
			await refreshConfig();
			return { ok: true };
		});

		const result = await step.run("generate", () =>
			runtime.generate({
				jobId,
				kind,
				prompt,
				styleJson,
				idempotencyKey,
				workspaceId,
				projectId,
				providerId,
				providerSource,
			}),
		);
		await step.run("persist", () => runtime.persist({ jobId, workspaceId, result }));
		return { jobId, kind, status: "done" };
	},
);

// The function array the media worker serves at /api/inngest.
export const mediaFunctions = [generationRun, mediaProcessingRun];
