import { PREVIEW_MEDIA_WORKER_URL } from "./script-urls.ts";
import {
	videoMetadataSchema,
	type VideoMetadata,
} from "@models/timeline/preview-video-protocol.ts";
import { openDecoderLeases } from "./decoder-leases.ts";
import { reserveSourceMemory, releaseSourceMemory } from "./source-memory.ts";
import { z } from "zod";
import {
	audioMetadataSchema,
	type AudioMetadata,
} from "@models/timeline/preview-audio-protocol.ts";
import type { PreviewMediaSource } from "@maleo/shared";
import type { DownloadProgress, SourceDownload } from "./source-loader.ts";
import { probeSvgSource } from "./svg-probe.ts";

type Source = Pick<PreviewMediaSource, "id" | "revision" | "url" | "kinds">;
type Identity = Pick<Source, "id" | "revision">;
const identity = { id: z.string(), revision: z.string(), requestId: z.number().int().positive() };
const reply = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("decoder-request"),
		requestId: z.number().int().positive(),
		kind: z.enum(["video", "audio"]),
		slots: z.union([z.literal(1), z.literal(2)]),
	}),
	z.object({ type: z.literal("decoder-release"), lease: z.number().int().positive() }),
	z.object({
		type: z.literal("reserve-memory"),
		reservation: z.number().int().nonnegative(),
		bytes: z.number().int().nonnegative(),
	}),
	z.object({ type: z.literal("release-memory"), bytes: z.number().int().nonnegative() }),
	z.object({
		type: z.literal("progress"),
		...identity,
		loaded: z.number().int().nonnegative(),
		total: z.number().int().nonnegative().nullable(),
	}),
	z.object({
		type: z.literal("complete"),
		...identity,
		file: z.instanceof(File),
		probe: z.object({
			video: videoMetadataSchema.nullable(),
			audio: audioMetadataSchema.nullable(),
		}),
	}),
	z.object({ type: z.literal("validating"), ...identity }),
	z.object({ type: z.literal("svg-bytes"), ...identity, file: z.instanceof(File) }),
	z.object({
		type: z.literal("failed"),
		...identity,
		message: z.string(),
		bytesComplete: z.boolean(),
	}),
	z.object({ type: z.literal("protocol-error"), message: z.string() }),
	z.object({ type: z.literal("disposed") }),
]);

interface Held {
	imageProbe?: AbortController;
	video?: VideoMetadata;
	audio?: AudioMetadata;
	requiresVideo: boolean;
	requiresImage: boolean;
	requestId: number;
	definition: string;
	url: string;
	authorization?: Promise<SourceDownload["target"]>;
	failed: boolean;
	bytesComplete: boolean;
	promise: Promise<File>;
	resolve(file: File): void;
	reject(error: Error): void;
}

/** Main-thread authorization, worker-owned IO. No authored URL is replaced here. */
export function createPreviewSourceClient(options: {
	resolve(source: Source): Promise<SourceDownload["target"]>;
	progress(source: Identity, progress: DownloadProgress): void;
	validating(source: Identity): void;
	failed?(message: string): void;
}) {
	const worker = new Worker(PREVIEW_MEDIA_WORKER_URL);
	const memoryOwner = Symbol();
	const decoders = openDecoderLeases((lease) =>
		worker.postMessage({ type: "yield-decoder", lease }),
	);
	function stop() {
		worker.terminate();
		releaseSourceMemory(memoryOwner);
		decoders.close();
	}
	const held = new Map<string, Held>();
	const imageProbes = new Set<Promise<void>>();
	let disposed = false;
	let nextRequestId = 0;
	let closed: Promise<void> | undefined;
	let finish: (error?: Error) => void = () => {};
	const keyOf = (source: Identity) => JSON.stringify([source.id, source.revision]);
	function failAll(message: string): void {
		for (const entry of held.values()) {
			entry.imageProbe?.abort();
			entry.reject(new Error(message));
		}
		held.clear();
	}
	worker.onerror = () => {
		disposed = true;
		failAll("Preview media worker failed");
		options.failed?.("Preview media worker failed");
		stop();
		finish(new Error("Preview media worker failed"));
	};
	worker.onmessage = (event: MessageEvent<unknown>) => {
		const parsed = reply.safeParse(event.data);
		if (!parsed.success) {
			disposed = true;
			failAll("Invalid preview media worker response");
			options.failed?.("Invalid preview media worker response");
			stop();
			finish();
			return;
		}
		const message = parsed.data;
		if (message.type === "decoder-request") {
			void decoders.request(message.kind, message.slots).then(
				(lease) =>
					worker.postMessage({ type: "decoder-result", requestId: message.requestId, lease }),
				() =>
					worker.postMessage({ type: "decoder-result", requestId: message.requestId, lease: null }),
			);
			return;
		}
		if (message.type === "decoder-release") {
			decoders.release(message.lease);
			return;
		}

		if (message.type === "reserve-memory") {
			worker.postMessage({
				type: "memory-result",
				reservation: message.reservation,
				accepted: !disposed && reserveSourceMemory(memoryOwner, message.bytes),
			});
			return;
		}
		if (message.type === "release-memory") {
			releaseSourceMemory(memoryOwner, message.bytes);
			return;
		}
		if (message.type === "disposed") {
			stop();
			finish();
			return;
		}
		if (message.type === "protocol-error") {
			failAll(message.message);
			options.failed?.(message.message);
			if (disposed) {
				stop();
				finish(new Error(message.message));
			}
			return;
		}
		if (disposed) return;
		const key = keyOf(message);
		const entry = held.get(key);
		if (!entry || entry.requestId !== message.requestId) return;
		if (message.type === "progress")
			options.progress(message, { loaded: message.loaded, total: message.total });
		if (message.type === "validating") options.validating(message);
		if (message.type === "svg-bytes") {
			entry.bytesComplete = true;
			if (entry.requiresImage && message.file.type.split(";")[0]?.trim() === "image/svg+xml") {
				const controller = new AbortController();
				entry.imageProbe = controller;
				const probe = probeSvgSource(message.file, controller.signal)
					.then(
						() => {
							if (!disposed && held.get(key) === entry) entry.resolve(message.file);
						},
						(error: unknown) => {
							if (!disposed && held.get(key) === entry) {
								entry.failed = true;
								entry.reject(
									error instanceof Error ? error : new Error("Image source cannot be decoded"),
								);
							}
						},
					)
					.finally(() => imageProbes.delete(probe));
				imageProbes.add(probe);
				return;
			}
			entry.failed = true;
			entry.reject(new Error("SVG bytes do not match image source requirements"));
			return;
		}
		if (message.type === "complete") {
			entry.bytesComplete = true;
			if (message.file.type.split(";")[0]?.trim() === "image/svg+xml") {
				entry.failed = true;
				entry.reject(new Error("SVG source requires DOM validation"));
				return;
			}
			entry.video = message.probe.video ?? undefined;
			entry.audio = message.probe.audio ?? undefined;
			if (entry.requiresVideo && !entry.video) {
				entry.failed = true;
				entry.reject(new Error("Validated video metadata is missing"));
			} else entry.resolve(message.file);
		}
		if (message.type === "failed") {
			entry.failed = true;
			entry.bytesComplete = message.bytesComplete;
			entry.reject(new Error(message.message));
		}
	};
	return {
		load(source: Source, file?: File): Promise<File> {
			if (disposed) return Promise.reject(new Error("Preview media session is disposed"));
			const key = keyOf(source);
			const existing = held.get(key);
			const definition = JSON.stringify([source.url, source.kinds]);
			if (existing && !existing.failed && existing.definition === definition)
				return existing.promise;
			const reuse =
				existing?.url === source.url &&
				(!existing.failed || (existing.bytesComplete && existing.definition !== definition));
			if (existing) {
				existing.imageProbe?.abort();
				existing.reject(new Error("Preview media source requirements changed"));
				if (!reuse)
					worker.postMessage({
						type: "cancel",
						source: { id: source.id, revision: source.revision },
					});
			}
			let resolve!: Held["resolve"];
			let reject!: Held["reject"];
			const promise = new Promise<File>((yes, no) => {
				resolve = yes;
				reject = no;
			});
			const entry: Held = {
				promise,
				resolve,
				reject,
				requestId: ++nextRequestId,
				definition,
				url: source.url,
				failed: false,
				bytesComplete: false,
				requiresVideo: source.kinds.includes("video"),
				requiresImage: source.kinds.every((kind) => kind === "image"),
				authorization: reuse ? existing?.authorization : undefined,
			};
			held.set(key, entry);
			const authorization = file
				? Promise.resolve(undefined)
				: (entry.authorization ??= options.resolve(source));
			void authorization.then(
				(target) => {
					if (!disposed && held.get(key) === entry)
						worker.postMessage({
							type: "load",
							source: {
								id: source.id,
								revision: source.revision,
								requestId: entry.requestId,
								kinds: source.kinds,
								...(file ? { file } : { target }),
							},
						});
				},
				() => {
					if (held.get(key) === entry) held.delete(key);
					reject(new Error("Media authorization failed"));
				},
			);
			return promise;
		},
		metadata(source: Identity): VideoMetadata | undefined {
			return held.get(keyOf(source))?.video;
		},
		audioMetadata(source: Identity): AudioMetadata | undefined {
			return held.get(keyOf(source))?.audio;
		},
		release(source: Identity): void {
			const key = keyOf(source);
			held.get(key)?.reject(new Error("Preview media source was released"));
			held.get(key)?.imageProbe?.abort();
			held.delete(key);
			if (!disposed)
				worker.postMessage({
					type: "cancel",
					source: { id: source.id, revision: source.revision },
				});
		},
		dispose(): Promise<void> {
			if (closed) return closed;
			if (disposed) return Promise.resolve();
			disposed = true;
			failAll("Preview media session is disposed");
			closed = new Promise<void>((resolve, reject) => {
				finish = (error) => (error ? reject(error) : resolve());
			}).then(async () => {
				await Promise.allSettled([...imageProbes]);
			});
			worker.postMessage({ type: "dispose" });
			return closed;
		},
	};
}
