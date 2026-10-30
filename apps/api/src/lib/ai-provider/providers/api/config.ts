import { resolveConfig } from "@maleo/shared/provider-config";

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const API_BASE_URL_ENV = "MALEO_AI_API_BASE_URL";
export const API_KEY_ENV = "MALEO_AI_API_KEY";
/* Operator-declared model IDs, comma-separated. These remain usable without
 * discovery; models outside the price table use the metered fallback. */
export const API_MODELS_ENV = "MALEO_AI_API_MODELS";

export interface ApiConfig {
	baseUrl: string;
	apiKey: string;
}

/* Read at call time rather than module load. The previous runner read its two
 * knobs once at import, which meant changing them required a restart — and a
 * settings UI that appears to work but does not take effect is worse than one
 * that is absent. */
export function apiConfig(): ApiConfig {
	return {
		baseUrl: (resolveConfig(API_BASE_URL_ENV) ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
		apiKey: resolveConfig(API_KEY_ENV) ?? "",
	};
}
