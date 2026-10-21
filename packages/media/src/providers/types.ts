/* Provider contracts — the seam that makes content generation swappable.
 *
 * A ContentProvider bundles per-capability implementations behind a stable
 * interface + descriptive metadata. Callers depend on the interface, never on a
 * concrete provider, so swapping BrowserOS for an API provider (or adding Fal)
 * is a registry entry, not a rewrite. Mirrors the AgentRuntime/ContentProvider
 * seam in ADR 0001, generalized per capability and made user-selectable. */
import type { ProviderConfigField } from "@maleo/shared";
import type { Capability } from "./capabilities.ts";

// Health of a provider's external dependency (BrowserOS session, API key, …).
export type ProviderHealth = "ready" | "unconfigured" | "down";

// Trusted, server-injected context — never sourced from model/tool arguments.
export interface ProviderCtx {
	workspaceId: string;
	projectId?: string;
	// Idempotency key for expensive generation; providers/queues dedupe on it.
	idempotencyKey?: string;
	signal?: AbortSignal;
}

export interface ImageGenInput {
	prompt: string;
	aspect?: string;
	referenceUrls?: string[];
}
export interface ImageResult {
	url: string;
	fromCache?: boolean;
}
export interface ImageProvider {
	generate(input: ImageGenInput, ctx: ProviderCtx): Promise<ImageResult>;
}

export interface VideoGenInput {
	imageUrl: string;
	prompt: string;
	durationSec: number;
	aspect?: string;
}
export interface VideoResult {
	path: string;
	durationSec: number;
	fromCache?: boolean;
}
export interface VideoProvider {
	generate(input: VideoGenInput, ctx: ProviderCtx): Promise<VideoResult>;
}

/* A voice a TTS provider can speak, as every surface receives it.
 *
 * Lives here rather than with a provider because two providers declare voices
 * and `apps/api` builds its catalogue from whichever ones are registered —
 * a shape owned by one provider is a shape the next one has to import. */
export interface TtsVoice {
	// Speaker id passed to the synthesis endpoint (e.g. "M1", "af_heart").
	id: string;
	// Human label for UI.
	name: string;
	// Short descriptor of the timbre / delivery.
	desc: string;
	// Perceived gender, used for grouping in UI.
	gender: "male" | "female";
	// BCP-47-ish language tag the voice is tuned for (e.g. "en", "en-GB", "ja").
	lang: string;
}

export interface TtsInput {
	text: string;
	voice?: string;
	/* BCP-47-ish language hint. A language-locked provider may derive this from
	 * voice metadata instead. */
	language?: string;
	/* Reference audio for a provider that clones a voice rather than selecting
	 * one from a catalogue.
	 *
	 * FILLED BY THE CALLER THAT RESOLVED `voice`, never carried alongside it from
	 * a surface. `voice` stays the single voice identity everywhere above this
	 * boundary — it is what cache keys, staleness hashes, stored selections and
	 * ledger rows all record — and this is the one place the audio behind a
	 * cloned voice enters. Two fields travelling together through every layer is
	 * two fields that can disagree. */
	voiceRefUrl?: string;
}
export interface TtsResult {
	path: string;
	fromCache?: boolean;
}
export interface TtsProvider {
	synthesize(input: TtsInput, ctx: ProviderCtx): Promise<TtsResult>;
}

export type ImageReferenceSupport =
	| { mode: "native"; maxImages: number }
	| { mode: "text-only" }
	| { mode: "none" };

export interface ImageProviderMeta {
	references: ImageReferenceSupport;
}

/* Capability-specific metadata for `tts`, the twin of `ImageProviderMeta`.
 *
 * A provider's voices belong to the provider that can speak them. Held anywhere
 * else, they are a second list that drifts from the implementation — which is
 * the failure `voice-catalogue-source` exists to prevent. */
export interface TtsProviderMeta {
	voices: readonly TtsVoice[];
	/* Where this provider's voices come from.
	 *
	 * `declared` — the speakers are listed above, in the repository, and the
	 * provider can speak them with nothing else supplied. Kokoro's fifty-four.
	 *
	 * `cloned` — the provider has no speakers of its own; it imitates an audio
	 * prompt, so every voice it can speak is a clone in a workspace's library and
	 * `voices` is legitimately empty. Declaring an entry here would name a voice
	 * the provider cannot actually speak.
	 *
	 * Optional, and absence means `declared`, so a provider written before this
	 * distinction existed keeps the stricter conformance check unchanged. */
	voiceSource?: "declared" | "cloned";
	/* The language a `cloned` provider speaks, BCP-47-ish.
	 *
	 * A declaring provider states language per voice, because its speakers can
	 * differ. A cloning provider has no voices to hang it on and is locked to one
	 * language by its weights, so it belongs here — and a clone created for it
	 * takes this rather than a caller-supplied tag, which could only contradict
	 * what the model will actually speak. */
	language?: string;
}

/* The answer to "does this actually work", as distinct from "is it configured".
 *
 * `reason` carries the provider's own words when it does not, because "failed" on
 * its own sends an operator to the logs for something the probe already knows. */
export interface ProviderReachability {
	ok: boolean;
	reason?: string;
}

export interface ProviderMeta {
	id: string;
	label: string;
	capabilities: Capability[];
	// Offered in settings, but never chosen by automatic fallback for these capabilities.
	explicitOnly?: readonly Capability[];
	/* What this provider needs configured, as data the settings form is built
	 * from. Optional: a provider configured by other means renders no form, which
	 * is how every provider behaved before declarations existed. */
	config?: readonly ProviderConfigField[];
	models?: Partial<Record<Capability, string>>;
	image?: ImageProviderMeta;
	tts?: TtsProviderMeta;
	// A provider is only selectable for a capability when this reports "ready".
	//
	// CHEAP AND OFFLINE. Called on every settings render, so a network round-trip
	// here makes the page as slow as the slowest endpoint. It answers "is this
	// configured", which is why it cannot answer "does this work".
	health(capability?: Capability): Promise<ProviderHealth>;

	/* An actual connection attempt, for an explicit "test this" action.
	 *
	 * Separate from `health` because they answer different questions and only one
	 * of them may touch the network. Test-before-save was built on `health` alone
	 * at first, so a Kokoro URL pointing at nothing reported "Connection
	 * succeeded" — it had checked that a URL was SET.
	 *
	 * Optional: a provider that cannot be probed without doing real work (and
	 * spending real money) declares none, and the surface says so rather than
	 * claiming a success it did not observe. */
	reachable?(capability?: Capability): Promise<ProviderReachability>;
}

export interface ContentProvider {
	meta: ProviderMeta;
	image?: ImageProvider;
	tts?: TtsProvider;
	video?: VideoProvider;
}
