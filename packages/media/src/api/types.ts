/* Public DTOs for the media client — the shapes the dashboard talks in. Kept
 * transport-agnostic so a caller never sees HTTP/base-url details. */

// Provider selection carried on a generation request so the run picks a provider
// per the user's project/workspace choice (registry default when omitted).
export interface ProviderSelectionInput {
	workspaceId?: string;
	projectId?: string;
	providerId?: string;
	providerSource?: "project" | "workspace" | "env" | "default";
}

export interface ImageRequest extends ProviderSelectionInput {
	prompt: string;
	aspect?: string;
	referenceUrls?: string[];
	intent?: unknown;
}

export interface TtsRequest extends ProviderSelectionInput {
	text: string;
	voice?: string;
	language?: string;
	/* Reference audio for a cloned voice, already resolved from `voice` by the
	 * caller. The worker carries it to the provider; no surface above sends it. */
	voiceRefUrl?: string;
}

export interface VideoRequest extends ProviderSelectionInput {
	imageUrl: string;
	prompt: string;
	durationSec: number;
	aspect?: string;
	idempotencyKey?: string;
}

export type MediaJobState = "queued" | "processing" | "done" | "failed";

export interface MediaJob {
	id: string;
	kind: "image" | "tts" | "video";
	status: MediaJobState;
	/** /files/<name> path on the worker; null until done. */
	imageUrl: string | null;
	audioUrl: string | null;
	durationSec?: number;
	stored?: { key: string; hash: string; size: number; contentType: string } | null;
	poster?: { key: string; hash: string; size: number; contentType: string } | null;
	fromCache: boolean;
	providerId: string | null;
	providerSource: string | null;
	model: string | null;
	cost: number | null;
	latencyMs: number | null;
	error: string | null;
}
