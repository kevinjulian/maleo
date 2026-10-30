/* Provider contracts — the seam that makes text generation swappable.
 *
 * A TextProvider takes a prompt and returns text plus token usage. That is the
 * whole contract: every one of the sixteen call sites is single-shot text-in /
 * text-out, and the tool loop, retry policy, tracing and JSON parsing all live
 * app-side. So the seam needs no agent protocol, no session, no tool
 * negotiation — and deliberately has none.
 *
 * A provider does NOT retry, trace, record credits, or build prompts. Those
 * encode knowledge about the call site rather than about the runner; duplicated
 * per provider they drift. Mirrors the ContentProvider seam in ADR 0002. */
import type { Capability } from "./capabilities.ts";
import type { ProviderConfigField } from "@maleo/shared";

// Health of a provider's external dependency (an API key, an endpoint, …).
export type ProviderHealth = "ready" | "unconfigured" | "down";

/* Normalized reasoning effort. Providers disagree on the native lever —
 * OpenAI-compatible APIs take `reasoning_effort`, others a thinking token
 * budget. Configuration stores this scale; each adapter maps it.
 *
 * A provider declares only the levels it can honor. Requesting an undeclared
 * level is a selection error, never a silent downgrade — otherwise the UI
 * offers `max` to a runner with no such mode and the user gets `medium`
 * without being told. */
export { THINKING_LEVELS, type ThinkingLevel } from "@maleo/shared";
import type { ThinkingLevel } from "@maleo/shared";

export interface TextInput {
	prompt: string;
	// Which supported model to run. An adapter may require an explicit choice.
	model?: string;
	// Must be one of the provider's declared `thinkingLevels`.
	thinking?: ThinkingLevel;
	timeoutMs?: number;
	signal?: AbortSignal;
}

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	// True when the provider only estimates (it reported no usage),
	// so metering can tell a measured token count from a character-length guess.
	estimated?: boolean;
}

export interface TextResult {
	text: string;
	usage: TokenUsage;
	// The model that actually ran. Metering prices on this, not on what was
	// requested, so a provider substituting a default is still billed correctly.
	model: string;
	durationMs: number;
}

export interface TextProvider {
	generate(input: TextInput): Promise<TextResult>;
}

export interface ProviderTraits {
	// Whether the runner can constrain output to a schema. Recorded now and
	// unused: the contract is text-in / text-out until a later change adds a
	// typed call. Doing both at once means a failed generation could be the
	// provider or the new parser, with no way to tell which.
	jsonMode: boolean;
	// Maximum in-flight generations, held by the agent's model calls
	// (ai-provider/semaphore.ts) so a run cannot outrun the provider's limits.
	maxConcurrency: number;
	contextTokens: number;
	// True when generation is billed per token rather than by a flat-rate
	// subscription. Surfaced in settings so switching runners is not a silent
	// cost change.
	meteredPerToken: boolean;
}

export interface ProviderMeta {
	id: string;
	label: string;
	capabilities: Capability[];
	// Effective options. API providers refresh these from endpoint discovery and declarations.
	models: string[];
	thinkingLevels: ThinkingLevel[];
	/* What this provider needs configured, as data the settings form is built
	 * from. Optional: a provider that needs nothing configured renders no form. */
	config?: readonly ProviderConfigField[];
	traits: ProviderTraits;
	/* Registered and resolvable, but never offered to a user. The `fake`
	 * provider reports `ready` because it always works, which would make it the
	 * most attractive-looking option in a settings dropdown and would return
	 * empty generations forever to whoever picked it. Tests still select it
	 * explicitly; humans are not shown it. */
	internal?: boolean;
	// A provider is only selectable when this reports "ready". The reason is
	// carried separately so settings can say *why* a runner is unavailable.
	health(capability?: Capability): Promise<ProviderHealth>;
	healthReason?(capability?: Capability): Promise<string | undefined>;
}

export interface AiProvider {
	meta: ProviderMeta;
	text?: TextProvider;
}
