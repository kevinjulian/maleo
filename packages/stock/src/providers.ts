import type { ProviderConfigField } from "@maleo/shared";
import { isPexelsConfigured, probePexels } from "./pexels.ts";
import { isFreesoundConfigured, probeFreesound } from "./freesound.ts";
import type { StockProviderReachability } from "./types.ts";

export type StockCapability = "stock-visuals" | "sound-effects";
export type StockProviderHealth = "ready" | "unconfigured";

export interface StockProvider {
	id: string;
	label: string;
	capabilities: readonly StockCapability[];
	config: readonly ProviderConfigField[];
	health(): Promise<StockProviderHealth>;
	reachable(): Promise<StockProviderReachability>;
}

export const PROVIDERS: readonly StockProvider[] = [
	{
		id: "pexels",
		label: "Pexels",
		capabilities: ["stock-visuals"],
		config: [
			{
				key: "PEXELS_API_KEY",
				label: "API key",
				kind: "secret",
				required: true,
				help: "Search requires Pexels attribution and asset terms: https://www.pexels.com/api/documentation/",
			},
		],
		async health() {
			return isPexelsConfigured() ? "ready" : "unconfigured";
		},
		reachable: probePexels,
	},
	{
		id: "freesound",
		label: "Freesound",
		capabilities: ["sound-effects"],
		config: [
			{
				key: "FREESOUND_API_KEY",
				label: "API key",
				kind: "secret",
				required: true,
				help: "Free API access does not grant commercial permission. Terms: https://freesound.org/help/tos_api/",
			},
			{
				key: "FREESOUND_COMMERCIAL_USE_APPROVED",
				label: "Commercial API permission",
				kind: "choice",
				required: true,
				options: [
					{ id: "no", label: "Not confirmed" },
					{ id: "yes", label: "Permission confirmed" },
				],
				help: "Choose confirmed only after Freesound grants required API permission; each sound license still applies.",
			},
			{
				key: "FREESOUND_LICENSE_FILTER",
				label: "Asset license filter",
				kind: "text",
				required: false,
				help: "Defaults to Creative Commons 0. Verify each result's license before use.",
			},
		],
		async health() {
			return isFreesoundConfigured() ? "ready" : "unconfigured";
		},
		reachable: probeFreesound,
	},
];

const providerById = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

export function getProvider(id: string): StockProvider | undefined {
	return providerById.get(id);
}
