/* Audio cue resolution — the seam the agent and the timeline builders call.
 *
 * Moved verbatim from packages/api/src/lib/stock-audio.ts, contract unchanged:
 * a dozen call sites depend on these signatures, and changing them in the same
 * step as the move would turn a migration into a debugging session.
 *
 * Music + ambient come from the curated library; sfx + accent hits from Freesound.
 *
 * The music source used to be a live third-party search. It was removed rather
 * than supplemented: it answered valid queries with an empty success roughly a
 * quarter of the time, its free tier was licensed for non-commercial use while
 * this product publishes monetised video, and keyword matching over a large
 * catalogue could not be steered toward a tone. Swapping the branch below was
 * the whole removal — no caller names a provider. */

import { searchMusicLibrary } from "./music-library.ts";
import { searchFreesoundSfx } from "./freesound.ts";
import { TTL_HIT_MS, TTL_MISS_MS } from "./cache.ts";
import type { StockAudio, StockAudioKind } from "./types.ts";

export async function searchStockAudio(
	kind: StockAudioKind,
	query: string,
	limit = 12,
): Promise<StockAudio[]> {
	return kind === "music" || kind === "ambient"
		? searchMusicLibrary(query, limit)
		: searchFreesoundSfx(query, limit);
}

// Test seam: stub the resolver so the agent flow can be tested without network.
let resolverOverride: ((kind: StockAudioKind, query: string) => Promise<StockAudio | null>) | null =
	null;
export function setStockAudioResolverForTests(
	fn: ((kind: StockAudioKind, query: string) => Promise<StockAudio | null>) | null,
): void {
	resolverOverride = fn;
}
// Test seam: replace the underlying search (keeps the cache path live, so the
// cache itself is testable without network).
let searchOverride:
	| ((kind: StockAudioKind, query: string, limit: number) => Promise<StockAudio[]>)
	| null = null;
export function setStockSearchForTests(
	fn: ((kind: StockAudioKind, query: string, limit: number) => Promise<StockAudio[]>) | null,
): void {
	searchOverride = fn;
}

// Resolution cache: identical (kind, query) lookups reuse the result instead of
// re-hitting the provider — the main lever for staying under the rate limits.
interface CacheEntry {
	value: StockAudio | null;
	expires: number;
}
const cache = new Map<string, CacheEntry>();
const cacheKey = (kind: StockAudioKind, q: string): string => `${kind}|${q.toLowerCase()}`;

export function clearStockAudioCache(): void {
	cache.clear();
	poolCache.clear();
}

/** Resolve an audio cue to the single best-matching royalty-free clip, or null
 *  when no provider key is set / nothing matched / the lookup failed. */
export async function resolveStockAudio(
	kind: StockAudioKind,
	query: string,
): Promise<StockAudio | null> {
	if (resolverOverride) return resolverOverride(kind, query);
	const q = query.trim();
	if (!q) return null;
	const key = cacheKey(kind, q);
	const hit = cache.get(key);
	if (hit && hit.expires > Date.now()) return hit.value;
	let value: StockAudio | null = null;
	try {
		const items = await (searchOverride ?? searchStockAudio)(kind, q, 8);
		value = items[0] ?? null;
	} catch {
		value = null;
	}
	cache.set(key, { value, expires: Date.now() + (value ? TTL_HIT_MS : TTL_MISS_MS) });
	return value;
}

/** Resolve a descriptive SFX cue, then progressively relax decorative words and
 *  finally use a generic transition cue. Keeps preview and generated timelines in sync. */
export async function resolveStockAudioCue(
	kind: "sfx" | "accent_hit",
	cue: string,
): Promise<StockAudio | null> {
	const exact = cue.trim();
	if (!exact) return null;
	const simplified = exact
		.split(/\s+/)
		.filter(
			(word) => !["subtle", "soft", "short", "cinematic", "accent"].includes(word.toLowerCase()),
		)
		.join(" ");
	return (
		(await resolveStockAudio(kind, exact)) ??
		(simplified && simplified !== exact ? await resolveStockAudio(kind, simplified) : null) ??
		(await resolveStockAudio(kind, "whoosh transition"))
	);
}

// Pool cache mirrors the single-result cache: one provider call per (kind, query)
// yields several candidates, so a varied pool costs the same quota as one lookup.
interface PoolCacheEntry {
	value: StockAudio[];
	expires: number;
}
const poolCache = new Map<string, PoolCacheEntry>();

/** Resolve a set of audio cues to a deduplicated pool of royalty-free clips —
 *  up to `perQuery` matches per cue. Callers rotate through the pool (e.g. one
 *  stinger per section boundary) so repeated hits don't all reuse one clip. */
export async function resolveStockAudioPool(
	kind: StockAudioKind,
	queries: readonly string[],
	perQuery = 2,
): Promise<StockAudio[]> {
	const seen = new Set<string>();
	const pool: StockAudio[] = [];
	for (const query of queries) {
		const q = query.trim();
		if (!q) continue;
		const key = `pool|${perQuery}|${cacheKey(kind, q)}`;
		const hit = poolCache.get(key);
		let items: StockAudio[];
		if (hit && hit.expires > Date.now()) {
			items = hit.value;
		} else {
			if (resolverOverride) {
				const single = await resolverOverride(kind, q);
				items = single ? [single] : [];
			} else {
				try {
					items = (
						await (searchOverride ?? searchStockAudio)(kind, q, Math.max(perQuery, 4))
					).slice(0, perQuery);
				} catch {
					items = [];
				}
			}
			poolCache.set(key, {
				value: items,
				expires: Date.now() + (items.length ? TTL_HIT_MS : TTL_MISS_MS),
			});
		}
		for (const item of items) {
			if (seen.has(item.url)) continue;
			seen.add(item.url);
			pool.push(item);
		}
	}
	return pool;
}
