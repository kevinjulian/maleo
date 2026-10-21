/* The pipeline: what is asked for, what is in flight, and what is no longer wanted.
 *
 * It owns three things and delegates everything else. It decides the density
 * from the pixels available, it keeps the cache and the in-flight registry from
 * disagreeing about identity, and it cancels work whose reason has gone away —
 * a fast scroll across a long project otherwise queues a request for every item
 * it passes and the queue outlives the scroll.
 *
 * It decodes nothing itself. Where no worker exists it reports the summary as
 * unavailable rather than decoding on the main thread, because a decode on the
 * main thread stalls the frame and a timeline is judged on whether it keeps up
 * with a finger.
 */
import type { EnvironmentCapabilities } from "./environment.ts";
import { summaryCacheKey, type SummaryRequestKey } from "./cache-key.ts";
import { createSummaryCache, type SummaryCache } from "./cache.ts";
import { choosePath } from "./extraction.ts";
import type {
	SummaryMessage,
	SummaryPayload,
	SummaryRequest,
	SummaryWorker,
	ExtractionPath,
} from "./protocol.ts";

/** What the timeline knows about one item's summary right now. */
export type SummaryStatus = "missing" | "pending" | "ready" | "failed" | "unavailable";

/** Everything a painter needs to decide how to draw an item. */
export interface SummaryState {
	readonly status: SummaryStatus;
	readonly payload?: SummaryPayload;
	readonly path?: ExtractionPath;
	readonly achievedDensity?: number;
	/** True when the path taken is weaker than the preferred one. */
	readonly degraded?: boolean;
	readonly reason?: string;
}

/** An item's summary is now in a different state. */
export type SummaryListener = (key: SummaryRequestKey, state: SummaryState) => void;

export interface PipelineOptions {
	/** Absent, or present with no worker, is the reportable no-worker path. */
	readonly worker?: SummaryWorker;
	readonly capabilities: EnvironmentCapabilities;
	readonly cache?: SummaryCache;
	/** Bucket bound for the default cache. */
	readonly maxBuckets?: number;
	/** Told when a summary changes state, so the host can invalidate that region. */
	onChange?: SummaryListener;
}

export interface SummaryQuery extends SummaryRequestKey {
	/** Where the asset is. The consumer's locator. */
	readonly source: string;
}

export interface MediaPipeline {
	/** Ask for a summary, or take the cached one. Returns the state right now. */
	request(query: SummaryQuery): SummaryState;
	/** The state of a summary without asking for one. */
	stateOf(key: SummaryRequestKey): SummaryState;
	/** Abandon everything not in this set of keys. Returns how many were cancelled. */
	retain(keys: Iterable<SummaryRequestKey>): number;
	/** Abandon one request. */
	cancel(key: SummaryRequestKey): boolean;
	inFlight(): readonly string[];
	dispose(): void;
}

const MISSING: SummaryState = { status: "missing" };

export function createMediaPipeline(options: PipelineOptions): MediaPipeline {
	const cache = options.cache ?? createSummaryCache({ maxBuckets: options.maxBuckets ?? 50_000 });
	const states = new Map<string, SummaryState>();
	/* Two directions, because cancellation arrives by cache key and results
	 * arrive by request id, and a single map would make one of them a scan. */
	const pending = new Map<string, string>();
	const requests = new Map<string, SummaryRequestKey>();
	let sequence = 0;
	let unsubscribe: (() => void) | undefined;

	function publish(key: SummaryRequestKey, state: SummaryState): SummaryState {
		states.set(summaryCacheKey(key), state);
		options.onChange?.(key, state);
		return state;
	}

	function receive(message: SummaryMessage): void {
		const key = requests.get(message.requestId);
		/* A result whose request was cancelled is discarded, and nothing is
		 * painted for it. The worker had already started; the reason it started
		 * has gone. */
		if (!key) return;
		requests.delete(message.requestId);
		pending.delete(summaryCacheKey(key));

		if (message.type === "failure") {
			publish(key, { status: "failed", reason: message.reason });
			return;
		}
		cache.set({
			key: message.key,
			payload: message.payload,
			achievedDensity: message.achievedDensity,
		});
		publish(key, {
			status: "ready",
			payload: message.payload,
			path: message.path,
			achievedDensity: message.achievedDensity,
			degraded: message.degraded,
		});
	}

	if (options.worker) unsubscribe = options.worker.subscribe(receive);

	function cancelKey(cacheKey: string): boolean {
		const requestId = pending.get(cacheKey);
		if (requestId === undefined) return false;
		pending.delete(cacheKey);
		requests.delete(requestId);
		options.worker?.cancel({ type: "cancel", requestId });
		/* Back to `missing`, not `failed`: nothing went wrong, the timeline
		 * stopped wanting it. An item in this state paints and stays interactive
		 * exactly as one that was never asked for. */
		states.delete(cacheKey);
		return true;
	}

	return {
		stateOf(key) {
			return states.get(summaryCacheKey(key)) ?? MISSING;
		},

		request(query) {
			const key: SummaryRequestKey = {
				assetId: query.assetId,
				kind: query.kind,
				density: query.density,
				sourceStart: query.sourceStart,
				sourceEnd: query.sourceEnd,
			};
			const cacheKey = summaryCacheKey(key);

			/* Cache first, including a finer summary for the same range: this is the
			 * whole of the zoom-out case, and it must not depend on a request being
			 * issued and then answered from cache. */
			const cached = cache.get(key);
			if (cached) {
				return publish(key, {
					status: "ready",
					payload: cached.payload,
					achievedDensity: cached.achievedDensity,
					degraded: cached.achievedDensity < key.density,
				});
			}
			const existing = states.get(cacheKey);
			if (existing?.status === "pending") return existing;

			if (!options.worker || !options.capabilities.worker) {
				/* Reported, not worked around. The timeline paints the item without
				 * its summary and stays interactive. */
				return publish(key, {
					status: "unavailable",
					reason:
						"@maleo/vui: this environment provides no worker, so summaries are not produced on the main thread",
				});
			}

			const choice = choosePath(key.kind, key.density, options.capabilities);
			const requestId = `summary-${++sequence}`;
			pending.set(cacheKey, requestId);
			requests.set(requestId, key);
			const request: SummaryRequest = { ...key, requestId, source: query.source };
			options.worker.post(request);
			return publish(key, {
				status: "pending",
				path: choice.path,
				degraded: choice.degraded,
				reason: choice.reason,
			});
		},

		cancel(key) {
			return cancelKey(summaryCacheKey(key));
		},

		retain(keys) {
			const wanted = new Set<string>();
			for (const key of keys) wanted.add(summaryCacheKey(key));
			let cancelled = 0;
			for (const cacheKey of [...pending.keys()]) {
				if (wanted.has(cacheKey)) continue;
				if (cancelKey(cacheKey)) cancelled += 1;
			}
			return cancelled;
		},

		inFlight: () => [...pending.keys()],

		dispose() {
			for (const cacheKey of [...pending.keys()]) cancelKey(cacheKey);
			unsubscribe?.();
			options.worker?.terminate?.();
			states.clear();
		},
	};
}
