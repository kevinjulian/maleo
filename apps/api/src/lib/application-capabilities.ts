/* Provider-backed application capabilities as Settings reads them.
 *
 * A capability is the operator's unit of thought — "can this app make images
 * yet" — where the registries are provider-keyed. Everything here derives from
 * the provider catalog and the existing selection stores; nothing is a second
 * list. A provider added to any registry appears under its capability with no
 * edit here.
 *
 * DELIBERATELY APP-LEVEL, and separate from the workspace capabilities in
 * `capabilities/modules.ts` (Threads and Telegram). Those are scoped to a
 * workspace and read `secrets.yaml`; these are scoped to the application and read
 * `global_settings`, whose primary key is `key` alone. Presenting them in one
 * list would claim a scope the schema cannot honour. */
import {
	getGlobalImageProvider,
	getGlobalSetting,
	getGlobalTtsProvider,
	setGlobalImageProvider,
	setGlobalSetting,
	setGlobalTtsProvider,
} from "@maleo/db/global-settings";
import { getProvider as getMediaProvider } from "@maleo/media/providers";
import {
	getProvider as getTextProvider,
	THINKING_LEVELS,
	type ThinkingLevel,
} from "./ai-provider/index.ts";
import { getProvider as getStockProvider, type StockCapability } from "@maleo/stock";
import { listResearchProviders } from "./research/registry.ts";
import { getLocalWhisperStatus } from "./local-whisper.ts";
import { readTextProviderSelection, writeTextProviderSelection } from "./text-provider-settings.ts";
import {
	listCatalogProviders,
	type CatalogProvider,
	type ProviderCapability,
} from "./provider-catalog.ts";
import { getMediaClient } from "./image-gen-client.ts";
import { VIDEO_PROVIDER_SETTING } from "./generation/video-generator.ts";

/** Where the research provider choice lives, the twin of the image and tts rows. */
export const RESEARCH_PROVIDER_SETTING = "research.provider";

export const APP_CAPABILITIES = [
	"text",
	"image",
	"tts",
	"research",
	"video",
	"captions",
	"stock-visuals",
	"sound-effects",
] as const satisfies readonly ProviderCapability[];

const LABELS = {
	text: "Text",
	image: "Image",
	tts: "Speech",
	research: "Research",
	video: "Video",
	captions: "Captions",
	"stock-visuals": "Stock visuals",
	"sound-effects": "Sound effects",
} satisfies Record<ProviderCapability, string>;

const DESCRIPTIONS = {
	text: "Which model writes scripts, blueprints and chat replies.",
	image: "Which provider generates still images.",
	tts: "Which provider speaks narration.",
	research: "Where cited sources for factual scripts come from.",
	video: "Which provider generates video clips.",
	captions: "How narration is aligned into on-screen captions.",
	"stock-visuals": "Where licensed stock images and video come from.",
	"sound-effects": "Where licensed sound effects come from.",
} satisfies Record<ProviderCapability, string>;

export type ProviderState = "ready" | "unconfigured" | "down";

export interface CapabilityProviderView {
	id: string;
	label: string;
	state: ProviderState;
	active: boolean;
}

export type CapabilityState = "ready" | "not_configured";

export interface ApplicationCapabilityView {
	id: ProviderCapability;
	label: string;
	description: string;
	state: CapabilityState;
	activeProviderId: string | null;
	providers: CapabilityProviderView[];
}

/** The provider currently serving a capability, or null when none is chosen. */
export async function activeProviderFor(capability: ProviderCapability): Promise<string | null> {
	switch (capability) {
		case "video":
			return (await getGlobalSetting(VIDEO_PROVIDER_SETTING)) ?? null;
		case "image":
			return (await getGlobalImageProvider()) ?? null;
		case "tts":
			return (await getGlobalTtsProvider()) ?? null;
		case "text":
			return (await readTextProviderSelection()).default?.providerId ?? null;
		case "research":
			return (await getGlobalSetting(RESEARCH_PROVIDER_SETTING)) ?? null;
		case "stock-visuals":
			return "pexels";
		case "sound-effects":
			return "freesound";
		case "captions":
			// Captions have no selectable providers yet.
			return null;
	}
}

/**
 * Persist the provider serving a capability.
 *
 * Writes through the STORE EACH CAPABILITY ALREADY USES rather than a new
 * unified row. One endpoint is the goal; migrating three working stores is not,
 * and a second location for the same fact is how the two drift.
 */
export interface SelectionDetail {
	/* Text only. A model and a thinking level are meaningful only relative to a
	 * provider, which is why they travel with the selection rather than beside
	 * it — see `text-provider-settings.ts`. */
	model?: string | null;
	thinking?: string | null;
}

export async function setActiveProviderFor(
	capability: ProviderCapability,
	providerId: string | null,
	detail: SelectionDetail = {},
): Promise<void> {
	switch (capability) {
		case "video":
			await setGlobalSetting(VIDEO_PROVIDER_SETTING, providerId);
			return;
		case "image":
			await setGlobalImageProvider(providerId);
			return;
		case "tts":
			await setGlobalTtsProvider(providerId);
			return;
		case "text": {
			if (!providerId) {
				await writeTextProviderSelection(null);
				return;
			}
			const current = (await readTextProviderSelection()).default;
			/* Changing provider clears the model and thinking level, which belong to
			 * the previous provider's catalogue. Re-selecting the SAME provider keeps
			 * them — without this, choosing a provider in Settings silently discarded
			 * the model an operator had picked in the editor, and nothing said so. */
			const keep = current?.providerId === providerId;
			await writeTextProviderSelection({
				providerId,
				...(detail.model !== undefined
					? detail.model === null
						? {}
						: { model: detail.model }
					: keep && current?.model
						? { model: current.model }
						: {}),
				...(detail.thinking !== undefined
					? detail.thinking === null
						? {}
						: { thinking: asThinkingLevel(detail.thinking) }
					: keep && current?.thinking
						? { thinking: current.thinking }
						: {}),
			});
			return;
		}
		case "research":
			await setGlobalSetting(RESEARCH_PROVIDER_SETTING, providerId);
			return;
		case "stock-visuals":
		case "sound-effects":
			// Each stock job has one fixed source. Configuration controls readiness;
			// persisting a redundant choice would create a second fact to drift.
			return;
		case "captions":
			throw new Error(`capability "${capability}" has no selectable providers`);
	}
}

/* The stored thinking level is a ThinkingLevel; the wire carries a string. An
 * unrecognised value is dropped rather than stored, so a typo cannot persist a
 * level no provider declares. */
function asThinkingLevel(value: string): ThinkingLevel | undefined {
	return THINKING_LEVELS.find((level) => level === value);
}

/** Health for one provider under one capability, across all registries. */
export async function providerState(
	provider: CatalogProvider,
	capability: ProviderCapability,
): Promise<ProviderState> {
	try {
		if (provider.registry === "media") {
			if (capability === "video") {
				const media = getMediaClient();
				return media
					? ((await media.videoReadiness())[bareId(provider)] ?? "unconfigured")
					: "unconfigured";
			}
			const impl = getMediaProvider(bareId(provider));
			if (!impl) return "unconfigured";
			/* The media registry's capability union is narrower than this catalog's.
			 * Asking it about a capability it does not model would be a lie dressed
			 * as a question, so an unmapped one is simply not served here. */
			if (!isMediaCapability(capability)) return "unconfigured";
			return await impl.meta.health(capability);
		}
		if (provider.registry === "text") {
			const impl = getTextProvider(bareId(provider));
			if (!impl) return "unconfigured";
			return await impl.meta.health();
		}
		if (provider.registry === "local") {
			// whisper.cpp, its model file and ffmpeg all have to be present; the
			// status endpoint already knows how to answer that.
			const status = await getLocalWhisperStatus();
			return status.ready ? "ready" : "unconfigured";
		}
		if (provider.registry === "stock") {
			const impl = getStockProvider(bareId(provider));
			if (!impl || !isStockCapability(capability)) return "unconfigured";
			return await impl.health();
		}
		const entry = listResearchProviders().find((r) => r.id === bareId(provider));
		return entry?.ready ? "ready" : "unconfigured";
	} catch {
		// A health check that throws is a provider that cannot serve. Reporting
		// `down` keeps the surface honest without taking the whole listing with it.
		return "down";
	}
}

const MEDIA_CAPABILITIES = new Set<string>(["image", "tts", "video"]);

function isMediaCapability(value: ProviderCapability): value is "image" | "tts" | "video" {
	return MEDIA_CAPABILITIES.has(value);
}

const STOCK_CAPABILITIES = new Set<string>(["stock-visuals", "sound-effects"]);

function isStockCapability(value: ProviderCapability): value is StockCapability {
	return STOCK_CAPABILITIES.has(value);
}

/** Whether a provider is actually reachable — an explicit probe, never a render. */
export interface ProviderProbe {
	ok: boolean;
	/* False when the provider offers no probe. The surface must not report a
	 * success it did not observe. */
	probed: boolean;
	reason?: string;
}

/**
 * Attempt a real connection, where the provider can make one.
 *
 * NOT `health()`: that is called on every settings render and is deliberately
 * offline, so it answers "is this configured" and cannot answer "does this work".
 * Test-before-save ran on `health` alone at first, and a Kokoro URL pointing at
 * nothing reported "Connection succeeded".
 */
export async function probeProvider(
	provider: CatalogProvider,
	capability: ProviderCapability,
): Promise<ProviderProbe> {
	if (provider.registry === "media" && isMediaCapability(capability)) {
		const impl = getMediaProvider(bareId(provider));
		if (impl?.meta.reachable) {
			try {
				const result = await impl.meta.reachable(capability);
				return { ok: result.ok, probed: true, ...(result.reason ? { reason: result.reason } : {}) };
			} catch (error) {
				return {
					ok: false,
					probed: true,
					reason: error instanceof Error ? error.message : String(error),
				};
			}
		}
	}
	if (provider.registry === "stock" && isStockCapability(capability)) {
		const impl = getStockProvider(bareId(provider));
		if (impl) {
			try {
				const result = await impl.reachable();
				return { ok: result.ok, probed: true, ...(result.reason ? { reason: result.reason } : {}) };
			} catch (error) {
				return {
					ok: false,
					probed: true,
					reason: error instanceof Error ? error.message : String(error),
				};
			}
		}
	}

	/* No probe available. Fall back to configuration state and SAY so, rather
	 * than presenting "configured" as "connected". */
	const state = await providerState(provider, capability);
	return { ok: state === "ready", probed: false };
}

/* Catalog ids are namespaced when two registries share one (`codex` is both a
 * media provider and a text provider). The registries themselves only know the
 * bare id, so this is what gets STORED — a persisted `text:codex` resolves to no
 * provider at generation time, and the settings surface would still render it as
 * selected because it compares against both forms. */
export function bareProviderId(provider: CatalogProvider): string {
	return bareId(provider);
}

function bareId(provider: CatalogProvider): string {
	const prefix = `${provider.registry}:`;
	return provider.id.startsWith(prefix) ? provider.id.slice(prefix.length) : provider.id;
}

export function providersForCapability(capability: ProviderCapability): CatalogProvider[] {
	return listCatalogProviders().filter(
		(provider) => !provider.internal && provider.capabilities.includes(capability),
	);
}

/**
 * Every provider-backed application capability, with providers and readiness.
 *
 * A capability with no providers at all — `video` today — is LISTED, not
 * omitted. Omitting it would make the surface's completeness depend on state, so
 * an operator could not tell "this app cannot do video" from "video is
 * configured somewhere I am not looking".
 */
export async function listApplicationCapabilities(): Promise<ApplicationCapabilityView[]> {
	return await Promise.all(
		APP_CAPABILITIES.map(async (capability) => {
			const active = await activeProviderFor(capability);
			const providers = await Promise.all(
				providersForCapability(capability).map(async (provider) => ({
					id: provider.id,
					label: provider.label,
					state: await providerState(provider, capability),
					active: provider.id === active || bareId(provider) === active,
				})),
			);

			/* Ready when something can actually serve — the active provider if one
			 * is chosen, otherwise any ready candidate, because selection falls
			 * through to the first ready provider when nothing is stored. */
			const chosen = providers.find((p) => p.active);
			const automatic = new Set(
				providersForCapability(capability)
					.filter((provider) => !provider.explicitOnly?.includes(capability))
					.map((provider) => provider.id),
			);
			const serving = chosen ?? providers.find((p) => p.state === "ready" && automatic.has(p.id));

			return {
				id: capability,
				label: LABELS[capability],
				description: DESCRIPTIONS[capability],
				state: serving?.state === "ready" ? ("ready" as const) : ("not_configured" as const),
				activeProviderId: chosen?.id ?? null,
				providers,
			};
		}),
	);
}
