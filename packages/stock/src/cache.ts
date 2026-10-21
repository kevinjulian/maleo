/* Shared response cache and rate-limit visibility for every stock source.
 *
 * This lives here rather than in each adapter because it was previously in only
 * ONE of them: the audio lib cached for 24h while the Pexels calls inlined in
 * routes/stock.ts and routes/sources.ts cached nothing at all. Providers differ
 * on whether caching is polite or mandatory — Pixabay's terms REQUIRE responses
 * be cached 24h — so the safe default belongs at the seam, not in whichever
 * adapter someone remembers.
 *
 * Hits live a day; misses expire fast so a transient failure or a rate-limited
 * empty response retries soon instead of being pinned for a day. */

export const TTL_HIT_MS = 24 * 60 * 60 * 1000;
export const TTL_MISS_MS = 5 * 60 * 1000;

interface Entry<T> {
	value: T;
	expires: number;
}

const store = new Map<string, Entry<unknown>>();

export function clearStockCache(): void {
	store.clear();
}

/** Read-through cache. `empty` decides what counts as a miss for TTL purposes,
 *  so an empty array and a null both expire fast. */
export async function cached<T>(
	key: string,
	load: () => Promise<T>,
	isEmpty: (value: T) => boolean,
): Promise<T> {
	const hit = store.get(key);
	if (hit && hit.expires > Date.now()) {
		// SAFETY: a key is only ever written by `cached` calls for that key, which load
		// the same T; the store is heterogeneous only across keys.
		return hit.value as T;
	}
	const value = await load();
	store.set(key, { value, expires: Date.now() + (isEmpty(value) ? TTL_MISS_MS : TTL_HIT_MS) });
	return value;
}

// Last-seen rate-limit headers per provider, for diagnostics. Providers expose
// X-RateLimit-* (Freesound 60/min, 2000/day; Pixabay 100/60s).
const rateInfo: Record<string, { limit?: string; remaining?: string; at: number }> = {};

export function getStockRateInfo(): Readonly<typeof rateInfo> {
	return rateInfo;
}

/* Items a provider returned that this code could not use — no usable url, a
 * missing id. They were already being dropped by the `.filter()` at the end of
 * each mapper; what was missing is that nobody could tell one dropped item from
 * forty. A provider changing its response shape looks exactly like a thin day
 * of search results otherwise.
 *
 * Diagnostics, in the same shape and for the same reason as the rate info
 * above. Note that `getStockRateInfo` has no reader in the app today, so this
 * has none either — it is where a reader would look, not a display. */
const dropInfo: Record<string, { dropped: number; seen: number; at: number }> = {};

export function getStockDropInfo(): Readonly<typeof dropInfo> {
	return dropInfo;
}

export function captureDrops(provider: string, dropped: number, seen: number): void {
	if (seen === 0) return;
	const prior = dropInfo[provider];
	dropInfo[provider] = {
		dropped: (prior?.dropped ?? 0) + dropped,
		seen: (prior?.seen ?? 0) + seen,
		at: Date.now(),
	};
}

export function captureRate(provider: string, res: Response): void {
	const limit = res.headers.get("x-ratelimit-limit") ?? undefined;
	const remaining = res.headers.get("x-ratelimit-remaining") ?? undefined;
	if (limit || remaining) rateInfo[provider] = { limit, remaining, at: Date.now() };
}
