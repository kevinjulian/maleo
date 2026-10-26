/* The media pipeline: off the main thread, bounded, cancellable, and honest.
 *
 * The decoders are injected doubles, which is the only way to assert the two
 * claims that matter most — that the main thread does no decoding, and that a
 * cancelled request stops before it finishes rather than being ignored when it
 * does.
 */
import { describe, expect, test } from "vite-plus/test";
import type { EnvironmentCapabilities } from "./environment.ts";
import { summaryCacheKey, type SummaryRequestKey } from "./cache-key.ts";
import { createSummaryCache } from "./cache.ts";
import { densityFor, densitySuffices, DENSITY_STEPS } from "./density.ts";
import { createSummaryEngine } from "./engine.ts";
import { choosePath, decimate, decodeRanges, FALLBACK_DENSITY_FACTOR } from "./extraction.ts";
import { createMediaPipeline, type SummaryState } from "./pipeline.ts";
import {
	isPostable,
	type SummaryMessage,
	type SummaryRequest,
	type SummaryWorker,
} from "./protocol.ts";

const FULL: EnvironmentCapabilities = {
	dom: true,
	worker: true,
	webCodecs: true,
	audioDecoding: true,
};
const NO_CODECS: EnvironmentCapabilities = { ...FULL, webCodecs: false };
const NO_WORKER: EnvironmentCapabilities = { ...FULL, worker: false };

function key(overrides: Partial<SummaryRequestKey> = {}): SummaryRequestKey {
	return {
		assetId: "asset-1",
		kind: "waveform",
		density: 50,
		sourceStart: 0,
		sourceEnd: 30_000,
		...overrides,
	};
}

/** A worker that answers when the test says so, and records what it was told. */
function scriptedWorker(): SummaryWorker & {
	posted: SummaryRequest[];
	cancelled: string[];
	answer(requestId: string, message: Partial<SummaryMessage>): void;
} {
	const posted: SummaryRequest[] = [];
	const cancelled: string[] = [];
	let listener: ((message: SummaryMessage) => void) | undefined;
	return {
		posted,
		cancelled,
		post: (request) => posted.push(request),
		cancel: (message) => cancelled.push(message.requestId),
		subscribe(next) {
			listener = next;
			return () => {
				listener = undefined;
			};
		},
		answer(requestId, message) {
			const request = posted.find((candidate) => candidate.requestId === requestId)!;
			const base: SummaryRequestKey = {
				assetId: request.assetId,
				kind: request.kind,
				density: request.density,
				sourceStart: request.sourceStart,
				sourceEnd: request.sourceEnd,
			};
			listener?.({
				type: "result",
				requestId,
				key: base,
				payload: { kind: request.kind, buckets: [0.5, 0.9] },
				path: "audio-decode",
				achievedDensity: request.density,
				degraded: false,
				...message,
			} as SummaryMessage);
		},
	};
}

/* ---- 10.1 The worker contract ---------------------------------------------- */

describe("worker contract", () => {
	test("every message crossing the boundary is data all the way down", () => {
		const worker = scriptedWorker();
		const pipeline = createMediaPipeline({ worker, capabilities: FULL });
		pipeline.request({ ...key(), source: "https://example.test/a.wav" });

		const request = worker.posted[0]!;
		expect(isPostable(request)).toBe(true);
		/* And the predicate can say no, or the assertion above is empty. */
		expect(isPostable({ onDone: () => undefined })).toBe(false);
		expect(isPostable({ nested: [{ ok: 1 }, "two", null] })).toBe(true);
	});

	test("a request, its result, its cancellation, and its failure all round-trip", async () => {
		const engine = createSummaryEngine({
			capabilities: FULL,
			decodeAudioRange: async () => [0.1, 0.9, 0.4],
			ticksPerRange: 30_000,
		});
		const request: SummaryRequest = { ...key(), requestId: "r1", source: "a.wav" };

		const result = await engine.run(request);
		expect(result.type).toBe("result");
		expect(isPostable(result)).toBe(true);

		engine.cancel("r2");
		const cancelledResult = await engine.run({ ...request, requestId: "r2" });
		expect(cancelledResult.type).toBe("failure");
		if (cancelledResult.type !== "failure") throw new Error("expected a failure");
		expect(cancelledResult.reason).toMatch(/cancelled/);

		const broken = createSummaryEngine({
			capabilities: FULL,
			decodeAudioRange: async () => {
				throw new Error("bad header");
			},
		});
		const failed = await broken.run({ ...request, requestId: "r3" });
		expect(failed.type).toBe("failure");
		if (failed.type !== "failure") throw new Error("expected a failure");
		/* A failure is a message rather than a throw: a request that never answers
		 * leaves the item pending forever with no state to render. */
		expect(failed.retryable).toBe(true);
		expect(failed.reason).toMatch(/bad header/);
	});
});

/* ---- 10.2 Waveforms off the main thread ------------------------------------ */

describe("waveform summarisation", () => {
	test("a long asset summarises without the main thread decoding anything", () => {
		const worker = scriptedWorker();
		const pipeline = createMediaPipeline({ worker, capabilities: FULL });

		/* Ten minutes of source at 30000 ticks per second. */
		const long = key({ sourceEnd: 30_000 * 600, density: 50 });
		const state = pipeline.request({ ...long, source: "long.wav" });
		expect(state.status).toBe("pending");

		/* The main thread did no work, and structurally cannot: the pipeline is
		 * handed a worker and no decoder at all, so the only thing that ran on this
		 * thread was the equivalent of a `postMessage`. Ten minutes of source
		 * produced exactly one message and zero samples here. */
		expect(worker.posted.length).toBe(1);
		expect(worker.posted[0]!.sourceEnd - worker.posted[0]!.sourceStart).toBe(30_000 * 600);
		expect(Object.keys(pipeline)).not.toContain("decode");

		worker.answer(worker.posted[0]!.requestId, {});
		expect(pipeline.stateOf(long).status).toBe("ready");
	});

	test("decoding happens in ranges, so peak memory follows the range not the asset", async () => {
		const decoded: Array<{ start: number; end: number }> = [];
		let liveSamples = 0;
		let peakSamples = 0;
		const engine = createSummaryEngine({
			capabilities: FULL,
			ticksPerRange: 30_000,
			decodeAudioRange: async (_source, start, end) => {
				decoded.push({ start, end });
				const samples = Array.from({ length: 44_100 }, (_, index) => Math.sin(index));
				liveSamples = samples.length;
				peakSamples = Math.max(peakSamples, liveSamples);
				return samples;
			},
		});

		const short = await engine.run({
			...key({ sourceEnd: 30_000 * 10 }),
			requestId: "short",
			source: "a.wav",
		});
		const shortPeak = peakSamples;
		peakSamples = 0;
		const long = await engine.run({
			...key({ sourceEnd: 30_000 * 600 }),
			requestId: "long",
			source: "a.wav",
		});

		expect(decoded.length).toBe(10 + 600);
		/* Sixty times the asset, the same peak: the decoder is handed one range at
		 * a time and never the whole file. */
		expect(peakSamples).toBe(shortPeak);
		if (short.type !== "result" || long.type !== "result") throw new Error("expected results");
		/* And the summary grows with the asset, as a summary should. */
		expect(long.payload.buckets.length).toBeGreaterThan(short.payload.buckets.length);
	}, 20_000); // Allocation check: 610 audio ranges exceed the default timeout under coverage.

	test("decimation reports peaks rather than means", () => {
		/* A quiet passage with one transient. A mean would flatten it into the
		 * band a waveform exists to distinguish from silence. */
		const samples = [0, 0, 0, 1, 0, 0, 0, 0];
		expect(decimate(samples, 2)).toEqual([1, 0]);
		expect(decimate(samples, 8).filter((value) => value === 1).length).toBe(1);
		expect(decimate([], 4)).toEqual([]);
		expect(decimate(samples, 0)).toEqual([]);
	});

	test("decode ranges cover the source exactly once", () => {
		const ranges = decodeRanges(0, 250, 100);
		expect(ranges).toEqual([
			{ start: 0, end: 100 },
			{ start: 100, end: 200 },
			{ start: 200, end: 250 },
		]);
		expect(decodeRanges(10, 10, 100)).toEqual([]);
		expect(decodeRanges(0, 100, 0)).toEqual([]);
	});
});

/* ---- 10.3, 10.4 Filmstrips and the declared fallback ----------------------- */

describe("filmstrip extraction", () => {
	test("WebCodecs is the preferred path and reports itself as undegraded", () => {
		expect(choosePath("filmstrip", 10, FULL)).toMatchObject({
			path: "webcodecs",
			degraded: false,
			maxDensity: 10,
		});
		/* A waveform has one path, so no fallback machinery is exercised and the
		 * result still names the path it took. */
		expect(choosePath("waveform", 50, NO_CODECS)).toMatchObject({
			path: "audio-decode",
			degraded: false,
		});
	});

	test("the fallback is selected only where WebCodecs is absent, and its reduced density is reported", async () => {
		const choice = choosePath("filmstrip", 10, NO_CODECS);
		expect(choice.path).toBe("video-seek");
		expect(choice.degraded).toBe(true);
		expect(choice.maxDensity).toBeCloseTo(10 * FALLBACK_DENSITY_FACTOR, 6);
		expect(choice.reason).toMatch(/WebCodecs is unavailable/);

		const engine = createSummaryEngine({
			capabilities: NO_CODECS,
			extractFrames: async (_source, _start, _end, wanted) =>
				Array.from({ length: wanted }, (_, index) => `frame-${index}`),
			ticksPerRange: 30_000,
		});
		const result = await engine.run({
			...key({ kind: "filmstrip", density: 10, sourceEnd: 30_000 * 4 }),
			requestId: "f1",
			source: "a.mp4",
		});
		if (result.type !== "result") throw new Error("expected a result");

		expect(result.path).toBe("video-seek");
		expect(result.degraded).toBe(true);
		/* The achieved density is reported, not the requested one. Misreporting it
		 * here is exactly the silence the requirement forbids. */
		expect(result.achievedDensity).toBe(1);
		expect(result.achievedDensity).not.toBe(10);
		expect(result.key.density).toBe(1);
	});

	test("a failed extraction leaves the item painted and interactive", () => {
		const worker = scriptedWorker();
		const pipeline = createMediaPipeline({ worker, capabilities: NO_CODECS });
		const filmstrip = key({ kind: "filmstrip", density: 10 });
		pipeline.request({ ...filmstrip, source: "a.mp4" });
		worker.answer(worker.posted[0]!.requestId, {
			type: "failure",
			reason: "no video track",
			retryable: false,
		} as Partial<SummaryMessage>);

		const state = pipeline.stateOf(filmstrip);
		expect(state.status).toBe("failed");
		expect(state.reason).toMatch(/no video track/);
		/* "Painted and interactive" is a claim about the paint layer, which reads
		 * this state and finds a defined answer rather than a thrown error or a
		 * request that never resolves. */
		expect(state.payload).toBeUndefined();
	});

	test("a density change requests work only for the region asked about", () => {
		const worker = scriptedWorker();
		const pipeline = createMediaPipeline({ worker, capabilities: FULL });
		const visible = key({ kind: "filmstrip", density: 5, sourceStart: 0, sourceEnd: 30_000 });
		const offscreen = key({
			kind: "filmstrip",
			density: 5,
			sourceStart: 300_000,
			sourceEnd: 330_000,
		});
		pipeline.request({ ...visible, source: "a.mp4" });

		pipeline.request({ ...visible, density: 25, source: "a.mp4" });
		/* Two requests, both for the visible range, and none for the region that
		 * was never asked about. */
		expect(worker.posted.length).toBe(2);
		for (const request of worker.posted) expect(request.sourceStart).toBe(visible.sourceStart);
		expect(pipeline.stateOf(offscreen).status).toBe("missing");
	});
});

/* ---- 10.5 Density selection ------------------------------------------------ */

describe("density", () => {
	test("density comes from the pixels available and quantises up the ladder", () => {
		/* 400px over 4 seconds wants 100 buckets per second, which is on the
		 * ladder; 401px wants a shade more and takes the next step up rather than
		 * rounding down to something too coarse to draw. */
		expect(densityFor({ widthPx: 400, durationSeconds: 4, kind: "waveform" })).toBe(100);
		expect(densityFor({ widthPx: 404, durationSeconds: 4, kind: "waveform" })).toBe(250);
		/* Whatever the geometry, the answer is always a rung of the ladder, so
		 * nearby zooms share a cache entry instead of inventing a density each. */
		const ladder: readonly number[] = DENSITY_STEPS;
		for (const step of DENSITY_STEPS)
			expect(ladder).toContain(
				densityFor({ widthPx: 100, durationSeconds: step, kind: "waveform" }),
			);
		/* A filmstrip wants a thumbnail every few pixels, not one per pixel. */
		expect(densityFor({ widthPx: 600, durationSeconds: 10, kind: "filmstrip" })).toBeLessThan(
			densityFor({ widthPx: 600, durationSeconds: 10, kind: "waveform" }),
		);
	});

	test("zooming out issues no new request, because the summary in hand already exceeds what is needed", () => {
		const worker = scriptedWorker();
		const pipeline = createMediaPipeline({ worker, capabilities: FULL });
		const fine = key({ density: 100 });
		pipeline.request({ ...fine, source: "a.wav" });
		worker.answer(worker.posted[0]!.requestId, {});
		expect(pipeline.stateOf(fine).status).toBe("ready");

		const coarse = key({ density: 25 });
		const state = pipeline.request({ ...coarse, source: "a.wav" });
		expect(state.status).toBe("ready");
		/* Still one request, made for the finer density. The zoom-out cost
		 * nothing. */
		expect(worker.posted.length).toBe(1);
		expect(densitySuffices(100, 25)).toBe(true);
		expect(densitySuffices(25, 100)).toBe(false);
	});

	test("zooming past the step the summary was produced at asks again", () => {
		const worker = scriptedWorker();
		const pipeline = createMediaPipeline({ worker, capabilities: FULL });
		pipeline.request({ ...key({ density: 25 }), source: "a.wav" });
		worker.answer(worker.posted[0]!.requestId, {});
		pipeline.request({ ...key({ density: 100 }), source: "a.wav" });
		expect(worker.posted.length).toBe(2);
	});
});

/* ---- 10.6 The cache -------------------------------------------------------- */

describe("summary cache", () => {
	test("revisiting an item serves from cache with no new decode", () => {
		const worker = scriptedWorker();
		const pipeline = createMediaPipeline({ worker, capabilities: FULL });
		const wanted = key();
		pipeline.request({ ...wanted, source: "a.wav" });
		worker.answer(worker.posted[0]!.requestId, {});

		/* Off screen and back: same asset, same range, same zoom. */
		pipeline.retain([]);
		const again = pipeline.request({ ...wanted, source: "a.wav" });
		expect(again.status).toBe("ready");
		expect(worker.posted.length).toBe(1);
	});

	test("the bound is never exceeded, and the least recently used entry goes first", () => {
		const cache = createSummaryCache({ maxBuckets: 10 });
		const entry = (assetId: string, buckets: number) => ({
			key: key({ assetId }),
			payload: { kind: "waveform" as const, buckets: Array.from({ length: buckets }, () => 0.5) },
			achievedDensity: 50,
		});

		cache.set(entry("a", 4));
		cache.set(entry("b", 4));
		expect(cache.size()).toBe(8);

		/* `a` is read, so `b` becomes the least recently used one. */
		expect(cache.get(key({ assetId: "a" }))).toBeDefined();
		cache.set(entry("c", 4));

		expect(cache.size()).toBeLessThanOrEqual(10);
		expect(cache.keys().some((cached) => cached.includes(" b "))).toBe(false);
		expect(cache.get(key({ assetId: "a" }))).toBeDefined();
		expect(cache.get(key({ assetId: "c" }))).toBeDefined();
	});

	test("the bound is in buckets, so one expensive entry does not evict a hundred cheap ones by count", () => {
		const cache = createSummaryCache({ maxBuckets: 100 });
		cache.set({
			key: key({ assetId: "huge", density: 1000 }),
			payload: { kind: "waveform", buckets: Array.from({ length: 90 }, () => 1) },
			achievedDensity: 1000,
		});
		for (let index = 0; index < 5; index += 1) {
			cache.set({
				key: key({ assetId: `small-${index}` }),
				payload: { kind: "waveform", buckets: [1, 2, 3, 4] },
				achievedDensity: 50,
			});
		}
		expect(cache.size()).toBeLessThanOrEqual(100);
		/* The huge one was evicted to make room, and evicting that ONE entry freed
		 * the space of twenty-two small ones — which is why the bound counts
		 * buckets and not entries. */
		expect(cache.get(key({ assetId: "huge", density: 1000 }))).toBeUndefined();
		expect(cache.count()).toBe(5);
	});

	test("the key distinguishes what has to be distinguished", () => {
		const base = key();
		expect(summaryCacheKey(base)).not.toBe(summaryCacheKey(key({ sourceStart: 500 })));
		expect(summaryCacheKey(base)).not.toBe(summaryCacheKey(key({ density: 100 })));
		expect(summaryCacheKey(base)).not.toBe(summaryCacheKey(key({ kind: "filmstrip" })));
		expect(summaryCacheKey(base)).toBe(summaryCacheKey(key()));
	});
});

/* ---- 10.7 Cancellation ----------------------------------------------------- */

describe("cancellation", () => {
	test("a fast scroll cancels the requests it passed rather than completing them", () => {
		const worker = scriptedWorker();
		const pipeline = createMediaPipeline({ worker, capabilities: FULL });
		const passed = [0, 1, 2, 3, 4].map((index) => key({ assetId: `clip-${index}` }));
		for (const item of passed) pipeline.request({ ...item, source: "a.wav" });
		expect(pipeline.inFlight().length).toBe(5);

		/* The scroll stopped somewhere else: only the last item is still wanted. */
		const cancelled = pipeline.retain([passed[4]!]);
		expect(cancelled).toBe(4);
		expect(pipeline.inFlight()).toEqual([summaryCacheKey(passed[4]!)]);
		expect(worker.cancelled.length).toBe(4);
		/* And the ones dropped are back to `missing`, not `failed`: nothing went
		 * wrong, the timeline stopped wanting them. */
		expect(pipeline.stateOf(passed[0]!).status).toBe("missing");
	});

	test("a result for a cancelled request is discarded and paints nothing", () => {
		const changes: SummaryState[] = [];
		const worker = scriptedWorker();
		const pipeline = createMediaPipeline({
			worker,
			capabilities: FULL,
			onChange: (_key, state) => changes.push(state),
		});
		const wanted = key();
		pipeline.request({ ...wanted, source: "a.wav" });
		const requestId = worker.posted[0]!.requestId;
		pipeline.cancel(wanted);

		const before = changes.length;
		worker.answer(requestId, {});
		expect(changes.length).toBe(before);
		expect(pipeline.stateOf(wanted).status).toBe("missing");
	});

	test("the engine stops between ranges rather than at the start only", async () => {
		let ranges = 0;
		const engine = createSummaryEngine({
			capabilities: FULL,
			ticksPerRange: 30_000,
			decodeAudioRange: async () => {
				ranges += 1;
				if (ranges === 2) engine.cancel("long");
				return [0.5];
			},
		});
		const message = await engine.run({
			...key({ sourceEnd: 30_000 * 600 }),
			requestId: "long",
			source: "a.wav",
		});

		expect(message.type).toBe("failure");
		/* Three ranges of six hundred: the cancellation landed almost immediately,
		 * which is the whole point of checking between ranges rather than once. */
		expect(ranges).toBeLessThan(5);
	});

	test("dispose cancels everything outstanding", () => {
		const worker = scriptedWorker();
		const pipeline = createMediaPipeline({ worker, capabilities: FULL });
		pipeline.request({ ...key(), source: "a.wav" });
		pipeline.dispose();
		expect(pipeline.inFlight()).toEqual([]);
		expect(worker.cancelled.length).toBe(1);
	});
});

/* ---- 10.8 Degradation ------------------------------------------------------ */

describe("degradation", () => {
	test("all four states are defined, and none of them is an error the caller must handle", () => {
		const worker = scriptedWorker();
		const pipeline = createMediaPipeline({ worker, capabilities: FULL });

		/* No summary asked for. */
		expect(pipeline.stateOf(key({ assetId: "never-asked" })).status).toBe("missing");

		/* In flight. */
		const pending = key({ assetId: "pending" });
		expect(pipeline.request({ ...pending, source: "a.wav" }).status).toBe("pending");

		/* Failed. */
		const failing = key({ assetId: "failing" });
		pipeline.request({ ...failing, source: "a.wav" });
		const failingId = worker.posted.find((request) => request.assetId === "failing")!.requestId;
		worker.answer(failingId, {
			type: "failure",
			reason: "decode failed",
			retryable: true,
		} as Partial<SummaryMessage>);
		expect(pipeline.stateOf(failing).status).toBe("failed");

		/* Ready. */
		const pendingId = worker.posted.find((request) => request.assetId === "pending")!.requestId;
		worker.answer(pendingId, {});
		expect(pipeline.stateOf(pending).status).toBe("ready");
	});

	test("a late summary reports only that item, so only its region repaints", () => {
		const changed: string[] = [];
		const worker = scriptedWorker();
		const pipeline = createMediaPipeline({
			worker,
			capabilities: FULL,
			onChange: (changedKey, state) => {
				if (state.status === "ready") changed.push(changedKey.assetId);
			},
		});
		for (const assetId of ["a", "b", "c"])
			pipeline.request({ ...key({ assetId }), source: `${assetId}.wav` });
		worker.answer(worker.posted[1]!.requestId, {});

		/* One item named, so the host invalidates one region. A pipeline that
		 * announced "summaries changed" would repaint the timeline. */
		expect(changed).toEqual(["b"]);
	});
});

/* ---- 10.9 The no-worker path ----------------------------------------------- */

describe("no worker", () => {
	test("the summary is reported unavailable rather than decoded on the main thread", () => {
		const pipeline = createMediaPipeline({ capabilities: NO_WORKER });
		const state = pipeline.request({ ...key(), source: "a.wav" });

		expect(state.status).toBe("unavailable");
		expect(state.reason).toMatch(/no worker/);
		/* Nothing is in flight and nothing will arrive: the timeline paints the
		 * item without its summary and stays interactive. */
		expect(pipeline.inFlight()).toEqual([]);
	});

	test("a worker present but declared unavailable is still not used", () => {
		const worker = scriptedWorker();
		const pipeline = createMediaPipeline({ worker, capabilities: NO_WORKER });
		expect(pipeline.request({ ...key(), source: "a.wav" }).status).toBe("unavailable");
		/* The capability is the authority, not the presence of an object: an
		 * environment that reports no worker support does not get one used on it. */
		expect(worker.posted).toEqual([]);
	});
});
