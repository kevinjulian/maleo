/* AI provider layer — swappable, user-selected text-generation providers.
 * Interfaces + registry + selection. Callers resolve a provider for a
 * capability and call the interface; adding or swapping a provider never
 * touches a call site. Extends the media provider seam (ADR 0002) to text. */
export { CAPABILITIES, type Capability } from "./capabilities.ts";
export * from "./types.ts";
export { PROVIDERS, getProvider, providersFor } from "./registry.ts";
export {
	resolveProvider,
	selectReadyProvider,
	assertChoiceSupported,
	type ProviderChoice,
	type ProviderDecision,
	type ProviderSelection,
} from "./selection.ts";
export { estimateTokens } from "./usage.ts";
export { apiConfig, checkReachable, type ApiConfig } from "./providers/api/index.ts";
export {
	fakeProvider,
	setFakeScript,
	fakeCalls,
	resetFake,
	type ScriptedReply,
} from "./providers/fake/index.ts";

export { resolveConfig, withConfigOverride } from "@maleo/shared/provider-config";
