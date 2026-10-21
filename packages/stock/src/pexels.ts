/* Pexels — licensed stock images and video. Configuration comes through the
 * shared provider seam, so Settings readiness and real searches read one value. */

import { cached, captureDrops, captureRate } from "./cache.ts";
import { fieldOf, textOf } from "@maleo/shared";
import { resolveConfig } from "@maleo/shared/provider-config";
import type { StockAsset, StockProviderReachability, StockSearchLimit } from "./types.ts";

/** A string field, or undefined when the provider sent something else. */
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

const LICENSE = "Pexels License";
const LICENSE_URL = "https://www.pexels.com/license/";
export const PEXELS_API_KEY = "PEXELS_API_KEY";

export function pexelsKey(): string | undefined {
	return resolveConfig(PEXELS_API_KEY);
}

export function isPexelsConfigured(): boolean {
	return Boolean(pexelsKey());
}

// Test seam so adapter tests can exercise provider responses without network.
let fetchOverride: ((url: string, init: RequestInit) => Promise<unknown>) | null = null;
export function setPexelsFetchForTests(
	fn: ((url: string, init: RequestInit) => Promise<unknown>) | null,
): void {
	fetchOverride = fn;
}

async function request(
	url: string,
	key: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
	const init = { headers: { Authorization: key }, signal: AbortSignal.timeout(15_000) };
	const result = fetchOverride ? await fetchOverride(url, init) : await fetch(url, init);
	if (!(result instanceof Response)) return { ok: true, status: 200, body: result };
	captureRate("pexels", result);
	return {
		ok: result.ok,
		status: result.status,
		body: result.ok ? await result.json().catch(() => null) : null,
	};
}

/** The decoded body, or null when there is no key, the call failed, or Pexels
 *  answered with something that is not JSON. Deliberately `unknown`: the callers
 *  read the fields they need through `fieldOf`, so nothing here has to claim a
 *  shape for a response this code did not write. */
async function get(url: string): Promise<unknown> {
	const key = pexelsKey();
	if (!key) return null;
	try {
		const result = await request(url, key);
		return result.ok ? result.body : null;
	} catch {
		return null;
	}
}

export async function probePexels(): Promise<StockProviderReachability> {
	const key = pexelsKey();
	if (!key) return { ok: false, reason: `${PEXELS_API_KEY} is not set` };
	try {
		const result = await request(
			"https://api.pexels.com/v1/search?per_page=1&page=1&query=cinematic",
			key,
		);
		return result.ok ? { ok: true } : { ok: false, reason: `Pexels returned ${result.status}` };
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : String(error) };
	}
}

/** The list a search response carries, or empty when the field is absent or is
 *  not an array — which is what a changed response looks like from here. */
function listOf(body: unknown, key: string): unknown[] {
	const list = fieldOf(body, key);
	return Array.isArray(list) ? list : [];
}

/** Prefer a rendition that is actually usable in a composition: hd, then sd,
 *  then whatever exists. Picking video_files[0] blindly sometimes yielded a tiny
 *  preview. */
function pickVideoFile(video: unknown): string | undefined {
	const files = fieldOf(video, "video_files");
	if (!Array.isArray(files) || !files.length) return undefined;
	const byQuality = (want: string): unknown => files.find((f) => fieldOf(f, "quality") === want);
	const chosen = byQuality("hd") ?? byQuality("sd") ?? files[0];
	return str(fieldOf(chosen, "link"));
}

export async function searchPexelsImages(
	query: string,
	opts: StockSearchLimit = {},
): Promise<StockAsset[]> {
	const q = query.trim();
	if (!q) return [];
	const perPage = Math.min(80, Math.max(1, opts.perPage ?? 24));
	const page = opts.page ?? 1;
	const url = `https://api.pexels.com/v1/search?per_page=${perPage}&page=${page}&query=${encodeURIComponent(q)}`;
	return cached(
		`pexels|images|${perPage}|${page}|${q.toLowerCase()}`,
		async () => {
			const photos = listOf(await get(url), "photos");
			const assets = photos
				.map((photo): StockAsset => {
					const src = fieldOf(photo, "src");
					return {
						id: textOf(fieldOf(photo, "id")),
						kind: "image",
						provider: "Pexels",
						url: str(fieldOf(src, "large")) ?? str(fieldOf(src, "original")) ?? "",
						thumbUrl: str(fieldOf(src, "medium")) ?? str(fieldOf(src, "small")),
						pageUrl: str(fieldOf(photo, "url")),
						title: str(fieldOf(photo, "alt")),
						author: str(fieldOf(photo, "photographer")),
						authorUrl: str(fieldOf(photo, "photographer_url")),
						license: LICENSE,
						licenseUrl: LICENSE_URL,
					};
				})
				.filter((asset) => asset.url);
			captureDrops("pexels", photos.length - assets.length, photos.length);
			return assets;
		},
		(value) => value.length === 0,
	);
}

export async function searchPexelsVideos(
	query: string,
	opts: StockSearchLimit = {},
): Promise<StockAsset[]> {
	const q = query.trim();
	if (!q) return [];
	const perPage = Math.min(80, Math.max(1, opts.perPage ?? 24));
	const page = opts.page ?? 1;
	const url = `https://api.pexels.com/videos/search?per_page=${perPage}&page=${page}&query=${encodeURIComponent(q)}`;
	return cached(
		`pexels|videos|${perPage}|${page}|${q.toLowerCase()}`,
		async () => {
			const videos = listOf(await get(url), "videos");
			const assets = videos
				.map((video): StockAsset => {
					const file = pickVideoFile(video);
					const user = fieldOf(video, "user");
					const duration = fieldOf(video, "duration");
					return {
						id: textOf(fieldOf(video, "id")),
						kind: "video",
						provider: "Pexels",
						url: file ?? "",
						thumbUrl: str(fieldOf(video, "image")),
						pageUrl: str(fieldOf(video, "url")),
						author: str(fieldOf(user, "name")),
						authorUrl: str(fieldOf(user, "url")),
						durationSec: typeof duration === "number" ? duration : undefined,
						license: LICENSE,
						licenseUrl: LICENSE_URL,
					};
				})
				.filter((asset) => asset.url);
			captureDrops("pexels", videos.length - assets.length, videos.length);
			return assets;
		},
		(value) => value.length === 0,
	);
}
