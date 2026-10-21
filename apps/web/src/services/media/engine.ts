/* The worker side: what actually decodes, and what it refuses to do.
 *
 * This runs inside the consumer's worker. It is written as a plain function over
 * injected decoders rather than as a worker script because the library cannot
 * construct a worker — only the consumer knows how their bundler emits one — and
 * because a decoder that can be substituted is a decoder that can be tested
 * without a browser.
 *
 * Two constraints are enforced here rather than trusted to the caller:
 * **decoding happens in ranges**, so peak memory follows the range and not the
 * asset's length; and **a cancelled request stops between ranges**, so a fast
 * scroll does not pay for work whose reason has gone.
 */
import type { SummaryRequestKey } from "./cache-key.ts";
import { choosePath, decimate, decodeRanges } from "./extraction.ts";
import type { EnvironmentCapabilities } from "./environment.ts";
import type { SummaryFailure, SummaryMessage, SummaryRequest, SummaryResult } from "./protocol.ts";

/** Decode one range of audio into samples. Supplied by the consumer's worker. */
export type AudioRangeDecoder = (
	source: string,
	startTicks: number,
	endTicks: number,
) => Promise<readonly number[]>;

/** Extract frames for one range. Returns however many it managed. */
export type FrameExtractor = (
	source: string,
	startTicks: number,
	endTicks: number,
	wanted: number,
) => Promise<readonly string[]>;

export interface SummaryEngineOptions {
	readonly capabilities: EnvironmentCapabilities;
	decodeAudioRange?: AudioRangeDecoder;
	extractFrames?: FrameExtractor;
	/**
	 * How much source one decode range covers, in source ticks.
	 *
	 * The knob that bounds peak memory. A long asset becomes many small decodes
	 * rather than one large one, and the summary is assembled from their outputs.
	 */
	readonly ticksPerRange?: number;
}

export interface SummaryEngine {
	/** Produce a summary, or say why not. Resolves once per request. */
	run(request: SummaryRequest): Promise<SummaryMessage>;
	/** Abandon a request. Work in progress stops at its next range boundary. */
	cancel(requestId: string): void;
}

function failure(request: SummaryRequest, reason: string, retryable = false): SummaryFailure {
	const key: SummaryRequestKey = {
		assetId: request.assetId,
		kind: request.kind,
		density: request.density,
		sourceStart: request.sourceStart,
		sourceEnd: request.sourceEnd,
	};
	return { type: "failure", requestId: request.requestId, key, reason, retryable };
}

/** How many buckets a range of this length wants at this density. */
function bucketsFor(
	startTicks: number,
	endTicks: number,
	density: number,
	ticksPerSecond: number,
): number {
	const seconds = Math.max(0, endTicks - startTicks) / Math.max(1, ticksPerSecond);
	return Math.max(1, Math.round(seconds * density));
}

export function createSummaryEngine(options: SummaryEngineOptions): SummaryEngine {
	const cancelled = new Set<string>();
	/* One second of source per range by default, expressed in the tick rate the
	 * request carries. Small enough that a cancellation lands promptly, large
	 * enough that a long asset is not thousands of decode calls. */
	const ticksPerRange = options.ticksPerRange ?? 30_000;

	return {
		cancel(requestId) {
			cancelled.add(requestId);
		},

		async run(request) {
			const choice = choosePath(request.kind, request.density, options.capabilities);
			const density = Math.min(request.density, choice.maxDensity);
			const ranges = decodeRanges(request.sourceStart, request.sourceEnd, ticksPerRange);
			if (ranges.length === 0)
				return failure(request, `@maleo/vui: ${request.assetId} has an empty source range`);

			const buckets: number[] = [];
			const frames: string[] = [];
			for (const range of ranges) {
				/* Checked between ranges, which is what makes cancellation actually
				 * save work: a check only at the start would let a ten-minute decode
				 * run to completion after the scroll that wanted it had passed. */
				if (cancelled.has(request.requestId)) {
					cancelled.delete(request.requestId);
					return failure(request, `@maleo/vui: request ${request.requestId} was cancelled`, true);
				}
				const wanted = bucketsFor(range.start, range.end, density, ticksPerRange);
				try {
					if (request.kind === "waveform") {
						if (!options.decodeAudioRange)
							return failure(request, "@maleo/vui: this engine has no audio decoder");
						buckets.push(
							...decimate(
								await options.decodeAudioRange(request.source, range.start, range.end),
								wanted,
							),
						);
					} else {
						if (!options.extractFrames)
							return failure(request, "@maleo/vui: this engine has no frame extractor");
						const extracted = await options.extractFrames(
							request.source,
							range.start,
							range.end,
							wanted,
						);
						frames.push(...extracted);
						buckets.push(...extracted.map(() => 1));
					}
				} catch (error) {
					/* A decode failure is a message, not a throw: the request has to
					 * answer, or the item stays pending forever and the consumer has no
					 * state to render. */
					return failure(
						request,
						`@maleo/vui: ${request.assetId} could not be decoded: ${String(error)}`,
						true,
					);
				}
			}

			const key: SummaryRequestKey = {
				assetId: request.assetId,
				kind: request.kind,
				density,
				sourceStart: request.sourceStart,
				sourceEnd: request.sourceEnd,
			};
			const result: SummaryResult = {
				type: "result",
				requestId: request.requestId,
				key,
				payload: {
					kind: request.kind,
					buckets,
					frames: request.kind === "filmstrip" ? frames : undefined,
				},
				path: choice.path,
				/* What was actually achieved, never the number that was asked for.
				 * The fallback path reaches a tenth of the requested density and says
				 * so; misreporting it here is precisely the silence the spec forbids. */
				achievedDensity: density,
				degraded: choice.degraded || density < request.density,
			};
			return result;
		},
	};
}

/** The two entry points a consumer's worker script wires to its message port. */
export interface EngineWorkerBridge {
	handle(request: SummaryRequest, reply: (message: SummaryMessage) => void): void;
	cancel(requestId: string): void;
}

/**
 * A worker built from an engine, for a consumer wiring one up.
 *
 * The message plumbing, so a consumer's worker script is an import and two
 * lines. It is here rather than in an example because getting the cancellation
 * bookkeeping right is the whole difficulty, and every consumer would get it
 * subtly differently.
 */
export function engineWorker(engine: SummaryEngine): EngineWorkerBridge {
	return {
		handle(request, reply) {
			void engine.run(request).then(reply);
		},
		cancel(requestId) {
			engine.cancel(requestId);
		},
	};
}
