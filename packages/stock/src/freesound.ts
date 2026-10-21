/* Freesound — sound effects. Needs API key plus operator permission confirmation.
 *
 * Results are licence-filtered (default CC0, the safest class for production
 * reuse) via FREESOUND_LICENSE_FILTER; set it empty to disable the filter. */

import { captureDrops, captureRate } from "./cache.ts";
import { fieldOf, textOf } from "@maleo/shared";
import { resolveConfig } from "@maleo/shared/provider-config";
import type { StockAudio, StockProviderReachability } from "./types.ts";

export const FREESOUND_API_KEY = "FREESOUND_API_KEY";
export const FREESOUND_COMMERCIAL_USE_APPROVED = "FREESOUND_COMMERCIAL_USE_APPROVED";
export const FREESOUND_LICENSE_FILTER = "FREESOUND_LICENSE_FILTER";

export function freesoundKey(): string | undefined {
	return resolveConfig(FREESOUND_API_KEY);
}

export function isFreesoundConfigured(): boolean {
	return Boolean(freesoundKey()) && resolveConfig(FREESOUND_COMMERCIAL_USE_APPROVED) === "yes";
}

let fetchOverride: ((url: string, init: RequestInit) => Promise<Response>) | null = null;
export function setFreesoundFetchForTests(
	fn: ((url: string, init: RequestInit) => Promise<Response>) | null,
): void {
	fetchOverride = fn;
}

async function request(url: string): Promise<Response> {
	const result = await (fetchOverride ?? fetch)(url, { signal: AbortSignal.timeout(15_000) });
	captureRate("freesound", result);
	return result;
}

/** Search Freesound for royalty-free sound effects. Empty when no key. */
export async function searchFreesoundSfx(query: string, limit = 12): Promise<StockAudio[]> {
	if (!isFreesoundConfigured()) return [];
	const key = freesoundKey();
	if (!key) return [];
	const license = resolveConfig(FREESOUND_LICENSE_FILTER) ?? "Creative Commons 0";
	const filter = license.trim()
		? `&filter=${encodeURIComponent(`license:"${license.trim()}"`)}`
		: "";
	const ep = `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(query)}&page_size=${limit}&fields=id,name,username,duration,previews,license${filter}&token=${encodeURIComponent(key)}`;
	const res = await request(ep);
	if (!res.ok) throw new Error(`freesound ${res.status}`);
	const body: unknown = await res.json();
	const results = fieldOf(body, "results");
	const items = Array.isArray(results) ? results : [];
	const sounds = items
		.map((item): StockAudio | null => {
			const previews = fieldOf(item, "previews");
			const url = fieldOf(previews, "preview-hq-mp3") ?? fieldOf(previews, "preview-lq-mp3");
			if (typeof url !== "string" || !url) return null;
			const duration = fieldOf(item, "duration");
			const id = textOf(fieldOf(item, "id"));
			const author = textOf(fieldOf(item, "username"));
			const license = textOf(fieldOf(item, "license"));
			return {
				url,
				title: textOf(fieldOf(item, "name")),
				author,
				authorUrl: author
					? `https://freesound.org/people/${encodeURIComponent(author)}/`
					: undefined,
				pageUrl:
					id && author
						? `https://freesound.org/people/${encodeURIComponent(author)}/sounds/${encodeURIComponent(id)}/`
						: undefined,
				license: license || undefined,
				licenseUrl: /^https?:\/\//.test(license) ? license : undefined,
				durationSec: typeof duration === "number" ? duration : undefined,
			};
		})
		.filter((x): x is StockAudio => x !== null);
	// A sound with no preview url is unusable and was already being dropped. The
	// count is what tells a thin result set apart from a changed response shape.
	captureDrops("freesound", items.length - sounds.length, items.length);
	return sounds;
}

export async function probeFreesound(): Promise<StockProviderReachability> {
	const key = freesoundKey();
	if (!key) return { ok: false, reason: `${FREESOUND_API_KEY} is not set` };
	if (resolveConfig(FREESOUND_COMMERCIAL_USE_APPROVED) !== "yes") {
		return { ok: false, reason: "commercial API permission is not confirmed" };
	}
	const url = `https://freesound.org/apiv2/search/text/?query=whoosh&page_size=1&fields=id&token=${encodeURIComponent(key)}`;
	try {
		const result = await request(url);
		return result.ok ? { ok: true } : { ok: false, reason: `Freesound returned ${result.status}` };
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : String(error) };
	}
}
