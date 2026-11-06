import { PREVIEW_AUDIO_WORKER_URL } from "./script-urls.ts";
import {
	audioDecodeRequest,
	audioDecodeReply,
	type AudioWindowMetadata,
} from "@models/timeline/preview-audio-protocol.ts";
import { openDecoderLeases } from "./decoder-leases.ts";
export interface PcmReservations {
	reserve(bytes: number): bigint;
	release(lease: bigint): void;
}
export interface DecodedAudioWindow {
	metadata: AudioWindowMetadata;
	pcm: Float32Array<ArrayBuffer>;
	/** Release only after every retained/transfer/WASM copy has been dropped. */
	release(): void;
}
export interface LocalAudioSource {
	id: string;
	revision: string;
	file: File;
	/** Validated source length; skips a duration scan that can read the whole file. */
	frames?: number;
}
/** The lookahead horizon: a source with no window request for this long gives up its decoder. */
export const AUDIO_IDLE_STOP_MS = 2000;
interface Job {
	start: number;
	end: number;
	signal?: AbortSignal;
	cancelled: boolean;
	abort(): void;
	reservation?: bigint;
	reserved?: AudioWindowMetadata;
	resolve(window: DecodedAudioWindow): void;
	reject(error: unknown): void;
}
const cancelled = () => new DOMException("Audio request cancelled", "AbortError");

/**
 * One audio source revision. The worker and its parsed container are held across windows while
 * the decoder grant is held; it stops on yield (between windows), idle, failure or disposal.
 */
export function createAudioSourceClient(
	source: LocalAudioSource,
	budget: PcmReservations,
	options: {
		workerUrl?: string;
		openDecoders?: typeof openDecoderLeases;
		idleMs?: number;
	} = {},
) {
	let worker: Worker | undefined,
		permit: number | undefined,
		awaitingGrant = false,
		yielding = false,
		closed = false,
		earlyYield: number | undefined,
		idle: ReturnType<typeof setTimeout> | undefined,
		busy: Job | undefined;
	const queue: Job[] = [];
	const decoders = (options.openDecoders ?? openDecoderLeases)((lease) => {
		if (permit === undefined) {
			if (awaitingGrant) earlyYield = lease;
			return;
		}
		if (permit !== lease) return;
		yielding = true;
		if (!busy) stop();
	});
	function settle(job: Job) {
		job.signal?.removeEventListener("abort", job.abort);
		if (job.reservation !== undefined) budget.release(job.reservation);
		job.reservation = undefined;
	}
	function cancel(job: Job) {
		if (job.cancelled) return;
		job.cancelled = true;
		const index = queue.indexOf(job);
		if (index >= 0) queue.splice(index, 1);
		// An in-flight window keeps the worker and its late reply is dropped; its PCM returns now.
		settle(job);
		job.reject(cancelled());
		if (!busy && !queue.length) arm();
	}
	/** Terminating the worker ends its Input, codec and AudioData before the grant returns. */
	function stop() {
		if (idle !== undefined) clearTimeout(idle);
		idle = undefined;
		worker?.terminate();
		worker = undefined;
		if (busy) {
			settle(busy);
			if (!busy.cancelled) busy.reject(new Error("Audio decoder stopped"));
			busy = undefined;
		}
		if (permit !== undefined) decoders.release(permit);
		permit = undefined;
		yielding = false;
		if (closed) decoders.close();
		else pump();
	}
	function arm() {
		if (idle !== undefined) clearTimeout(idle);
		idle = undefined;
		if (worker && !busy && !queue.length && !closed)
			idle = setTimeout(stop, options.idleMs ?? AUDIO_IDLE_STOP_MS);
	}
	function fail(job: Job, error: unknown) {
		busy = undefined;
		settle(job);
		if (!job.cancelled) job.reject(error);
	}
	function pump() {
		if (closed || busy || !queue.length) return;
		if (idle !== undefined) clearTimeout(idle);
		idle = undefined;
		if (permit === undefined) {
			if (awaitingGrant) return;
			awaitingGrant = true;
			void decoders.request("audio").then(
				(lease) => {
					awaitingGrant = false;
					if (closed) {
						decoders.release(lease);
						return;
					}
					permit = lease;
					yielding = earlyYield === lease;
					earlyYield = undefined;
					pump();
				},
				(error: unknown) => {
					awaitingGrant = false;
					for (const job of queue.splice(0)) fail(job, error);
				},
			);
			return;
		}
		if (!worker) {
			try {
				worker = start();
			} catch (error) {
				for (const job of queue.splice(0)) fail(job, error);
				stop();
				return;
			}
		}
		const job = queue.shift()!;
		busy = job;
		worker.postMessage({
			sourceId: source.id,
			revision: source.revision,
			file: source.file,
			start: job.start,
			end: job.end,
			...(source.frames === undefined ? {} : { frames: source.frames }),
		});
	}
	function start(): Worker {
		const node = new Worker(options.workerUrl ?? PREVIEW_AUDIO_WORKER_URL);
		node.onerror = () => {
			if (worker !== node) return;
			if (busy) fail(busy, new Error("Audio decoder worker failed"));
			stop();
		};
		node.onmessage = (event: MessageEvent<unknown>) => {
			if (worker !== node || !busy) return;
			const job = busy;
			try {
				const message = audioDecodeReply.parse(event.data);
				if (message.type === "failed") throw new Error(message.message);
				const metadata = message.metadata;
				if (metadata.sourceId !== source.id || metadata.revision !== source.revision)
					throw new Error("Decoded audio source revision mismatch");
				if (message.type === "reserve") {
					if (job.reserved) throw new Error("Duplicate audio PCM reservation");
					job.reserved = metadata;
					if (job.cancelled) {
						node.postMessage({ accepted: false });
						return;
					}
					// Retained window, flattened input and WASM input. Caller separately reserves output copies.
					job.reservation = budget.reserve(metadata.count * metadata.channels * 4 * 3);
					node.postMessage({ accepted: true });
					return;
				}
				if (
					JSON.stringify(metadata) !== JSON.stringify(job.reserved) ||
					message.pcm.length !== metadata.count * metadata.channels ||
					!(message.pcm.buffer instanceof ArrayBuffer)
				)
					throw new Error("Decoded PCM does not match its reservation");
				busy = undefined;
				const pcm = new Float32Array(
					message.pcm.buffer,
					message.pcm.byteOffset,
					message.pcm.length,
				);
				if (job.cancelled || job.reservation === undefined) {
					structuredClone(pcm.buffer, { transfer: [pcm.buffer] });
				} else {
					const lease = job.reservation;
					job.reservation = undefined;
					job.signal?.removeEventListener("abort", job.abort);
					let released = false;
					job.resolve({
						metadata,
						pcm,
						release() {
							if (!released) {
								released = true;
								structuredClone(pcm.buffer, { transfer: [pcm.buffer] });
								budget.release(lease);
							}
						},
					});
				}
				if (yielding) stop();
				else if (queue.length) pump();
				else arm();
			} catch (error) {
				if (job.cancelled) {
					// The refused reservation of a cancelled window: the held source stays usable.
					busy = undefined;
					if (yielding) stop();
					else if (queue.length) pump();
					else arm();
					return;
				}
				// A failed window may leave the parsed source unusable: start fresh for the next one.
				fail(job, error);
				stop();
			}
		};
		return node;
	}
	return {
		source,
		/** Decode one bounded source interval; windows run one at a time in request order. */
		decode(start: number, end: number, signal?: AbortSignal): Promise<DecodedAudioWindow> {
			if (closed || signal?.aborted) return Promise.reject(cancelled());
			const checked = audioDecodeRequest.safeParse({
				sourceId: source.id,
				revision: source.revision,
				file: source.file,
				start,
				end,
			});
			if (!checked.success) return Promise.reject(new Error("Invalid audio window request"));
			return new Promise<DecodedAudioWindow>((resolve, reject) => {
				const job: Job = {
					start,
					end,
					signal,
					cancelled: false,
					abort: () => cancel(job),
					resolve,
					reject,
				};
				queue.push(job);
				signal?.addEventListener("abort", job.abort, { once: true });
				pump();
			});
		},
		dispose() {
			if (closed) return;
			closed = true;
			for (const job of [...queue, ...(busy ? [busy] : [])]) cancel(job);
			stop();
		},
	};
}
