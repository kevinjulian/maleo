import { PREVIEW_VIDEO_WORKER_URL } from "./script-urls.ts";
import { openDecoderLeases } from "./decoder-leases.ts";
import {
	videoReplySchema,
	type DecodedVideoFrame,
	type LocalVideoSource,
	type VideoLease,
} from "@models/timeline/preview-video-protocol.ts";
interface Job {
	requestId: number;
	lease: VideoLease;
	resolve(frame: DecodedVideoFrame): void;
	reject(error: Error): void;
}
const cancelled = () => new DOMException("Video request cancelled", "AbortError");

/** One logical placement. Worker creation and codec allocation both follow the native grant. */
export function createVideoFrameClient(
	source: LocalVideoSource,
	options: {
		reserve(lease: VideoLease, width: number, height: number, bytes: number): Promise<void> | void;
		openDecoders?: typeof openDecoderLeases;
		workerUrl?: string;
	},
) {
	let worker: Worker | undefined,
		permit: number | undefined,
		awaitingGrant = false,
		ready = false,
		closed = false,
		yielding = false,
		served = false;
	let earlyYield: number | undefined;
	// One decoder serves a placement and its prefetch: each consumer keeps its own newest request.
	let busy: Job | undefined,
		nextRequestId = 0,
		failure: Error | undefined;
	const queued = new Map<string, Job>(),
		latest = new Map<string, VideoLease["request"]>();
	let closing: Promise<void> | undefined, finishClosing: (() => void) | undefined;
	const decoders = (options.openDecoders ?? openDecoderLeases)((lease) => {
		if (permit === undefined) {
			if (awaitingGrant) earlyYield = lease;
			return;
		}
		if (permit !== lease) return;
		yielding = true;
		if (served && !busy) void stop();
	});
	function isNewest(job: Job) {
		const newest = latest.get(job.lease.request.consumer);
		return (
			newest?.generation === job.lease.request.generation &&
			newest?.sequence === job.lease.request.sequence
		);
	}
	function rejectJobs(error: Error) {
		busy?.reject(error);
		for (const job of queued.values()) job.reject(error);
		busy = undefined;
		queued.clear();
	}
	function terminated(node: Worker) {
		node.terminate();
		if (worker !== node) return;
		worker = undefined;
		ready = false;
		if (permit !== undefined) decoders.release(permit);
		permit = undefined;
		closing = undefined;
		finishClosing?.();
		finishClosing = undefined;
		if (closed) decoders.close();
		else if (queued.size && !failure) pump();
	}
	function fail(error: Error) {
		failure = error;
		rejectJobs(error);
		if (worker) terminated(worker);
		else if (permit !== undefined) decoders.release(permit);
		permit = undefined;
		decoders.close();
	}
	function post(node: Worker, message: unknown) {
		try {
			node.postMessage(message);
		} catch (error) {
			fail(error instanceof Error ? error : new Error("Video worker message failed"));
		}
	}
	function stop(): Promise<void> {
		if (closing) return closing;
		if (!worker) {
			if (closed) decoders.close();
			return Promise.resolve();
		}
		closing = new Promise<void>((resolve) => {
			finishClosing = resolve;
		});
		const result = closing;
		post(worker, { type: "dispose" });
		return result;
	}
	function pump() {
		if (closed || closing || busy || !queued.size) return;
		if (permit === undefined) {
			if (awaitingGrant) return;
			awaitingGrant = true;
			void decoders.request("video", source.metadata.slots).then(
				(lease) => {
					awaitingGrant = false;
					if (closed) {
						decoders.release(lease);
						return;
					}
					permit = lease;
					served = false;
					// A busy broker can request yield before the grant Promise callback runs.
					yielding = earlyYield === lease;
					earlyYield = undefined;
					start();
				},
				(error) => {
					awaitingGrant = false;
					if (!closed)
						fail(error instanceof Error ? error : new Error("Video decoder lease failed"));
				},
			);
			return;
		}
		if (!worker) start();
		if (!ready || !worker) return;
		// The earliest time first: the frame on screen outranks frames decoded ahead of it.
		const next = [...queued.values()].reduce((a, b) =>
			b.lease.request.time < a.lease.request.time ? b : a,
		);
		queued.delete(next.lease.request.consumer);
		busy = next;
		post(worker, { type: "frame", requestId: busy.requestId, lease: busy.lease });
	}
	function start() {
		if (worker || closed || failure || permit === undefined) return;
		let node: Worker;
		try {
			node = new Worker(options.workerUrl ?? PREVIEW_VIDEO_WORKER_URL);
		} catch (error) {
			fail(error instanceof Error ? error : new Error("Video worker could not start"));
			return;
		}
		worker = node;
		ready = false;
		node.onerror = () => fail(new Error("Video decoder worker failed"));
		node.onmessage = (event: MessageEvent<unknown>) => {
			if (worker !== node) return;
			const parsed = videoReplySchema.safeParse(event.data);
			if (!parsed.success) {
				fail(new Error("Invalid video decoder response"));
				return;
			}
			const message = parsed.data;
			if (message.type === "disposed") {
				terminated(node);
				return;
			}
			if (closed) return;
			if (message.type === "fatal") {
				fail(new Error(message.message));
				return;
			}
			if (message.type === "metadata") {
				if (
					source.metadata.width !== message.metadata.width ||
					source.metadata.height !== message.metadata.height ||
					source.metadata.slots !== message.metadata.slots ||
					source.metadata.firstTimestamp !== message.metadata.firstTimestamp
				) {
					fail(new Error("Local video metadata changed without a source revision"));
					return;
				}
				ready = true;
				post(node, { type: "grant", slots: source.metadata.slots });
				pump();
				return;
			}
			const job = busy;
			if (!job || job.requestId !== message.requestId) {
				if (message.type === "reserve")
					post(node, {
						type: "reservation",
						requestId: message.requestId,
						accepted: false,
						message: "Video request cancelled",
						cancelled: true,
					});
				return;
			}
			if (message.type === "reserve") {
				void Promise.resolve()
					.then(() => options.reserve(job.lease, message.width, message.height, message.bytes))
					.then(
						() => {
							if (worker === node)
								post(node, {
									type: "reservation",
									requestId: job.requestId,
									accepted: busy === job && !closed && isNewest(job),
									...(busy === job && !closed && isNewest(job) ? {} : { cancelled: true }),
								});
						},
						(error) => {
							if (worker === node)
								post(node, {
									type: "reservation",
									requestId: job.requestId,
									accepted: false,
									message: error instanceof Error ? error.message : "Video reservation failed",
								});
						},
					);
				return;
			}
			busy = undefined;
			served = true;
			if (message.type === "failed")
				job.reject(message.cancelled ? cancelled() : new Error(message.message));
			else {
				const { pixels, identity } = message;
				const sized =
					pixels instanceof Uint8Array
						? pixels.byteLength === identity.width * identity.height * 4
						: pixels.displayWidth === identity.width && pixels.displayHeight === identity.height;
				const current = isNewest(job);
				if (message.lease === job.lease.id && sized && current) job.resolve(message);
				else {
					// A transferred frame holds decoder memory until closed.
					if (!(pixels instanceof Uint8Array)) pixels.close();
					job.reject(
						message.lease === job.lease.id && sized
							? cancelled()
							: new Error("Decoded video does not match its lease"),
					);
				}
			}
			if (yielding) void stop();
			else pump();
		};
		post(node, { type: "init", source });
	}
	return {
		metadata: source.metadata,
		request(lease: VideoLease): Promise<DecodedVideoFrame> {
			if (closed) return Promise.reject(cancelled());
			if (failure) return Promise.reject(failure);
			const request = lease.request;
			if (request.sourceId !== source.id || request.revision !== source.revision)
				return Promise.reject(new Error("Video source revision mismatch"));
			const newest = latest.get(request.consumer);
			if (
				newest &&
				(request.generation < newest.generation ||
					(request.generation === newest.generation && request.sequence <= newest.sequence))
			)
				return Promise.reject(cancelled());
			latest.set(request.consumer, request);
			queued.get(request.consumer)?.reject(cancelled());
			const result = new Promise<DecodedVideoFrame>((resolve, reject) => {
				queued.set(request.consumer, { lease, resolve, reject, requestId: ++nextRequestId });
			});
			if (
				busy &&
				worker &&
				(request.generation !== busy.lease.request.generation ||
					request.time < busy.lease.request.time)
			)
				post(worker, { type: "cancel" });
			pump();
			return result;
		},
		/** Ends one consumer's work without closing the decoder its siblings share. */
		cancel(consumer: string) {
			queued.get(consumer)?.reject(cancelled());
			queued.delete(consumer);
			latest.delete(consumer);
			if (busy?.lease.request.consumer === consumer && worker) post(worker, { type: "cancel" });
		},
		dispose(): Promise<void> {
			if (!closed) {
				closed = true;
				rejectJobs(cancelled());
			}
			return stop();
		},
	};
}
