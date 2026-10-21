/* A bounded, content-keyed cache with least-recently-used eviction.
 *
 * Bounded because a timeline that caches every summary it has ever produced is a
 * timeline that runs out of memory on a long project — the failure arrives late,
 * on somebody else's machine, in a session that had been going for an hour.
 *
 * Keyed by content rather than by item, because two items trimmed from one asset
 * over the same range are the same summary, and an item that is trimmed becomes
 * a different request rather than a stale entry.
 */
import { summaryCacheKey, summarySatisfies, type SummaryRequestKey } from "./cache-key.ts";
import type { SummaryPayload } from "./protocol.ts";

/** What the cache holds for one key. */
export interface CachedSummary {
	readonly key: SummaryRequestKey;
	readonly payload: SummaryPayload;
	readonly achievedDensity: number;
	/** Roughly how much room this entry takes, in buckets. */
	readonly weight: number;
}

export interface SummaryCacheOptions {
	/**
	 * The bound, in buckets rather than in entries.
	 *
	 * Entries would be the wrong unit: one filmstrip at high density is worth a
	 * hundred coarse waveforms, and a bound in entries lets the expensive case
	 * through while evicting the cheap one.
	 */
	readonly maxBuckets: number;
}

export interface SummaryCache {
	/** The best cached entry that can serve this request, if any. */
	get(wanted: SummaryRequestKey): CachedSummary | undefined;
	set(entry: Omit<CachedSummary, "weight">): void;
	/** Current size, in buckets. Never above the bound. */
	size(): number;
	count(): number;
	/** Keys in least-recently-used order, for the eviction tests. */
	keys(): readonly string[];
	clear(): void;
}

function weigh(payload: SummaryPayload): number {
	return Math.max(1, payload.buckets.length + (payload.frames?.length ?? 0));
}

export function createSummaryCache(options: SummaryCacheOptions): SummaryCache {
	/* A `Map` iterates in insertion order, so re-inserting on read is all the
	 * recency bookkeeping this needs — no second structure that could disagree
	 * with the first about which entry is oldest. */
	const entries = new Map<string, CachedSummary>();
	let size = 0;

	function evictTo(bound: number): void {
		for (const [key, entry] of entries) {
			if (size <= bound) return;
			entries.delete(key);
			size -= entry.weight;
		}
	}

	return {
		get(wanted) {
			const exact = entries.get(summaryCacheKey(wanted));
			if (exact) {
				entries.delete(summaryCacheKey(wanted));
				entries.set(summaryCacheKey(wanted), exact);
				return exact;
			}
			/* A finer summary for the same range serves a coarser request. This is
			 * what makes zooming out free: the summary already in hand exceeds what
			 * the new zoom needs, so no work is requested. */
			for (const [key, entry] of [...entries].reverse()) {
				if (!summarySatisfies(entry.key, wanted)) continue;
				entries.delete(key);
				entries.set(key, entry);
				return entry;
			}
			return undefined;
		},
		set(entry) {
			const key = summaryCacheKey(entry.key);
			const existing = entries.get(key);
			if (existing) size -= existing.weight;
			const weight = weigh(entry.payload);
			entries.delete(key);
			entries.set(key, { ...entry, weight });
			size += weight;
			/* Evicted to the bound, not below it and not after exceeding it for a
			 * frame: the declared bound is the maximum, so it is enforced inside the
			 * write that would otherwise break it. */
			evictTo(options.maxBuckets);
		},
		size: () => size,
		count: () => entries.size,
		keys: () => [...entries.keys()],
		clear() {
			entries.clear();
			size = 0;
		},
	};
}
