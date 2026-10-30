import { PREVIEW_AUDIO_WORKER_URL } from "./script-urls.ts";
import {
	audioDecodeRequest,
	audioDecodeReply,
	type AudioDecodeRequest,
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
/** Decode a bounded source interval. Each job closes its codec before returning its grant. */
export async function decodeLocalAudio(
	request: AudioDecodeRequest,
	budget: PcmReservations,
	options: {
		signal?: AbortSignal;
		workerUrl?: string;
		openDecoders?: typeof openDecoderLeases;
	} = {},
): Promise<DecodedAudioWindow> {
	audioDecodeRequest.parse(request);
	const decoders = (options.openDecoders ?? openDecoderLeases)();
	let worker: Worker | undefined, reservation: bigint | undefined;
	let reservedMetadata: AudioWindowMetadata | undefined;
	const signal = options.signal;
	let abort: (() => void) | undefined;
	try {
		if (signal?.aborted) throw new DOMException("Audio request cancelled", "AbortError");
		// Closing the owner also rejects a queued grant when abort occurs before worker creation.
		abort = () => decoders.close();
		signal?.addEventListener("abort", abort, { once: true });
		await decoders.request("audio");
		signal?.removeEventListener("abort", abort);
		if (signal?.aborted) throw new DOMException("Audio request cancelled", "AbortError");
		const node = new Worker(options.workerUrl ?? PREVIEW_AUDIO_WORKER_URL);
		worker = node;
		const result = await new Promise<DecodedAudioWindow>((resolve, reject) => {
			abort = () => reject(new DOMException("Audio request cancelled", "AbortError"));
			signal?.addEventListener("abort", abort, { once: true });
			node.onerror = () => reject(new Error("Audio decoder worker failed"));
			node.onmessage = (event: MessageEvent<unknown>) => {
				try {
					const message = audioDecodeReply.parse(event.data);
					if (message.type === "failed") throw new Error(message.message);
					const metadata = message.metadata;
					if (metadata.sourceId !== request.sourceId || metadata.revision !== request.revision)
						throw new Error("Decoded audio source revision mismatch");
					if (message.type === "reserve") {
						if (reservation !== undefined) throw new Error("Duplicate audio PCM reservation");
						// Retained window, flattened input and WASM input. Caller separately reserves output copies.
						reservation = budget.reserve(metadata.count * metadata.channels * 4 * 3);
						reservedMetadata = metadata;
						node.postMessage({ accepted: true });
						return;
					}
					if (
						reservation === undefined ||
						JSON.stringify(metadata) !== JSON.stringify(reservedMetadata) ||
						message.pcm.length !== metadata.count * metadata.channels ||
						!(message.pcm.buffer instanceof ArrayBuffer)
					)
						throw new Error("Decoded PCM does not match its reservation");
					const lease = reservation;
					let released = false;
					resolve({
						metadata,
						pcm: new Float32Array(message.pcm.buffer, message.pcm.byteOffset, message.pcm.length),
						release() {
							if (!released) {
								released = true;
								structuredClone(message.pcm.buffer, { transfer: [message.pcm.buffer] });
								budget.release(lease);
							}
						},
					});
				} catch (error) {
					reject(error);
				}
			};
			node.postMessage(request);
		});
		reservation = undefined;
		return result;
	} catch (error) {
		if (signal?.aborted) throw new DOMException("Audio request cancelled", "AbortError");
		throw error;
	} finally {
		if (abort) signal?.removeEventListener("abort", abort);
		worker?.terminate();
		decoders.close();
		if (reservation !== undefined) budget.release(reservation);
	}
}
