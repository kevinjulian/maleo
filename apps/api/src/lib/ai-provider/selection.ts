/* Provider selection — user-selectable, with precedence.
 *
 *   persisted selection  →  env default  →  first registered
 *
 * Semantics are ported from `packages/media/src/providers/selection.ts` rather
 * than reinvented, so "how does a provider get chosen" is one mental model
 * across the repo. The load-bearing rule: an explicit choice that is stale or
 * unhealthy THROWS. Only an unconfigured default may fall through to the first
 * ready provider.
 *
 * Silent substitution is the worst failure mode here: generating on another
 * provider than the one selected produces plausible output from the wrong AI
 * with no signal that it happened. A selection naming a removed provider fails
 * the same way, by name. Internal providers (the scripted test provider) are
 * never a default. */
import { refreshConfig } from "@maleo/shared/provider-config";
import type { Capability } from "./capabilities.ts";
import type { AiProvider, ThinkingLevel } from "./types.ts";
import { getProvider, providersFor, REMOVED_PROVIDERS } from "./registry.ts";
import { resolveTextModel } from "./providers/api/discovery.ts";

/* Persisted as one row under `ai.text.provider`. Shaped as a map from day one:
 * the requirement is scalar (one AI for everything) but per-task routing is the
 * obvious next step, and `{ default: … }` is exactly a per-task map with one
 * entry. Flattening it would force a settings migration later. */
export interface ProviderChoice {
	providerId: string;
	model?: string;
	thinking?: ThinkingLevel;
}

export interface ProviderSelection {
	default?: ProviderChoice;
}

export interface ProviderDecision {
	provider: AiProvider;
	choice: ProviderChoice;
	source: "selection" | "env" | "default";
	health: "ready";
}

// Env fallback per capability, e.g. MALEO_PROVIDER_TEXT=claude.
function envDefault(capability: Capability): string | undefined {
	const v = process.env[`MALEO_PROVIDER_${capability.toUpperCase()}`];
	return v?.trim() || undefined;
}

function explicitChoice(
	capability: Capability,
	selection: ProviderSelection,
): { choice: ProviderChoice; source: "selection" | "env" } | null {
	if (selection.default?.providerId) {
		return { choice: selection.default, source: "selection" };
	}
	const fromEnv = envDefault(capability);
	if (fromEnv) return { choice: { providerId: fromEnv }, source: "env" };
	return null;
}

/** The refusal for a selection naming a provider that is not registered. */
function unknownProvider(source: string, providerId: string, capability: Capability): Error {
	const removed = REMOVED_PROVIDERS.get(providerId);
	if (removed) {
		return new Error(
			`selected ${source} provider "${providerId}" was removed: ${removed} can no longer generate ${capability}. Select an API provider in Settings; use the CLI through the MCP server instead.`,
		);
	}
	return new Error(
		`selected ${source} provider "${providerId}" does not implement capability "${capability}"`,
	);
}

function implementsCapability(provider: AiProvider, capability: Capability): boolean {
	return provider.meta.capabilities.includes(capability) && provider[capability] != null;
}

/* Reject a model or thinking level the provider never declared, rather than
 * running at a different one. A downgrade the user cannot see is the same class
 * of bug as substituting the provider itself. */
export function assertChoiceSupported(provider: AiProvider, choice: ProviderChoice): void {
	if (choice.model && !provider.meta.models.includes(choice.model)) {
		throw new Error(
			`provider "${provider.meta.id}" does not offer model "${choice.model}" (has: ${provider.meta.models.join(", ")})`,
		);
	}
	if (choice.thinking && !provider.meta.thinkingLevels.includes(choice.thinking)) {
		throw new Error(
			`provider "${provider.meta.id}" does not offer thinking level "${choice.thinking}" (has: ${provider.meta.thinkingLevels.join(", ")})`,
		);
	}
}

// Resolve the provider for a capability. Throws when nothing implements it, so
// a misconfigured capability fails loudly rather than silently no-op'ing.
export function resolveProvider(
	capability: Capability,
	selection: ProviderSelection = {},
): AiProvider {
	const candidates = providersFor(capability);
	if (candidates.length === 0) {
		throw new Error(`no provider implements capability "${capability}"`);
	}
	const explicit = explicitChoice(capability, selection);
	if (explicit) {
		const picked = getProvider(explicit.choice.providerId);
		if (!picked || !implementsCapability(picked, capability))
			throw unknownProvider(explicit.source, explicit.choice.providerId, capability);
		assertChoiceSupported(picked, explicit.choice);
		return picked;
	}
	return candidates[0]!;
}

// Health-aware selection for live execution. Explicit choices fail loudly when
// stale or unhealthy; only an unconfigured default may choose the first ready
// implementation. This prevents invisible provider substitution.
export async function selectReadyProvider(
	capability: Capability,
	selection: ProviderSelection = {},
): Promise<ProviderDecision> {
	// Selection is an async boundary: reload stored configuration here.
	await refreshConfig();
	const explicit = explicitChoice(capability, selection);
	if (explicit) {
		const provider = getProvider(explicit.choice.providerId);
		if (!provider || !implementsCapability(provider, capability))
			throw unknownProvider(explicit.source, explicit.choice.providerId, capability);
		const health = await provider.meta.health(capability);
		if (health !== "ready") {
			const reason = await provider.meta.healthReason?.(capability);
			throw new Error(
				`selected ${explicit.source} provider "${explicit.choice.providerId}" is ${health}${reason ? ` (${reason})` : ""}; choose a ready provider`,
			);
		}
		const choice =
			provider.meta.id === "api"
				? { ...explicit.choice, model: await resolveTextModel(explicit.choice.model) }
				: explicit.choice;
		assertChoiceSupported(provider, choice);
		return { provider, choice, source: explicit.source, health };
	}
	const candidates = providersFor(capability).filter((provider) => !provider.meta.internal);
	for (const provider of candidates) {
		if ((await provider.meta.health(capability)) === "ready") {
			return {
				provider,
				choice: {
					providerId: provider.meta.id,
					...(provider.meta.id === "api" ? { model: await resolveTextModel() } : {}),
				},
				source: "default",
				health: "ready",
			};
		}
	}
	throw new Error(`no ready provider implements capability "${capability}"`);
}
