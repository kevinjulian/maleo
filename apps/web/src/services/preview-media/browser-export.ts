/* Starts a browser export in its own worker (OpenSpec p2-export E2) and owns
 * what the worker borrows from the page: complete local sources from the
 * preview's loader, and decoder slots from the editor engine's grants.
 *
 * The storyboard is captured when the export starts. It must carry the local
 * source URLs the preview resolved (`withPreviewLocalSources`), so every
 * decoded byte comes from complete local files and no frame waits on the
 * network. A source the preview revokes during export ends the export. */
import { exportEventSchema, type ExportRequest } from "@models/render/export-protocol.ts";
import { storyboardMediaUrls } from "@models/timeline/rust-compare.ts";
import type { PreviewMediaBinding } from "@models/timeline/preview-protocol.ts";
import { openDecoderLeases } from "./decoder-leases.ts";
import { borrowLocalPreviewSource } from "./local-sources.ts";

const WORKER_URL = "/renderer/export-worker.js";

export interface BrowserExportInput {
	storyboard: Parameters<typeof storyboardMediaUrls>[0];
	fps: number;
	frames: number;
	width: number;
	height: number;
	bitrate: number;
	onProgress?: (phase: string, frame: number, frames: number) => void;
}

export interface ExportWorkerLike {
	postMessage(message: ExportRequest, transfer?: Transferable[]): void;
	terminate(): void;
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
}

export interface BrowserExportDeps {
	createWorker: () => ExportWorkerLike;
	openDecoders: typeof openDecoderLeases;
	borrow: typeof borrowLocalPreviewSource;
}

const defaultDeps: BrowserExportDeps = {
	createWorker: () => new Worker(WORKER_URL, { type: "module" }),
	openDecoders: openDecoderLeases,
	borrow: borrowLocalPreviewSource,
};

/** A running browser export: its file, or why it has none. */
export interface BrowserExport {
	done: Promise<Blob>;
	cancel(): void;
}

export class ExportCancelled extends Error {
	constructor() {
		super("Export cancelled");
	}
}

/** Bits per second for H.264 at this size: 8 Mbit/s at 1080p, scaled by pixel count (E5). */
export function exportBitrate(width: number, height: number): number {
	return Math.max(500_000, Math.round((8_000_000 * width * height) / (1920 * 1080)));
}

export function startBrowserExport(
	input: BrowserExportInput,
	deps: BrowserExportDeps = defaultDeps,
): BrowserExport {
	const owners = new Map<number, ReturnType<typeof openDecoderLeases>>();
	const borrowed: { release(): void }[] = [];
	let ended = false;
	let worker: ExportWorkerLike | null = null;
	let settle: { resolve(blob: Blob): void; reject(error: Error): void } | null = null;
	const done = new Promise<Blob>((resolve, reject) => (settle = { resolve, reject }));

	function finish(result: Blob | Error): void {
		if (ended) return;
		ended = true;
		worker?.terminate();
		for (const owner of owners.values()) owner.close();
		owners.clear();
		for (const held of borrowed) held.release();
		if (result instanceof Error) settle?.reject(result);
		else settle?.resolve(result);
	}
	function post(message: ExportRequest): void {
		if (!ended) worker?.postMessage(message);
	}

	try {
		const media: PreviewMediaBinding[] = storyboardMediaUrls(input.storyboard).map((url) => {
			const held = deps.borrow(url, async () =>
				finish(new Error("A media source changed during export. Export again.")),
			);
			borrowed.push(held);
			return { url, ...held.source };
		});
		worker = deps.createWorker();
		worker.onerror = (event) => finish(new Error(event.message || "Export worker failed"));
		worker.onmessage = (event) => {
			const parsed = exportEventSchema.safeParse(event.data);
			if (!parsed.success) return finish(new Error("Invalid export worker message"));
			const data = parsed.data;
			switch (data.type) {
				case "progress":
					return input.onProgress?.(data.phase, data.frame, data.frames);
				case "done":
					return finish(new Blob([data.bytes], { type: "video/mp4" }));
				case "failed":
					return finish(new Error(data.message));
				case "cancelled":
					return finish(new ExportCancelled());
				case "decoder-request": {
					let owner = owners.get(data.owner);
					if (!owner) {
						owner = deps.openDecoders((lease) =>
							post({ type: "decoder-yield", owner: data.owner, lease }),
						);
						owners.set(data.owner, owner);
					}
					void owner.request(data.kind, data.slots).then(
						(lease) =>
							post({ type: "decoder-grant", owner: data.owner, request: data.request, lease }),
						(error: unknown) =>
							post({
								type: "decoder-reject",
								owner: data.owner,
								request: data.request,
								message: error instanceof Error ? error.message : "Decoder lease failed",
							}),
					);
					return;
				}
				case "decoder-return":
					return owners.get(data.owner)?.release(data.lease);
				case "decoder-close":
					owners.get(data.owner)?.close();
					owners.delete(data.owner);
					return;
			}
		};
		worker.postMessage({
			type: "start",
			json: JSON.stringify(input.storyboard),
			fps: input.fps,
			frames: input.frames,
			width: input.width,
			height: input.height,
			bitrate: input.bitrate,
			media,
		});
	} catch (error) {
		finish(error instanceof Error ? error : new Error(String(error)));
	}

	return {
		done,
		cancel() {
			if (ended) return;
			post({ type: "cancel" });
			// The worker reports `cancelled` after it stops; terminate if it cannot.
			setTimeout(() => finish(new ExportCancelled()), 2_000);
		},
	};
}
