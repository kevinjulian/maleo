/* Provider selection — user-selectable, with precedence.
 *
 *   project override  →  workspace default  →  env default  →  first registered
 *
 * The selection is a plain id lookup so the caller (settings API, generation
 * function) can persist choices in the DB and pass them in; this module only
 * resolves an id to a concrete provider that actually implements the capability. */
import { refreshConfig } from "@maleo/shared/provider-config";
import type { Capability } from "./capabilities.ts";
import type { ContentProvider } from "./types.ts";
import { getProvider, providersFor } from "./registry.ts";

export interface ProviderSelection {
	// Persisted per (capability): project override wins over workspace default.
	project?: Partial<Record<Capability, string>>;
	workspace?: Partial<Record<Capability, string>>;
}

export interface ProviderDecision {
	provider: ContentProvider;
	source: "project" | "workspace" | "env" | "default";
	health: "ready";
}

// Env fallback per capability, e.g. MALEO_PROVIDER_IMAGE=browseros.
function envDefault(capability: Capability): string | undefined {
	const v = process.env[`MALEO_PROVIDER_${capability.toUpperCase()}`];
	return v?.trim() || undefined;
}

type ExplicitSource = "project" | "workspace" | "env";

/** The highest-precedence explicit choice, with where it came from. */
function explicitChoice(
	capability: Capability,
	selection: ProviderSelection,
): { id: string; source: ExplicitSource } | null {
	const project = selection.project?.[capability];
	if (project) return { id: project, source: "project" };
	const workspace = selection.workspace?.[capability];
	if (workspace) return { id: workspace, source: "workspace" };
	const env = envDefault(capability);
	return env ? { id: env, source: "env" } : null;
}

/* An id naming no registered provider means one of two different things, and
 * they deserve different answers.
 *
 * Persisted in a project or workspace row, it is STALE CONFIGURATION: it was
 * valid when an operator chose it, and a provider was retired underneath it. The
 * config did not change, the code did — so failing every generation forever
 * punishes the user for our refactor. It falls through to the registry default,
 * and the settings surface reports the provider that actually ran.
 *
 * In an env var, it is a TYPO someone made seconds ago, and silently ignoring it
 * would run the whole deployment on a provider nobody selected. That still
 * throws.
 *
 * A provider that IS registered but cannot serve the capability, or is
 * unhealthy, throws from every source — that is the invisible-substitution case,
 * and it is unchanged. */
function isRetiredPersistedId(
	source: ExplicitSource,
	provider: ContentProvider | undefined,
): boolean {
	return provider === undefined && source !== "env";
}

function implementsCapability(provider: ContentProvider, capability: Capability): boolean {
	return provider.meta.capabilities.includes(capability) && provider[capability] != null;
}

// Resolve the provider for a capability. Throws when nothing implements it, so a
// misconfigured capability fails loudly rather than silently no-op'ing.
export function resolveProvider(
	capability: Capability,
	selection: ProviderSelection = {},
): ContentProvider {
	const candidates = providersFor(capability);
	if (candidates.length === 0) {
		throw new Error(`no provider implements capability "${capability}"`);
	}
	const want = explicitChoice(capability, selection);
	if (want) {
		const picked = getProvider(want.id);
		if (picked && implementsCapability(picked, capability)) return picked;
		if (!isRetiredPersistedId(want.source, picked)) {
			throw new Error(
				`selected ${want.source} provider "${want.id}" does not implement capability "${capability}"`,
			);
		}
	}
	const fallback = candidates.find((provider) => !provider.meta.explicitOnly?.includes(capability));
	if (!fallback) throw new Error(`no default provider implements capability "${capability}"`);
	return fallback;
}

// Health-aware selection for live execution. Explicit user/operator choices fail
// loudly when stale or unhealthy; only an unconfigured default may choose the
// first ready implementation. This prevents invisible provider substitution.
export async function selectReadyProvider(
	capability: Capability,
	selection: ProviderSelection = {},
): Promise<ProviderDecision> {
	// Selection is an async boundary: reload stored configuration here.
	await refreshConfig();
	const explicit = explicitChoice(capability, selection);
	if (explicit) {
		const provider = getProvider(explicit.id);
		// A retired id persisted in a project/workspace row falls through to the
		// default rather than breaking the capability permanently; everything else
		// about an explicit choice still fails loudly. See isRetiredPersistedId.
		if (isRetiredPersistedId(explicit.source, provider)) return firstReady(capability);
		if (!provider || !implementsCapability(provider, capability)) {
			throw new Error(
				`selected ${explicit.source} provider "${explicit.id}" does not implement capability "${capability}"`,
			);
		}
		const health = await provider.meta.health(capability);
		if (health !== "ready")
			throw new Error(
				`selected ${explicit.source} provider "${explicit.id}" is ${health}; choose a ready provider`,
			);
		return { provider, source: explicit.source, health };
	}
	return firstReady(capability);
}

/* The unconfigured default: the first REGISTERED provider reporting ready.
 * Order is the policy (see registry.ts) and the mock is opt-in, so this cannot
 * land on fabricated output unless somebody set MALEO_SANDBOX=1. */
async function firstReady(capability: Capability): Promise<ProviderDecision> {
	const candidates = providersFor(capability);
	for (const provider of candidates) {
		if (provider.meta.explicitOnly?.includes(capability)) continue;
		if ((await provider.meta.health(capability)) === "ready")
			return { provider, source: "default", health: "ready" };
	}
	throw new Error(`no ready provider implements capability "${capability}"`);
}
