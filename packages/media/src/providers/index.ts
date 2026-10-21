/* Providers layer — swappable, user-selectable content-generation providers.
 * Interfaces + registry + selection. Callers resolve a provider per capability
 * and call the interface; adding/swapping providers never touches call sites. */
export { CAPABILITIES, type Capability } from "./capabilities.ts";
export * from "./types.ts";
export { videoSourceAspect } from "./video-output.ts";
export { PROVIDERS, getProvider, providersFor } from "./registry.ts";
export {
	resolveProvider,
	selectReadyProvider,
	type ProviderDecision,
	type ProviderSelection,
} from "./selection.ts";

/* The configuration seam. A host installs a source; providers read through it.
 * Exported because installing one is the host's job, not this package's — the
 * API installs a database-backed source, the worker an HTTP-backed one, and a
 * host that installs nothing keeps reading the process environment. */
export {
	environmentConfigSource,
	getConfigSource,
	refreshConfig,
	resolveConfig,
	setConfigSource,
	type ConfigResolver,
	type ConfigSource,
} from "./config.ts";

/* No provider's voice catalogue is exported. `apps/api` builds its TTS
 * routes and voice lists from `meta.tts.voices` on registered providers. */
export {
	OpenAiSpeechClient,
	type SpeechClientOptions,
	type SpeechRequest,
} from "./openai-speech/client.ts";
