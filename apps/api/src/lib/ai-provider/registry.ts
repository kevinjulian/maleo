/* Provider registry — the single list every layer derives from. Add a provider
 * here and it becomes selectable everywhere (settings UI, text runner) with no
 * other edit. Order is display order in the picker and the order an unconfigured
 * default tries.
 *
 * API-backed models only (adopt-mastra-internal-agent decision 4): a CLI runner
 * runs its own tool loop and cannot take part in the agent's tool calls, so the
 * Codex CLI and Claude CLI providers were removed. Those CLIs drive projects as
 * MCP clients instead (mcp/). */
import type { Capability } from "./capabilities.ts";
import type { AiProvider } from "./types.ts";
import { apiProvider } from "./providers/api/index.ts";
import { fakeProvider } from "./providers/fake/index.ts";

export const PROVIDERS: AiProvider[] = [apiProvider, fakeProvider];

/** Providers a stored selection may still name after they were removed, and why. */
export const REMOVED_PROVIDERS: ReadonlyMap<string, string> = new Map([
	["codex", "the Codex CLI"],
	["claude", "the Claude CLI"],
]);

export const providerById: ReadonlyMap<string, AiProvider> = new Map(
	PROVIDERS.map((p) => [p.meta.id, p]),
);

export function getProvider(id: string): AiProvider | undefined {
	return providerById.get(id);
}

// Providers that implement a capability (declared in meta + the impl present).
export function providersFor(capability: Capability): AiProvider[] {
	return PROVIDERS.filter((p) => p.meta.capabilities.includes(capability) && p[capability] != null);
}
