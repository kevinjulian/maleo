/* The wire between the timeline and whatever produces summaries.
 *
 * Everything crossing it is data, because it crosses a worker boundary: a
 * message carrying a callback cannot be posted, and a protocol that only works
 * in-process is a protocol that will be discovered not to work the first time it
 * is actually moved off the main thread.
 *
 * Four messages, and the last two are not optional extras. A pipeline without
 * cancellation queues work for every item a fast scroll passes, and the queue
 * outlives the reason for it; a pipeline without a failure message turns a
 * broken asset into a request that never answers.
 */
import type { SummaryKind, SummaryRequestKey } from "./cache-key.ts";

/** How a summary was actually produced. Reported, never assumed. */
export type ExtractionPath = "audio-decode" | "webcodecs" | "video-seek";

/** Ask for a summary. */
export interface SummaryRequest extends SummaryRequestKey {
	/** Identifies this request for its result and its cancellation. */
	readonly requestId: string;
	/** Where the asset is. The consumer's own locator; opaque to the library. */
	readonly source: string;
}

/** Abandon a request. Safe to send for one that has already answered. */
export interface SummaryCancel {
	readonly type: "cancel";
	readonly requestId: string;
}

/** Paint-ready data: peaks for a waveform, frame images for a filmstrip. */
export interface SummaryPayload {
	readonly kind: SummaryKind;
	/**
	 * One value per bucket, already decimated.
	 *
	 * The main thread receives summarised data and nothing else — a message
	 * carrying raw samples has moved the decode off the main thread and left the
	 * cost of transferring and reducing it on.
	 */
	readonly buckets: readonly number[];
	/** Frame images, for a filmstrip. Opaque handles the consumer paints. */
	readonly frames?: readonly string[];
}

/** A summary that was produced. */
export interface SummaryResult {
	readonly type: "result";
	readonly requestId: string;
	readonly key: SummaryRequestKey;
	readonly payload: SummaryPayload;
	/** Which path produced it. */
	readonly path: ExtractionPath;
	/**
	 * The density actually achieved.
	 *
	 * Separate from the requested density, and never quietly equal to it: a
	 * consumer that cannot tell a full-quality summary from a degraded one cannot
	 * decide whether to show it, cache it, or ask for it again elsewhere.
	 */
	readonly achievedDensity: number;
	/** True when the path taken is not the preferred one for this media kind. */
	readonly degraded: boolean;
}

/** A summary that could not be produced. */
export interface SummaryFailure {
	readonly type: "failure";
	readonly requestId: string;
	readonly key: SummaryRequestKey;
	readonly reason: string;
	/** True when trying again might work — a network blip rather than a bad file. */
	readonly retryable: boolean;
}

/** What a worker sends back. */
export type SummaryMessage = SummaryResult | SummaryFailure;

/**
 * Whatever produces summaries off the main thread.
 *
 * An interface rather than a `Worker`, so a consumer may supply a worker pool, a
 * server, or a test double. The library never constructs one: only the consumer
 * knows how their bundler emits a worker.
 */
export interface SummaryWorker {
	post(request: SummaryRequest): void;
	cancel(cancel: SummaryCancel): void;
	/** Register the sink for results and failures. Called once. */
	subscribe(listener: (message: SummaryMessage) => void): () => void;
	terminate?(): void;
}

/** Whether a message is data all the way down, for the boundary tests. */
export function isPostable(value: unknown): boolean {
	/* `undefined` passes: the structured clone algorithm carries it, and an
	 * optional field left explicitly unset is the ordinary shape of these
	 * messages. A function or a symbol does not, which is what this is for. */
	if (value === null || value === undefined) return true;
	switch (typeof value) {
		case "string":
		case "number":
		case "boolean":
			return true;
		case "object":
			break;
		case "bigint":
		case "function":
		case "symbol":
		case "undefined":
			return false;
	}
	if (Array.isArray(value)) return value.every(isPostable);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	return Object.values(value).every(isPostable);
}
