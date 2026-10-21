/* GenerationRuntime seam — injected by the worker host so the durable function
 * can resolve a provider, run it, and persist the result without this module
 * importing the store directly. Lives in @maleo/media (the domain owner) rather
 * than @maleo/inngest (shared infra). */
export interface GenerationRuntime {
	generate(input: {
		jobId: string;
		kind: "image" | "tts" | "video";
		prompt: string;
		styleJson?: string;
		idempotencyKey: string;
		// Provider selection context (project/workspace-aware).
		workspaceId: string;
		projectId?: string;
		providerId?: string;
		providerSource?: "project" | "workspace" | "env" | "default";
	}): Promise<{
		url?: string;
		path?: string;
		fromCache?: boolean;
		providerId?: string;
		providerSource?: string;
		model?: string;
		cost?: number;
		latencyMs?: number;
		durationSec?: number;
	}>;
	persist(input: {
		jobId: string;
		workspaceId: string;
		result: {
			url?: string;
			path?: string;
			fromCache?: boolean;
			providerId?: string;
			providerSource?: string;
			model?: string;
			cost?: number;
			latencyMs?: number;
			durationSec?: number;
		};
	}): Promise<void>;
	// Called once after Inngest exhausts retries — mark the job failed.
	fail?(input: { jobId: string; error: string }): Promise<void>;
}

let genRuntime: GenerationRuntime | null = null;

export function registerGenerationRuntime(impl: GenerationRuntime): void {
	genRuntime = impl;
}

export function getGenerationRuntime(): GenerationRuntime {
	if (!genRuntime) {
		throw new Error(
			"GenerationRuntime not registered — call registerGenerationRuntime(...) at the media worker before serving /api/inngest",
		);
	}
	return genRuntime;
}
