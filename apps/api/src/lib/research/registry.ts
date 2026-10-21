/* Which provider a research pass retrieves through.
 *
 * The seam itself — `ResearchProvider { search, readPage }` — and everything
 * that makes a citation trustworthy live in `../web-research.ts`: URL
 * classification, dedupe, domain diversification, excerpt caps, and the
 * exact-quote validation. A provider is retrieval and nothing else. This module
 * only answers "which one".
 *
 * Resolution order, following `media-provider-selection`: an explicit selection,
 * then env configuration, then the first registered provider that is READY.
 * Registration order is therefore behavior, not presentation — the first entry
 * below is the default for anyone who has not chosen.
 *
 * A provider that is not configured is SKIPPED rather than selected and then
 * failed, because "selected and broken" and "not available" are different
 * things to report and only one of them is true.
 *
 * There is deliberately NO fallthrough between providers. If the selected one
 * cannot answer, research is unavailable and the plan is marked ungrounded —
 * which `story-plan-staging` already requires and the approval gate already
 * reports. A silent second attempt would replace a visible outage with an
 * invisible change in grounding quality, and nothing downstream can see that.
 */
import { connectBrowseros } from "../browseros-mcp.ts";
import { makeBrowserosProvider, type ResearchProvider } from "../web-research.ts";
import { makeSearxngProvider, searxngConfigFromEnv } from "./searxng.ts";
import type { ProviderConfigField } from "@maleo/shared";

export type ResearchProviderId = "searxng" | "browseros";

/** A live provider plus whatever it needs releasing afterwards. */
export interface ResearchProviderHandle {
	id: ResearchProviderId;
	provider: ResearchProvider;
	close: () => Promise<void>;
}

interface Registration {
	id: ResearchProviderId;
	/** Human label for the settings surface. */
	label: string;
	/** Configured well enough to serve production traffic. */
	ready: () => boolean;
	/* What this provider needs configured, as data the settings form is built
	 * from — the same declaration every media and text provider carries. */
	config?: readonly ProviderConfigField[];
	open: () => Promise<ResearchProviderHandle>;
}

/* Registration order IS the default order.
 *
 * `searxng` leads because it needs no daemon on the machine doing the planning:
 * BrowserOS listens on 127.0.0.1, so with it as the default every operator
 * without that process running got a plan honestly marked ungrounded, which is
 * correct behavior and a useless feature. BrowserOS stays registered as the
 * option that needs no configuration at all. */
const REGISTRY: Registration[] = [
	{
		id: "searxng",
		label: "SearXNG + Crawl4AI",
		config: [
			{
				key: "MALEO_SEARXNG_URL",
				label: "SearXNG URL",
				kind: "url",
				required: true,
				help: "The metasearch instance searches run through. Built from infra/searxng.",
			},
			{
				key: "MALEO_CRAWL4AI_URL",
				label: "Crawl4AI URL",
				kind: "url",
				required: true,
				help: "The service that extracts page text. Built from infra/crawl4ai.",
			},
			{
				key: "CF_ACCESS_CLIENT_ID",
				label: "Cloudflare Access client ID",
				kind: "text",
				required: true,
				help: "Both services sit behind Cloudflare Access. Without these, a request returns an Access login page rather than data — which is why a URL alone is not partial configuration but no configuration.",
			},
			{
				key: "CF_ACCESS_CLIENT_SECRET",
				label: "Cloudflare Access client secret",
				kind: "secret",
				required: true,
			},
			{
				key: "CRAWL4AI_API_TOKEN",
				label: "Crawl4AI API token",
				kind: "secret",
				required: false,
			},
		],
		ready: () => searxngConfigFromEnv() !== null,
		open: async () => {
			const config = searxngConfigFromEnv();
			if (!config) throw new Error("searxng research provider is not configured");
			return { id: "searxng", provider: makeSearxngProvider(config), close: async () => {} };
		},
	},
	{
		id: "browseros",
		label: "BrowserOS (local MCP)",
		config: [
			{
				key: "BROWSEROS_MCP_URL",
				label: "MCP endpoint",
				kind: "url",
				required: false,
				help: "Local BrowserOS Streamable HTTP MCP endpoint; defaults to http://127.0.0.1:9000/mcp. Point this at a profile with NO logged-in sessions or cookies — a fetched page can otherwise read your authenticated state. Only search, owned-tab open/close and page read are used; never click, fill, scripts, uploads, downloads, history, bookmarks or mail.",
			},
		],
		// No credential to check: it is a local daemon, and whether it is actually
		// listening is only knowable by connecting. Readiness here means "allowed
		// to try".
		ready: () => true,
		open: async () => {
			const client = await connectBrowseros();
			return {
				id: "browseros",
				provider: makeBrowserosProvider(client),
				close: () => client.close().catch(() => {}),
			};
		},
	},
];

export function researchProviderIds(): ResearchProviderId[] {
	return REGISTRY.map((entry) => entry.id);
}

function isProviderId(value: string): value is ResearchProviderId {
	return REGISTRY.some((entry) => entry.id === value);
}

/* The registry as the settings surface reads it: what exists, what it needs
 * configured, and whether it is ready. Derived from the same registrations
 * resolution uses, so a provider cannot be offered here and be missing there. */
export function listResearchProviders(): {
	id: ResearchProviderId;
	label: string;
	config: readonly ProviderConfigField[];
	ready: boolean;
}[] {
	return REGISTRY.map((r) => ({
		id: r.id,
		label: r.label,
		config: r.config ?? [],
		ready: r.ready(),
	}));
}

/** The selection an operator or the environment asked for, when it names a
 *  provider this build actually has. An unknown name is ignored rather than
 *  fatal: a typo in configuration should not take research down, and the
 *  registry default is a working answer. */
export function selectedResearchProviderId(explicit?: string): ResearchProviderId | undefined {
	const wanted = (explicit ?? process.env.MALEO_RESEARCH_PROVIDER ?? "").trim().toLowerCase();
	return wanted && isProviderId(wanted) ? wanted : undefined;
}

/** Resolve to a concrete provider: explicit selection, then the first ready
 *  registration. An explicitly selected provider is used even when it is not
 *  ready, so a deliberate choice fails loudly instead of being silently
 *  substituted — that is the same rule as no-fallthrough, one step earlier. */
export function resolveResearchProvider(explicit?: string): Registration {
	const wanted = selectedResearchProviderId(explicit);
	if (wanted) {
		const chosen = REGISTRY.find((entry) => entry.id === wanted);
		if (chosen) return chosen;
	}
	const ready = REGISTRY.find((entry) => entry.ready());
	if (ready) return ready;
	throw new Error("no research provider is configured");
}

/** Open the resolved provider. The caller owns `close()`. */
export async function openResearchProvider(explicit?: string): Promise<ResearchProviderHandle> {
	return await resolveResearchProvider(explicit).open();
}
