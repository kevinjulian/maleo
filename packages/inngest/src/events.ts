/* Event schemas — the typed contract between producers (the dashboard routes)
 * and the durable functions. Zod schemas give both compile-time types and a
 * runtime validation surface. Keep event names namespaced (`domain/action`)
 * and payloads small: pass ids and pointers, never large artifacts (step return
 * and event payloads have size limits — the storyboard already persists to the
 * DB after every step). */
import { z } from "zod";
import { eventType } from "inngest";

// A single generation unit (image / TTS) — the future replacement for the
// SQLite queue. Kept here so the queue migration reuses the same contract.
export const generationRequested = z.object({
	jobId: z.string(),
	kind: z.enum(["image", "tts", "video"]),
	prompt: z.string(),
	styleJson: z.string().optional(),
	// Idempotency: dedupe retries so a re-run never bills/generates twice.
	idempotencyKey: z.string(),
	// Provider selection context (project/workspace-aware). workspaceId scopes the
	// ProviderCtx; projectId + providerId let the run pick a provider per the user's
	// saved selection instead of always the registry default.
	workspaceId: z.string(),
	projectId: z.string().optional(),
	providerId: z.string().optional(),
	providerSource: z.enum(["project", "workspace", "env", "default"]).optional(),
});

/* Each event is a typed trigger and producer. A function triggers on it
 * (`triggers: [agentRunRequestedEvent]`) and a producer sends
 * `inngest.send(agentRunRequestedEvent.create(data))`, so both sides share one
 * schema. Inngest rejects schemas whose input and output types differ, so these
 * carry no `.default()`: every producer sends every required field. */
export const generationRequestedEvent = eventType("generation/requested", {
	schema: generationRequested,
});

export type GenerationRequested = z.infer<typeof generationRequested>;

export const mediaProcessingRequested = z
	.object({
		jobId: z.string().min(1),
		workspaceId: z.string().min(1),
		projectId: z.string().min(1),
		idempotencyKey: z.string().min(1),
	})
	.strict();
export const mediaProcessingRequestedEvent = eventType("media/processing.requested", {
	schema: mediaProcessingRequested,
});
export type MediaProcessingRequested = z.infer<typeof mediaProcessingRequested>;
