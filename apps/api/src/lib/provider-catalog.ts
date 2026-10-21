/* One list of providers, unioned from the registries that own them.
 *
 * Provider-owning registries each keep their local shape. This is the one place
 * that knows all of them, and user-facing code reads providers from here rather
 * than from a registry directly.
 *
 * The union is derived, never a fourth list. A provider added to any registry
 * appears here with no edit, which is the property that makes the settings
 * surface generic rather than a fourth place to remember to update. */
import { PROVIDERS as AI_PROVIDERS } from "./ai-provider/index.ts";
import { PROVIDERS as MEDIA_PROVIDERS } from "@maleo/media/providers";
import { PROVIDERS as STOCK_PROVIDERS } from "@maleo/stock";
import type { ProviderConfigField } from "@maleo/shared";
import { listResearchProviders } from "./research/registry.ts";

/* The capabilities the settings surface groups providers under. Wider than any
 * single registry's own capability union, because it spans all registries. */
export type ProviderCapability =
	| "text"
	| "image"
	| "tts"
	| "research"
	| "video"
	| "captions"
	| "stock-visuals"
	| "sound-effects";

/* Local caption alignment, as a provider.
 *
 * It has no registry of its own — it is whisper.cpp plus ffmpeg on this machine —
 * but it IS a capability an operator sets up, and leaving it out would make the
 * settings surface's completeness depend on which registries happen to exist.
 * It declares no configuration fields: its setup is an install, not a form, which
 * the provider page renders as an action instead. */
export const LOCAL_CAPTIONS_PROVIDER_ID = "local-whisper";

export interface CatalogProvider {
	id: string;
	label: string;
	capabilities: readonly ProviderCapability[];
	config: readonly ProviderConfigField[];
	/** Which registry owns it — the settings routes need this to act on it. */
	registry: "media" | "text" | "research" | "stock" | "local";
	/* A provider whose setup is an action rather than a form. The page renders
	 * that action; there is no field to fill in. */
	action?: "install-captions";
	/* Deliberately not offered to an operator. The `fake` text provider reports
	 * ready because it always works, which would make it the most attractive
	 * option in a picker and return empty generations forever to whoever chose
	 * it. */
	internal?: boolean;
	explicitOnly?: readonly ProviderCapability[];
}

const PROVIDER_CAPABILITIES = new Set<string>([
	"text",
	"image",
	"tts",
	"research",
	"video",
	"captions",
	"stock-visuals",
	"sound-effects",
]);

function isProviderCapability(value: string): value is ProviderCapability {
	return PROVIDER_CAPABILITIES.has(value);
}

function mediaProviders(): CatalogProvider[] {
	return MEDIA_PROVIDERS.map((provider) => ({
		id: provider.meta.id,
		label: provider.meta.label,
		/* SAFETY: the media registry's Capability union ("image" | "tts" |
		 * "research") is a strict subset of ProviderCapability, which additionally
		 * carries "text", "video" and "captions" from the other two registries.
		 * Filtering rather than asserting keeps that true if the media union ever
		 * grows a member this catalog does not model. */
		capabilities: provider.meta.capabilities.filter(isProviderCapability),
		config: provider.meta.config ?? [],
		registry: "media" as const,
		explicitOnly: provider.meta.explicitOnly,
	}));
}

function textProviders(): CatalogProvider[] {
	return AI_PROVIDERS.map((provider) => ({
		id: provider.meta.id,
		label: provider.meta.label,
		capabilities: ["text" as const],
		config: provider.meta.config ?? [],
		registry: "text" as const,
		...(provider.meta.internal ? { internal: true } : {}),
	}));
}

function researchProviders(): CatalogProvider[] {
	return listResearchProviders().map((provider) => ({
		id: provider.id,
		label: provider.label,
		capabilities: ["research" as const],
		config: provider.config,
		registry: "research" as const,
	}));
}

function stockProviders(): CatalogProvider[] {
	return STOCK_PROVIDERS.map((provider) => ({
		id: provider.id,
		label: provider.label,
		capabilities: provider.capabilities,
		config: provider.config,
		registry: "stock" as const,
	}));
}

function localProviders(): CatalogProvider[] {
	return [
		{
			id: LOCAL_CAPTIONS_PROVIDER_ID,
			label: "Local Whisper",
			capabilities: ["captions"],
			config: [],
			registry: "local",
			action: "install-captions",
		},
	];
}

/**
 * Every registered provider.
 *
 * Ids are namespaced by registry when they would otherwise collide — `codex`
 * exists in both the media and text registries as genuinely different providers,
 * and a single id would make one of them unaddressable.
 */
export function listCatalogProviders(): CatalogProvider[] {
	const all = [
		...mediaProviders(),
		...textProviders(),
		...researchProviders(),
		...stockProviders(),
		...localProviders(),
	];
	const counts = new Map<string, number>();
	for (const provider of all) counts.set(provider.id, (counts.get(provider.id) ?? 0) + 1);
	return all.map((provider) =>
		(counts.get(provider.id) ?? 0) > 1
			? { ...provider, id: `${provider.registry}:${provider.id}` }
			: provider,
	);
}

export function findCatalogProvider(id: string): CatalogProvider | undefined {
	return listCatalogProviders().find((provider) => provider.id === id);
}

/** Every configuration key any provider declares, with whether it is a secret. */
export function allDeclaredConfigKeys(): { key: string; secret: boolean }[] {
	const seen = new Map<string, boolean>();
	for (const provider of listCatalogProviders()) {
		for (const field of provider.config) {
			seen.set(field.key, field.kind === "secret" || (seen.get(field.key) ?? false));
		}
	}
	return [...seen].map(([key, secret]) => ({ key, secret }));
}
