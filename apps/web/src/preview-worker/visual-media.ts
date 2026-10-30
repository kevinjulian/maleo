import { PREVIEW_VIDEO_WORKER_URL } from "@services/preview-media/script-urls.ts";
import { z } from "zod";
import type { PreviewMediaBinding } from "@models/timeline/preview-protocol.ts";
import {
	frameIdentitySchema,
	visualLeaseSchema,
	visualRequestSchema,
	videoLeaseSchema,
	type VisualLease,
} from "@models/timeline/preview-video-protocol.ts";
import { createVideoFrameClient } from "@services/preview-media/video-client.ts";
import type { openDecoderLeases } from "@services/preview-media/decoder-leases.ts";

const positive = z.number().int().positive();
const frameSchema = z.object({ id: positive, identity: frameIdentitySchema, bytes: positive });
const lookupSchema = z.object({ frame: frameSchema.nullable() });
const evictedSchema = z.object({ evicted: z.array(positive) });
const planSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("wait") }),
	z.object({ type: z.literal("start"), lease: visualLeaseSchema, evicted: z.array(positive) }),
	z.object({ type: z.literal("failed"), request: visualRequestSchema, message: z.string() }),
]);
const videoDemandSchema = z.object({
	path: z.string(),
	url: z.string(),
	time: z.number().finite().nullable(),
	blocker: z.string().nullable(),
});
const imageDemandSchema = z.object({ path: z.string(), url: z.string() });
/** A failed decode is retried at most this often while its placement still wants the frame. */
const FAILED_RETRY_MS = 1000;
type VideoDemand = z.infer<typeof videoDemandSchema>;
interface NativePool {
	dispatch(json: string): string;
	free(): void;
}
export interface VisualMediaHost {
	MediaPool: new () => NativePool;
	video_requests(now: number): string;
	next_video_requests(now: number): string;
	image_requests(now: number): string;
	cache_media_frame(id: bigint, identity: string, rgba: Uint8Array): void;
	/** Copies the frame into a GPU texture and closes it, whether or not the copy succeeds. */
	cache_video_frame(id: bigint, identity: string, frame: VideoFrame): void;
	bind_video(request: string, id: bigint): void;
	bind_image(url: string, id: bigint): void;
	remove_media_frame(id: bigint): void;
	remove_video(path: string): void;
}
interface Demand {
	consumer: string;
	source: PreviewMediaBinding;
	time: number;
	video?: VideoDemand;
	prefetch?: boolean;
}
interface Job {
	lease: VisualLease;
	demand: Demand;
	done: Promise<void>;
	stop(): Promise<void>;
}

interface TransferBuffer extends ArrayBuffer {
	transfer(newByteLength: number): ArrayBuffer;
}
function transferable(buffer: ArrayBufferLike): buffer is TransferBuffer {
	return (
		buffer instanceof ArrayBuffer && "transfer" in buffer && typeof buffer.transfer === "function"
	);
}

/** The native pool owns scheduling and byte policy; this adapter owns Files, codecs and copies. */
export function createVisualMedia(
	native: VisualMediaHost,
	openDecoders: typeof openDecoderLeases,
	changed: () => void,
	failed: (path: string, message: string) => void,
) {
	const pool = new native.MediaPool();
	const sources = new Map<string, PreviewMediaBinding>();
	const wanted = new Map<string, Demand>();
	const queued = new Map<string, string>();
	const bound = new Map<string, number>();
	const retainedFrames = new Set<number>();
	const jobs = new Map<number, Job>();
	const clients = new Map<
		string,
		{ url: string; client: ReturnType<typeof createVideoFrameClient> }
	>();
	const scriptAbort = new AbortController();
	let generation = 0,
		sequence = 0,
		closed = false,
		script: Promise<string> | undefined,
		scriptUrl: string | undefined;
	let disposed: Promise<void> | undefined;
	const dispatch = (action: unknown): unknown => JSON.parse(pool.dispatch(JSON.stringify(action)));
	function evict(ids: readonly number[]) {
		for (const id of ids) {
			native.remove_media_frame(BigInt(id));
			retainedFrames.delete(id);
			for (const [consumer, frame] of bound) if (frame === id) bound.delete(consumer);
		}
	}
	function workerUrl() {
		return (script ??= (async () => {
			const response = await fetch(PREVIEW_VIDEO_WORKER_URL, { signal: scriptAbort.signal });
			if (!response.ok) throw new Error("Local video decoder script is unavailable");
			const blob = await response.blob();
			if (closed) throw new DOMException("Preview disposed", "AbortError");
			return (scriptUrl = URL.createObjectURL(blob));
		})().catch((error: unknown) => {
			// A transient failure must not disable video decode until reload.
			script = undefined;
			throw error;
		}));
	}
	function bind(demand: Demand, id: number) {
		if (demand.prefetch) return;
		if (bound.get(demand.consumer) === id) return;
		if (demand.video) native.bind_video(JSON.stringify(demand.video), BigInt(id));
		else native.bind_image(demand.source.url, BigInt(id));
		bound.set(demand.consumer, id);
	}
	function reserve(lease: VisualLease, width: number, height: number, bytes: number) {
		evict(
			evictedSchema.parse(dispatch({ type: "resize", lease: lease.id, width, height, bytes }))
				.evicted,
		);
	}
	function complete(
		job: Job,
		identity: z.infer<typeof frameIdentitySchema>,
		pixels: Uint8Array | VideoFrame,
	) {
		if (pixels instanceof Uint8Array) {
			const buffer = pixels.buffer;
			if (!transferable(buffer)) throw new Error("Transferable RGBA cleanup is unavailable");
			// Upload while the two-copy reservation is held, then detach JS bytes before completion.
			native.cache_media_frame(BigInt(job.lease.id), JSON.stringify(identity), pixels);
			buffer.transfer(0);
		} else native.cache_video_frame(BigInt(job.lease.id), JSON.stringify(identity), pixels);
		let accepted = false;
		try {
			const frame = lookupSchema.parse(
				dispatch({ type: "complete", lease: job.lease.id, identity }),
			).frame;
			if (!frame) return;
			accepted = frame.id === job.lease.id;
			const current = wanted.get(job.demand.consumer);
			if (
				current &&
				current.source.id === identity.sourceId &&
				current.source.revision === identity.revision &&
				identity.start <= current.time &&
				current.time < identity.end
			) {
				bind(current, frame.id);
				retainedFrames.add(frame.id);
				dispatch({ type: "retain", frames: [...retainedFrames] });
			}
		} finally {
			if (!accepted) native.remove_media_frame(BigInt(job.lease.id));
		}
	}
	async function image(job: Job) {
		const bitmap = await createImageBitmap(job.demand.source.file, {
			premultiplyAlpha: "none",
			colorSpaceConversion: "none",
		});
		try {
			if (closed || !sources.has(job.demand.source.url)) return;
			const { width, height } = bitmap;
			reserve(job.lease, width, height, width * height * 8);
			const canvas = new OffscreenCanvas(width, height);
			let rgba: Uint8Array;
			try {
				const context = canvas.getContext("2d", { willReadFrequently: true });
				if (!context) throw new Error("Image RGBA output is unavailable");
				context.drawImage(bitmap, 0, 0);
				rgba = new Uint8Array(context.getImageData(0, 0, width, height).data.buffer);
			} finally {
				canvas.width = canvas.height = 0;
			}
			complete(
				job,
				{
					sourceId: job.lease.request.sourceId,
					revision: job.lease.request.revision,
					start: 0,
					end: 1,
					width,
					height,
				},
				rgba,
			);
		} finally {
			bitmap.close();
		}
	}
	/** A placement and its prefetch share one decoder, so a prefetch never cold-starts a second. */
	function clientKey(demand: Demand) {
		return demand.prefetch ? demand.consumer.slice("prefetch:".length) : demand.consumer;
	}
	async function video(job: Job, cancelled: Promise<never>) {
		const url = await Promise.race([workerUrl(), cancelled]);
		if (closed || !sources.has(job.demand.source.url)) return;
		const source = job.demand.source;
		if (!source.video) throw new Error("Validated local video metadata is missing");
		const key = clientKey(job.demand);
		let held = clients.get(key);
		if (held && held.url !== source.url) {
			await held.client.dispose();
			clients.delete(key);
			held = undefined;
		}
		if (!held) {
			held = {
				url: source.url,
				client: createVideoFrameClient(
					{ id: source.id, revision: source.revision, file: source.file, metadata: source.video },
					{
						openDecoders,
						workerUrl: url,
						reserve,
					},
				),
			};
			clients.set(key, held);
		}
		try {
			const frame = await held.client.request(videoLeaseSchema.parse(job.lease));
			complete(job, frame.identity, frame.pixels);
		} catch (error) {
			// A cancelled request leaves the shared decoder to its sibling; a failure retires it.
			if (!(error instanceof DOMException && error.name === "AbortError")) {
				await held.client.dispose();
				if (clients.get(key) === held) clients.delete(key);
			}
			throw error;
		}
	}
	function start(lease: VisualLease, demand: Demand) {
		let cancel!: (error: Error) => void;
		const cancelled = new Promise<never>((_, reject) => {
			cancel = reject;
		});
		// Images have no cancellable platform decode; their File lease waits for bitmap.close().
		void cancelled.catch(() => {});
		const job: Job = {
			lease,
			demand,
			done: Promise.resolve(),
			stop: async () => {
				cancel(new DOMException("Visual request cancelled", "AbortError"));
				clients.get(clientKey(demand))?.client.cancel(demand.consumer);
			},
		};
		jobs.set(lease.id, job);
		const request = lease.request;
		const key = JSON.stringify([
			request.generation,
			request.sourceId,
			request.revision,
			request.time,
		]);
		// A finished request no longer blocks its own repeat: if the frame is later evicted, left
		// unbound or failed, a paused placement asks again instead of staying "missing media".
		const forget = () => {
			if (queued.get(demand.consumer) === key) queued.delete(demand.consumer);
		};
		let retryAfterMs = 0;
		job.done = (lease.request.kind === "video" ? video(job, cancelled) : image(job))
			.catch((error: unknown) => {
				if (!(error instanceof DOMException && error.name === "AbortError") && !closed) {
					failed(
						demand.consumer,
						error instanceof Error ? error.message : "Local visual decode failed",
					);
					retryAfterMs = FAILED_RETRY_MS;
				}
			})
			.finally(() => {
				dispatch({ type: "release", lease: lease.id });
				jobs.delete(lease.id);
				if (!retryAfterMs) forget();
				else
					setTimeout(() => {
						if (closed) return;
						forget();
						changed();
					}, retryAfterMs);
				changed();
			});
	}
	function invalidate() {
		generation++;
		for (const consumer of queued.keys()) dispatch({ type: "cancel", consumer });
		queued.clear();
		for (const job of jobs.values()) void job.stop();
	}
	return {
		prepare: workerUrl,
		setSources(bindings: readonly PreviewMediaBinding[]) {
			invalidate();
			bound.clear();
			sources.clear();
			for (const source of bindings) sources.set(source.url, source);
		},
		invalidate,
		update(now: number) {
			if (closed) return false;
			let complete = true;
			wanted.clear();
			const images = z.array(imageDemandSchema).parse(JSON.parse(native.image_requests(now)));
			for (const image of images) {
				const source = sources.get(image.url);
				if (source && !source.video)
					wanted.set(image.path, { consumer: image.path, source, time: 0 });
				else complete = false;
			}
			const videos = z.array(videoDemandSchema).parse(JSON.parse(native.video_requests(now)));
			for (const video of videos) {
				const source = sources.get(video.url);
				if (source?.video && video.time !== null && !video.blocker)
					wanted.set(video.path, { consumer: video.path, source, time: video.time, video });
				else {
					complete = false;
					native.remove_video(video.path);
					bound.delete(video.path);
				}
			}
			const next = z.array(videoDemandSchema).parse(JSON.parse(native.next_video_requests(now)));
			for (const video of next) {
				const source = sources.get(video.url);
				if (source?.video && video.time !== null && !video.blocker) {
					const consumer = `prefetch:${video.path}`;
					wanted.set(consumer, { consumer, source, time: video.time, video, prefetch: true });
				}
			}
			for (const consumer of queued.keys())
				if (!wanted.has(consumer)) {
					dispatch({ type: "cancel", consumer });
					queued.delete(consumer);
					bound.delete(consumer);
					native.remove_video(consumer);
				}
			const retained: number[] = [];
			for (const demand of wanted.values()) {
				const metadata = demand.source.video;
				const request = {
					consumer: demand.consumer,
					generation,
					sequence: ++sequence,
					sourceId: demand.source.id,
					revision: demand.source.revision,
					time: demand.time,
					width: metadata?.width ?? 1,
					height: metadata?.height ?? 1,
					kind: demand.video ? "video" : "image",
				};
				const hit = lookupSchema.parse(dispatch({ type: "lookup", request })).frame;
				if (hit) {
					retained.push(hit.id);
					bind(demand, hit.id);
					continue;
				}
				if (!demand.prefetch) complete = false;
				const key = JSON.stringify([generation, request.sourceId, request.revision, request.time]);
				if (queued.get(demand.consumer) === key) continue;
				queued.set(demand.consumer, key);
				dispatch({ type: "enqueue", request });
			}
			retainedFrames.clear();
			for (const id of retained) retainedFrames.add(id);
			dispatch({ type: "retain", frames: retained });
			while (true) {
				const plan = planSchema.parse(dispatch({ type: "acquire" }));
				if (plan.type === "wait") break;
				if (plan.type === "failed") {
					failed(plan.request.consumer, plan.message);
					continue;
				}
				evict(plan.evicted);
				const demand = wanted.get(plan.lease.request.consumer);
				if (!demand) {
					dispatch({ type: "release", lease: plan.lease.id });
					continue;
				}
				start(plan.lease, demand);
			}
			return complete;
		},
		/** After device recovery: texture frames died with the old device, so forget every frame. */
		deviceReplaced() {
			invalidate();
			evict(evictedSchema.parse(dispatch({ type: "clear" })).evicted);
			bound.clear();
			changed();
		},
		async releaseSource(url: string) {
			sources.delete(url);
			const active = [...jobs.values()].filter((job) => job.demand.source.url === url);
			await Promise.all(active.map((job) => job.stop()));
			await Promise.all(active.map((job) => job.done));
			for (const [consumer, held] of clients)
				if (held.url === url) {
					await held.client.dispose();
					clients.delete(consumer);
				}
			invalidate();
			evict(evictedSchema.parse(dispatch({ type: "clear" })).evicted);
			bound.clear();
			changed();
		},
		dispose(): Promise<void> {
			if (disposed) return disposed;
			closed = true;
			scriptAbort.abort();
			invalidate();
			disposed = (async () => {
				await Promise.all([...clients.values()].map(({ client }) => client.dispose()));
				await Promise.all([...jobs.values()].map((job) => job.done));
				clients.clear();
				evict(evictedSchema.parse(dispatch({ type: "clear" })).evicted);
				pool.free();
				if (scriptUrl) URL.revokeObjectURL(scriptUrl);
			})();
			return disposed;
		},
	};
}
