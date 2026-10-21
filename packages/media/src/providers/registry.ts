/* Provider registry — the single list every layer derives from. Add a provider
 * here and it becomes selectable everywhere (settings UI and generation function).
 * Ordering is display order in the picker. */
import type { Capability } from "./capabilities.ts";
import type { ContentProvider } from "./types.ts";
import { cloudflareAiProvider } from "./cloudflare-ai/index.ts";
import { codexProvider } from "./codex/index.ts";
import { huggingfaceProvider } from "./huggingface/index.ts";
import { kokoroProvider } from "./kokoro/index.ts";
import { pocketTtsIdProvider } from "./pocket-tts-id/index.ts";
import { sandboxProvider } from "./sandbox/index.ts";
import { falProvider } from "./fal/index.ts";

/* Order IS behavior: `providersFor` preserves it and an unconfigured default
 * takes the first candidate reporting `ready`. So the head of the list per
 * capability must be a provider that produces real output when configured.
 *
 * `cloudflare-ai` leads for image over `huggingface` because it resolves its
 * model from a table and refuses what that model cannot honour, while the HF
 * router is permissive by decision — it ignores reference inputs and keeps
 * whatever size comes back, so a 9:16 request can succeed as a square with no
 * error. A default should be the one that fails honestly.
 *
 * `sandbox` is last AND opt-in (MALEO_SANDBOX=1), because last still wins when
 * everything above it is unconfigured, which is exactly the state a fresh or
 * broken deployment is in. Position cannot express "never by accident"; the
 * health gate can.
 *
 * Append new providers rather than prepending: adding one must not change the
 * existing default for a capability.
 *
 * `pocket-tts-id` sits after `kokoro` for exactly that reason, and the ordering
 * matters more than usual here: it speaks Indonesian only, so leading for `tts`
 * would narrate English content through an Indonesian phonemizer — a failure
 * that arrives as audio rather than as an error. */
export const PROVIDERS: ContentProvider[] = [
	cloudflareAiProvider,
	huggingfaceProvider,
	codexProvider,
	kokoroProvider,
	pocketTtsIdProvider,
	falProvider,
	sandboxProvider,
];

export const providerById: ReadonlyMap<string, ContentProvider> = new Map(
	PROVIDERS.map((p) => [p.meta.id, p]),
);

export function getProvider(id: string): ContentProvider | undefined {
	return providerById.get(id);
}

// Providers that implement a capability (declared in meta + the impl present).
export function providersFor(capability: Capability): ContentProvider[] {
	return PROVIDERS.filter((p) => p.meta.capabilities.includes(capability) && p[capability] != null);
}
